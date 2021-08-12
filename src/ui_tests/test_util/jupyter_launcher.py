# Launches Jupyter notebook as subprocess for testing.

import glob
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
import traceback

import nbformat  # from Jupyter

logger = logging.getLogger(__name__)

curdir = os.path.dirname(os.path.realpath(sys.argv[0]))
croquis_srcdir = '%s/..' % curdir
test_dir = os.path.join(curdir, '.test_workdir')
try:
    os.mkdir(test_dir)
except FileExistsError:
    pass

# OK, quick and dirty, but should work.
os.system(f'cd "{test_dir}" ; rm -f *.ipynb')

class JupyterLauncher(object):
    def __init__(self, cmd_args):
        self.cmd_args = cmd_args
        self.jupyter_proc = None

    def __enter__(self):
        self._run_with_timeout(
            2.0, self._launch_jupyter,
            'Failed to launch Jupyter notebook in time.')
        return self

    def __exit__(self, exc_type, exc_value, tb):
        try:
            # Apparently SIGTERM only kills the notebook (parent) process and
            # doesn't kill kernels, so we end up doing something stupid like
            # this.
            #
            # TODO: what about Windows?
            s = subprocess.check_output(
                ['pgrep', '-P', str(self.jupyter_proc.pid)])
            pids = [int(pid) for pid in s.split()]

            self.jupyter_proc.send_signal(signal.SIGKILL)
            for pid in pids:
                print('Terminating notebook kernel process %d ...' % pid)
                os.kill(pid, signal.SIGTERM)
        except:
            sys.stderr.write(
                'Failed to shut down notebook: '
                'processes may be lingering ...\n')
            traceback.print_exc()
            pass

    # Run a function with timeout: if it doesn't finish in time, abort the
    # process.
    def _run_with_timeout(self, timeout, fn, abort_msg):
        done = False
        def _timeout():
            time.sleep(timeout)
            if done: return  # The function executed successfully!

            logger.critical('%s', abort_msg)
            try:
                self.jupyter_proc.terminate()
            except:
                pass
            os._exit(1)

        thr = threading.Thread(target=_timeout)
        thr.daemon = True
        thr.start()

        fn()
        done = True

    # TODO: This is brittle and depends on the exact console log format of
    # Jupyter notebook, but I'm not sure if there's a better way ...
    def _launch_jupyter(self):
        cmd = ['jupyter-notebook', '--no-browser', '-y']
        if not self.cmd_args.verbose:
            cmd += ['--log-level=CRITICAL']

        self.jupyter_proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=test_dir, encoding='utf-8')
        while True:
            line = self.jupyter_proc.stderr.readline()
            if self.cmd_args.verbose: sys.stderr.write(line)
            m = re.search(r'http://127.0.0.1:([0-9]+)/\?token=[0-9a-f]+', line)
            if m:
                self.url = m.group(0)
                self.port = m.group(1)
                return

    # Create the notebook (.ipynb) file with the given content and return a URL
    # for opening it.
    # cf. https://stackoverflow.com/a/45672031
    def create_new_notebook(self, filename, cell_contents,
                            separate_prefix=False):
        assert filename.endswith('.ipynb'), filename

        PREFIX = f'''
### PREFIX ###
import sys

sys.path.insert(0, "{croquis_srcdir}")
sys.path.insert(0, "{curdir}")

print('###' + ' PREFIX' + ' OK' + ' ###')
'''
        if separate_prefix:
            cell_contents = [PREFIX] + cell_contents
        else:
            cell_contents = cell_contents.copy()
            cell_contents[0] = PREFIX + cell_contents[0]

        nb = nbformat.v4.new_notebook()
        nb['cells'] = [nbformat.v4.new_code_cell(c) for c in cell_contents]

        full_filename = os.path.join(test_dir, filename)
        with open(full_filename, 'w') as f:
            nbformat.write(nb, f)

        url_prefix = self.url.split('?')[0]
        return f'{url_prefix}notebooks/{filename}'
