#!/bin/sh
"exec" "python3" "-u" "$0" "$@"
#
# Runs all browser tests under this directory.

import argparse
import logging
import os
import sys

from playwright.sync_api import sync_playwright

curdir = os.path.dirname(os.path.realpath(sys.argv[0]))
sys.path.insert(0, '%s/..' % curdir)
sys.path.insert(0, curdir)

from test_util.jupyter_launcher import JupyterLauncher

logger = logging.getLogger(__name__)

arg_parser = argparse.ArgumentParser()

arg_parser.add_argument(
    '--verbose', action='store_true')

# Arguments for playwright.
# TODO: Test on Mac!
arg_parser.add_argument(
    '--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium',
    help='Browser type supported by playwright.')
arg_parser.add_argument('--headless', action='store_true')
arg_parser.add_argument('--slow_mo', type=int)

# More arguments.
arg_parser.add_argument('--timeout', type=float, default=2.5)

cmd_args = arg_parser.parse_args()

with JupyterLauncher(cmd_args) as launcher, sync_playwright() as p:
    kwargs = {'headless': cmd_args.headless}
    if cmd_args.slow_mo is not None:
        kwargs['slow_mo'] = cmd_args.slow_mo

    # Open the first page URL (containing the auth token).
    browser = getattr(p, cmd_args.browser).launch(**kwargs)
    context = browser.new_context()
    context.set_default_timeout(cmd_args.timeout * 1000)
    context.new_page().goto(launcher.url)

    from tests import basic_test
    basic_test.run_tests(launcher, context)

    from tests import save_test
    save_test.run_tests(launcher, context)

    from tests import resize_test
    resize_test.run_tests(launcher, context)

    browser.close()
