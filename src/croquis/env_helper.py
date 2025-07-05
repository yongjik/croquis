# Helper for handling different environments.
#
# We're in the "dev environment", if we're running directly on the source tree.
# We distinguish it by trying to find lib/is_dev.py, which only exists in the
# dev environment (the file is not copied when generating a python wheel).
# Inside the dev environment, we enable extra logging to help debugging.

import os
import re
import sys

if os.environ.get('CROQUIS_UNITTEST'):
    ENV = 'unittest'
else:
    try:
        from .lib import is_dev
        ENV = 'dev'
    except ImportError:
        ENV = 'deployed'

# Check that we're running inside ipython.
# (For now, running outside ipython is only for internal testing.)
if ENV == 'unittest':
    HAS_IPYTHON = False
else:
    try:
        get_ipython()
        HAS_IPYTHON = True
    except NameError:
        HAS_IPYTHON = False
        print(
'''*** IPython not detected: croquis requires IPython to run.
*** Most functionality will not work outside of IPython.
''',
              file=sys.stderr)

# Used when connecting to FE to tell us who we are.
def _init_kernel_id():
    if HAS_IPYTHON:
        kernel = get_ipython().kernel
        conn_file = kernel.config["IPKernelApp"]["connection_file"]
        m = re.match(r".*kernel-(.*).json", conn_file)
        return m.group(1)
    else:
        return None

CURR_KERNEL_ID = _init_kernel_id()

def is_dev(): return ENV == 'dev'
def has_ipython(): return HAS_IPYTHON

def kernel_id():
    assert CURR_KERNEL_ID is not None
    return CURR_KERNEL_ID
