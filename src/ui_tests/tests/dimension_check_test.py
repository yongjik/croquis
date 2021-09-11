# Test DimensionChecker.

from test_util import test_helper

CELL1 = '''
### CELL1 ###

import croquis
import numpy as np

# Test coordinate broadcast logic (similar to numpy).
fig = croquis.plot()
X = np.linspace(-5, 5, 10)  # shape = (10,)
Y = np.arange(30).reshape(3, 10)
fig.add(X, Y)
fig.add(X, -Y, colors=np.zeros((3, 3)))

# Add a center dot.
fig.add([0], [0], marker_size=30, label='center')

fig.show()
'''

CELL2 = '''
### CELL2 ###

# Test dimension mismatch errors.
def expect_error(*args, **kwargs):
    fig = croquis.plot()
    try:
        fig.add(*args, **kwargs)
    except ValueError:
        print('ValueError raised successfully!')
        return

    assert None, 'ERROR: no exception raised!'

expect_error(X, Y=np.arange(27).reshape(3, 9))
expect_error(X, Y=np.arange(9))
expect_error(X[:9], Y)
expect_error(X, Y, colors=[0.1, 0.2])
expect_error(X, Y, colors=np.zeros((3, 2)))
expect_error(X, Y, colors=np.zeros((4, 3)))
print('###' + ' TEST OK ' + '###')
'''

def test_dimension_check(launcher, context):
    page = context.new_page()
    url = launcher.create_new_notebook('dimension_test.ipynb', [CELL1, CELL2])
    page.goto(url)

    # Test broadcast.
    cell1, axis1 = test_helper.run_jupyter_cell(page, 'CELL1', 'div.cr_x_axis')
    test_helper.check_center_label(page, cell1, 'center')

    # Test mismatch errors.
    cell1, axis1 = test_helper.run_jupyter_cell(
        page, 'CELL2', 'pre:has-text("### TEST OK ###")')

def run_tests(launcher, context):
    print('Running dimension_check_test.py ...')
    test_dimension_check(launcher, context)
