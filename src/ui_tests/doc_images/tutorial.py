# Images for the tutorial.

import io

from PIL import Image, ImageOps

from test_util import screenshot, test_helper

CELL1 = '''
### CELL1 ###

import croquis
import numpy as np

fig = croquis.plot()

for fn in np.sin, np.cos, np.tanh:
    X = np.linspace(-5, 5, 100)
    Y = fn(X)
    fig.add(X, Y, labels=fn.__name__)

fig.show()
'''

CELL2 = '''
### CELL2 ###

fig = croquis.plot()

X = np.linspace(0, 2 * np.pi, 200)
freqs = np.linspace(0, 1, 100).reshape(100, 1)
Y = np.sin(freqs * X)  # matrix of size 100 x 200
fig.add(X, Y, labels=['freq=%.2f' % f for f in freqs])

fig.show()
'''

CELL3 = '''
### CELL3 ###

# Let's make the random numbers predictable.
np.random.seed(0)

fig = croquis.plot()

Theta = np.linspace(0, 2 * np.pi, 200)
Cx = np.random.normal(size=100)
Cy = np.random.normal(size=100)
R = np.random.uniform(low=0.1, high=2.5, size=100)

# Here, X and Y are 100x200 matrices - each row contains 200 points that
# comprise a circle.
X = Cx.reshape(100, 1) + R.reshape(100, 1) * np.cos(Theta)
Y = Cy.reshape(100, 1) + R.reshape(100, 1) * np.sin(Theta)

# (Optional) having some fun with colors:
#      green
#        ^
# blue <-+-> red
# (Smaller circles are darker.)
colors = np.zeros((100, 3))
colors[:, 0] = (Cx * 0.2 + 0.5).clip(0.0, 1.0)
colors[:, 2] = 1.0 - colors[:, 0]
colors[:, 1] = (Cy * 0.2 + 0.5).clip(0.0, 1.0)
colors *= R.reshape(100, 1) / 2.5

fig.add(X, Y, colors,
        labels=['c=(%.2f, %.2f) r=%.2f' % x for x in zip(Cx, Cy, R)])

fig.show()
'''

CELL4 = '''
### CELL4 ###

np.random.seed(0)

N = 1000000
X = np.random.normal(size=(N, 1))
Y = np.random.normal(size=(N, 1))
labels=['pt %d' % i for i in range(N)]

fig = croquis.plot()
fig.add(X, Y, marker_size=3, labels=labels)
fig.show()
'''

CELL5 = '''
### CELL5 ###

import pandas as pd

df = pd.read_csv('ex5.csv')
fig = croquis.plot()
fig.add(df.x, df.y1, label='y1', line_width=0, marker_size=15)
fig.add(df.x, df.y2, label='y2', line_width=3, marker_size=10)
fig.show()
'''

def gen_images(launcher, context):
    page = context.new_page()
    page.set_viewport_size(dict(width=1500, height=1200))
    url = launcher.create_new_notebook(
        'images_tutorial.ipynb', [CELL1, CELL2, CELL3, CELL4])
    page.goto(url)

    cell, img = test_helper.run_jupyter_cell(page, 'CELL1', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial1-first.png')

    cell, img = test_helper.run_jupyter_cell(page, 'CELL2', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial2-multiple-lines.png')

    cell, img = test_helper.run_jupyter_cell(page, 'CELL3', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial3-circles.png')

    cell, img = test_helper.run_jupyter_cell(page, 'CELL4', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial4-gaussian.png')

    page.close()
