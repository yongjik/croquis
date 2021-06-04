# Wrapper around C++ thread manager.

import logging
import os
import threading
import traceback
import weakref

from . import log_util
from .lib import _csrc

logger = logging.getLogger(__name__)

# Sanity check - we probably don't need more threads.
MAX_THREAD = 50

# A simple wrapper around threads so that we can log any unhandled exception and
# then *do* shut down the process.
def create_thread(target, name, daemon=False, args=(), kwargs={}):
    assert callable(target)

    def _thr_main():
        try:
            logger.debug('Thread %s started.', name)
            target(*args, **kwargs)
            # These threads normally never finish.
            logger.warning('Thread %s exiting ...', name)
        except:
            logger.exception('Unhandled exception, terminating the process!')
            # import pdb; pdb.post_mortem()
            os._exit(1)

    thr = threading.Thread(target=_thr_main, name=name, daemon=daemon)
    return thr

class ThrManager(object):
    def __init__(self, nthreads=None):
        self.callbacks = {}

        nthreads = nthreads or min(MAX_THREAD, os.cpu_count())
        logger.info('Creating %d worker threads ...', nthreads)
        self._C = _csrc.ThrManager(
            nthreads, ThrManager._callback_entry_point,
            log_util.start_time, log_util.log_fd)

        # Instead of creating threads inside the C++ ThrManager, we create
        # threads here and hand them over to C++, for better error reporting.
        def _thr(idx):
            thr = create_thread(self._C.wthr_entry_point, f'Croquis#{idx}',
                                daemon=True, args=(idx,))
            thr.start()
            return thr

        self.threads = [_thr(i) for i in range(nthreads)]

    # Register callbacks so that C++ code can easily call Python code.
    #
    # I'm paranoid, so to avoid circular references, we'll use weak references.
    # (See CommManager.register_handler for discussion.)
    def _register_cpp_callback(self, C_obj, callback):
        obj_id = C_obj.get_address()
        ref = weakref.WeakMethod(callback)
        self.callbacks[obj_id] = ref

    # Callback function called by C++ code.
    # (We use "staticmethod" to avoid holding reference to `self`.)
    #
    # See also CommManager._msg_handler().
    @staticmethod
    def _callback_entry_point(obj_id, str_data, data1, data2):
        if data1 is not None: data1 = memoryview(data1)
        if data2 is not None: data2 = memoryview(data2)

        global thr_manager
        self = thr_manager
        callback = self.callbacks.get(obj_id)
        if callback is None:
            logger.error('Cannot find callback for obj_id=%x', obj_id)
            return False

        cb = callback()
        if cb is None:
            logger.error('Handler gone for obj_id=%x', obj_id)
            del self.callbacks[obj_id]
            return False

        # `str_data` contains key-value pairs in the format "x=y", e.g.,
        # {"msg=test_message", "foo=hello", "#bar=3"}.
        assert type(str_data) == list
        d = {}
        for kv in str_data:
            key, val = kv.split('=', 1)
            if key.startswith('#'): key, val = key[1:], int(val)
            d[key] = val
        cb(d, data1, data2)
        return True

# Start the thread manager.
# Currently there's no support for "shutting down" ThrManager: it will keep
# running as long as the process is alive.
thr_manager = ThrManager()
register_cpp_callback = thr_manager._register_cpp_callback
