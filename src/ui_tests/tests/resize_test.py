# Test window resize.

from test_util import test_helper

CELL1 = '''
### CELL1 ###

import croquis

# Create three dots.
fig = croquis.plot()
fig.add([-1], [0], marker_size=10, label='left')
fig.add([0], [0], marker_size=10, label='center')
fig.add([1], [0], marker_size=10, label='right')
fig.show()
'''

def test_resize(launcher, context):
    page = context.new_page()
    url = launcher.create_new_notebook('resize_test.ipynb', [CELL1])
    page.goto(url)

    cell1, axis1 = test_helper.run_jupyter_cell(page, 'CELL1', 'div.cr_x_axis')
    test_helper.check_center_label(page, cell1, 'center')

    w0, h0 = page.viewport_size['width'], page.viewport_size['height']
    print(f'Original window width, height = {w0}, {h0}')

    # Try reducing window size.
    w, h = int(w0 * 0.7), int(h0 * 0.7)
    page.set_viewport_size({'width': w, 'height': h})
    print(f'New window width, height = {w}, {h}')
    test_helper.check_center_label(page, cell1, 'center')

    # Try increasing window size.
    w, h = int(w0 * 1.2), int(h0 * 1.2)
    page.set_viewport_size({'width': w, 'height': h})
    print(f'New window width, height = {w}, {h}')
    test_helper.check_center_label(page, cell1, 'center')

def run_tests(launcher, context):
    print('Running resize_test.py ...')
    test_resize(launcher, context)
