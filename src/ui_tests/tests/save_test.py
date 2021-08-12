# Test that the cells behave sane across kernel restart and save/load.

import time

from test_util import test_helper

CELL1 = '''
### CELL1 ###

import croquis

# Create three dots.
fig = croquis.plot()
fig.add([-1], [0], marker_size=50, label='left')
fig.add([0], [0], marker_size=50, label='center1')
fig.add([1], [0], marker_size=50, label='right')
fig.show()
'''

CELL2 = '''
### CELL2 ###

import croquis

# Create a different set of three dots.
fig = croquis.plot()
fig.add([-1], [-1], marker_size=50, label='down_left')
fig.add([0], [0], marker_size=50, label='center2')
fig.add([1], [1], marker_size=50, label='up_right')
fig.show()
'''

CELL3 = '''
### CELL3 ###

import croquis

# Create the third set of dots!
fig = croquis.plot()
fig.add([-1], [1], marker_size=50, label='up_left')
fig.add([0], [0], marker_size=50, label='center3')
fig.add([1], [-1], marker_size=50, label='down_right')
fig.show()
'''

# Check the plot is functioning by hovering at the center of the plot and
# checking that we get the correct label.
def _check_center_label(page, cell, label, **kwargs):
    def coord_cb():
        grid = cell.wait_for_selector('.cr_grid')
        grid.scroll_into_view_if_needed()
        return test_helper.get_center_coord(grid)

    test_helper.verify_tooltip(
        page, cell, coord_cb, lambda text: label in text, **kwargs)

def test_kernel_restart(launcher, context):
    page = context.new_page()
    url = launcher.create_new_notebook(
        'kernel_restart_test.ipynb', [CELL1, CELL2, CELL3],
        separate_prefix=True)
    page.goto(url)
    test_helper.run_jupyter_cell(page, 'PREFIX', 'pre:has-text("PREFIX OK")')

    test_helper.save(page)

    cell1, axis1 = test_helper.run_jupyter_cell(page, 'CELL1', 'div.cr_x_axis')
    cell2, axis2 = test_helper.run_jupyter_cell(page, 'CELL2', 'div.cr_x_axis')

    _check_center_label(page, cell1, 'center1')
    _check_center_label(page, cell2, 'center2')

    test_helper.restart_kernel(page)
    test_helper.run_jupyter_cell(page, 'PREFIX', 'pre:has-text("PREFIX OK")')

    # Try Cell 3 now.
    cell3, axis3 = test_helper.run_jupyter_cell(page, 'CELL3', 'div.cr_x_axis')
    _check_center_label(page, cell3, 'center3', timeout=10000)

    page.close()

def test_save_load(launcher, context):
    page = context.new_page()
    url = launcher.create_new_notebook('save_test.ipynb', [CELL1, CELL2, CELL3])
    page.goto(url)

    cell1, axis1 = test_helper.run_jupyter_cell(page, 'CELL1', 'div.cr_x_axis')
    cell2, axis2 = test_helper.run_jupyter_cell(page, 'CELL2', 'div.cr_x_axis')

    _check_center_label(page, cell1, 'center1')
    _check_center_label(page, cell2, 'center2')

    test_helper.save(page)

    # Now open another window.
    page2 = context.new_page()
    page2.goto(url)

    # Try Cell 3 now.
    cell3, axis3 = test_helper.run_jupyter_cell(page2, 'CELL3', 'div.cr_x_axis')
    _check_center_label(page2, cell3, 'center3')

    # Check that we can re-run cell 2.
    cell2, axis2 = test_helper.run_jupyter_cell(page2, 'CELL2', 'div.cr_x_axis')
    _check_center_label(page2, cell2, 'center2')

    page.close()
    page2.close()

def run_tests(launcher, context):
    print('Running save_test.py ...')
    test_kernel_restart(launcher, context)
    test_save_load(launcher, context)
