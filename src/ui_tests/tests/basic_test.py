# Basic functionality test.

import re
import time

from test_util.test_helper import get_center_coord

CELL1 = '''
### CELL1 ###

import os; print('PID = ', os.getpid())

import croquis
import numpy as np

# Create a spiral.
N = 1000
R = np.exp(np.linspace(np.log(0.1), np.log(3), N))
Th = np.linspace(0, 5 * np.pi, N)
X = (R * np.cos(Th)).reshape(N, 1)
Y = (R * np.sin(Th)).reshape(N, 1)
labels=['pt %d' % i for i in range(N)]

fig = croquis.plot()

# Add a point at the origin.
fig.add([0], [0], marker_size=5, label='origin')

# Add the spiral.
fig.add(X, Y, marker_size=3, labels=labels)

fig.show()
'''

def test_zoom(launcher, context, page):
    url = launcher.create_new_notebook('basic_test.ipynb', [CELL1])
    page.goto(url)

    page.click('pre[role="presentation"]:has-text("CELL1")')
    page.press('textarea', 'Control+Enter')

    # Scroll to the bottom.
    page.wait_for_selector('div.cr_x_axis').scroll_into_view_if_needed()

    # Check screen coordinate of x=-1, x=1, y=-1, y=1.
    xleft, _ = get_center_coord(
        page, r'div.cr_x_axis div.cr_label >> text=/^-1(\.0)?$/')
    xright, _ = get_center_coord(
        page, r'div.cr_x_axis div.cr_label >> text=/^1(\.0)?$/')
    _, ytop = get_center_coord(
        page, 'div.cr_y_axis div.cr_label >> text=/^1(\.0)?$/')
    _, ybottom = get_center_coord(
        page, 'div.cr_y_axis div.cr_label >> text=/^-1(\.0)?/')

    # print('coords = ', xleft, xright, ytop, ybottom)

    # Select a slightly smaller area (so that all the coordinates are between
    # -1 and 1).
    w = xright - xleft
    h = ybottom - ytop
    xleft += 0.1 * w
    xright -= 0.1 * w
    ytop += 0.1 * w
    ybottom -= 0.1 * w

    # page.pause()

    # Drag mouse across the area to zoom in.
    page.mouse.move(xleft, ytop)
    page.mouse.down()
    time.sleep(0.1)
    page.mouse.move(xright, ybottom)
    time.sleep(0.1)
    page.mouse.up()

    xzero, _ = get_center_coord(
        page, 'div.cr_x_axis div.cr_label >> text="0.0"')
    _, yzero = get_center_coord(
        page, 'div.cr_y_axis div.cr_label >> text="0.0"')

    # print('coords = ', xzero, yzero)

    # Now zoom at the origin, and see if there's tooltip.
    page.mouse.move(xzero, yzero)
    tooltip = page.wait_for_selector('div.cr_tooltip', state='visible')
    tooltip_text = tooltip.text_content()
    # print('tooltip = ', tooltip_text)
    assert re.search(r'origin', tooltip_text), tooltip_text

    # Coordinates may take a while to arrive.
    time.sleep(0.3)
    tooltip = page.wait_for_selector('div.cr_tooltip', state='visible')
    tooltip_text = tooltip.text_content()
    # print('tooltip after delay = ', tooltip_text)
    assert re.search(r'origin(.|\n)*\(\s*0,\s+0\)', tooltip_text), tooltip_text

    print('test_zoom successful!')

    # page.pause()

def run_tests(launcher, context, page):
    test_zoom(launcher, context, page)
