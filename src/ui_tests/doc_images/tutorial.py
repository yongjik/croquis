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

def gen_images(launcher, context):
    page = context.new_page()
    page.set_viewport_size(dict(width=1500, height=1200))
    url = launcher.create_new_notebook('images_tutorial.ipynb', [CELL1])
    page.goto(url)

    cell, img = test_helper.run_jupyter_cell(page, 'CELL1', 'div.croquis_nbext')
    page.wait_for_timeout(500)
    screenshot.save_screenshot(page, img, 'tutorial1.png')

    page.close()
