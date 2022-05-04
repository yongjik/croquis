#!/bin/sh
"exec" "python3" "-u" "$0" "$@"
#
# Create images for documentation by calling Playwright.

import argparse
import logging
import os
import sys

from playwright.sync_api import sync_playwright

curdir = os.path.dirname(os.path.realpath(sys.argv[0]))
sys.path.insert(0, '%s/..' % curdir)
sys.path.insert(0, curdir)

from test_util.jupyter_launcher import test_dir, JupyterLauncher

logger = logging.getLogger(__name__)

# TODO: Most arguments are duplicated in run_all_tests.py ...
arg_parser = argparse.ArgumentParser()

arg_parser.add_argument(
    '--output_dir', type=str, default=test_dir,
    help='Output directory for images.')

arg_parser.add_argument(
    '--verbose', action='store_true')

# Arguments for playwright.
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

    os.chdir(cmd_args.output_dir)

    from doc_images import tutorial
    tutorial.gen_images(launcher, context)

    from doc_images import ui
    ui.gen_images(launcher, context)
