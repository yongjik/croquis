# Basic functionality test.

import re
import time

from test_util import test_helper

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

def test_zoom(launcher, context):
    page = context.new_page()
    url = launcher.create_new_notebook('basic_test.ipynb', [CELL1])
    page.goto(url)

    # Scroll to the bottom.
    cell, x_axis = test_helper.run_jupyter_cell(page, 'CELL1', 'div.cr_x_axis')
    x_axis.scroll_into_view_if_needed()

    # Check screen coordinate of x=-1, x=1, y=-1, y=1.
    xleft, _ = test_helper.get_center_coord1(
        page, r'div.cr_x_axis div.cr_label >> text=/^-1(\.0)?$/')
    xright, _ = test_helper.get_center_coord1(
        page, r'div.cr_x_axis div.cr_label >> text=/^1(\.0)?$/')
    _, ytop = test_helper.get_center_coord1(
        page, 'div.cr_y_axis div.cr_label >> text=/^1(\.0)?$/')
    _, ybottom = test_helper.get_center_coord1(
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

    def coord_cb():
        x_coord = test_helper.get_center_coord1(
            page, 'div.cr_x_axis div.cr_label >> text="0.0"')
        y_coord = test_helper.get_center_coord1(
            page, 'div.cr_y_axis div.cr_label >> text="0.0"')

        if (x_coord is None) or (y_coord is None): return None

        # print('coords = ', x_coord[0], y_coord[1])
        return x_coord[0], y_coord[1]

    # Now zoom at the origin, and verify that we have the tooltip.
    test_helper.verify_tooltip(page, cell, coord_cb,
        lambda text: re.search(r'origin(.|\n)*\(\s*0,\s+0\)', text))

    # print('test_zoom successful!')
    # page.pause()

    page.close()

def run_tests(launcher, context):
    print('Running basic_test.py ...')
    test_zoom(launcher, context)
