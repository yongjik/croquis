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

def gen_images(launcher, context):
    page = context.new_page()
    page.set_viewport_size(dict(width=1500, height=1200))
    url = launcher.create_new_notebook('images_tutorial.ipynb', [CELL1, CELL2])
    page.goto(url)

    cell, img = test_helper.run_jupyter_cell(page, 'CELL1', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial1-first.png')

    cell, img = test_helper.run_jupyter_cell(page, 'CELL2', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'tutorial2-multiple-lines.png')

    page.close()
