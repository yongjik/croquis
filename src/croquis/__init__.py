# Initial test module to test client-server communication.

import sys

# We use f-strings, so 3.6 is the minimum version.
# TODO: Check if we can actually run on 3.6!
assert sys.version_info[:2] >= (3, 6), 'Croquis requires Python 3.6 and higher!'

import logging
import os

from . import env_helper, log_util

# Check if we want to enable debug logging.
def maybe_enable_dbglog():
    filename = None

    if env_helper.ENV in ['dev', 'unittest']:
        filename = 'dbg.log'

    s = os.environ.get('CROQUIS_DBGLOG')
    if s is not None: filename = s

    if filename is not None:
        log_util.begin_console_logging(logging.DEBUG, filename)

maybe_enable_dbglog()

if env_helper.ENV in ['dev', 'unittest']:
    # Enable Python stack dump in case we hit segfault.
    import faulthandler
    faulthandler.enable(file=open('stack.dump', 'a'))

if env_helper.ENV in ['dev', 'deployed']:
    logger = logging.getLogger(__name__)
    logger.info('Loading croquis module ...')

    # Initialize worker threads.
    from .lib import _csrc
    from . import thr_manager

    # Now initialzie other parts.
    from . import comm
    if env_helper.has_ipython(): comm.comm_manager.open()

    # Import public API.
    # TODO: More functions here!!
    from .plot import plot
