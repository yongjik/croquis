# Helper for logging - mostly for debugging.

import datetime
import logging
import math
import os
import threading
import time

parent = __name__[:__name__.rfind('.')]
parent_logger = logging.getLogger(parent)

start_time = time.time()
log_fd = -1  # Used by C++ code so that we can share the same log file.

# Formats the log message with indicating how much time has passed since the
# last log in this thread.  Useful for debugging.
class ThreadLocalTimestampFormatter(logging.Formatter):
    def __init__(self):
        super().__init__()
        self.thread_local = threading.local()

    def formatMessage(self, record):
        T = record.created
        try:
            elapsed = T - self.thread_local.last_T
        except AttributeError:
            elapsed = 0
        self.thread_local.last_T = T

        # Relative time since the beginning (but only the last ten seconds).
        relative = (T - start_time)
        usec = ((relative * 0.01) - math.floor(relative * 0.01)) * 100
        usec = '%9.6f' % usec

        if -1.0 < elapsed < 1.0:
            elapsed_str = '%+10d' % int(elapsed * 1e6)
        else:
            elapsed_str = '%+10.6f' % elapsed

        timestamp = datetime.datetime.fromtimestamp(T).strftime('%H:%M:%S.%f')
        return '%s%s %-15s %s %s %s:%d %s' % \
               (record.levelname[0], timestamp,
                record.threadName, usec, elapsed_str,
                record.filename, record.lineno, record.message)

class LoggingHandler(logging.Handler):
    def __init__(self, filename):
        super().__init__()
        self.f = None
        if filename is not None:
            self.f = open(filename, 'at', buffering=1)
            self.f.write(f'\n===== Dbglog started (PID {os.getpid()}) =====\n')

            global log_fd
            log_fd = self.f.fileno()

    def emit(self, record):
        try:
            msg = self.format(record) + '\n'
            if self.f is not None:
                self.f.write(msg)
            if record.levelno >= logging.INFO:
                os.write(2, bytes(msg, 'utf-8'))
        except Exception:
            self.handleError(record)

# Enable logging to stderr.
# Called by __init__.py in case of dev environment.
def begin_console_logging(level=logging.INFO, filename='dbg.log'):
    parent_logger.propagate = False
    parent_logger.setLevel(level)

    handler = LoggingHandler(filename)
    handler.setLevel(level)
    handler.setFormatter(ThreadLocalTimestampFormatter())
    parent_logger.addHandler(handler)
