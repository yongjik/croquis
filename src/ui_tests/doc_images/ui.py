# Generate images for the UI documentation.

import os
import re

from test_util import screenshot, test_helper
from test_util.jupyter_launcher import test_dir

curdir = os.path.dirname(os.path.realpath(__file__))

csv_filename = os.path.join(test_dir, 'CA_HI_Feb2020.csv.gz')
if not os.path.exists(csv_filename):
    import urllib.request
    urllib.request.urlretrieve(
        'https://raw.githubusercontent.com/yongjik/croquis-extra/master/noaa_temperature_data/CA_HI_Feb2020.csv.gz',
        csv_filename)

CELLS = f'''
### CELL1 ###

import croquis
import numpy as np

fig = croquis.plot()

for fn in np.sin, np.cos, np.tanh:
    X = np.linspace(-5, 5, 100)
    Y = fn(X)
    fig.add(X, Y, labels=fn.__name__)

fig.show()

--------------------------------------------------

### CELL2 ###

import os

import croquis
import pandas as pd

df = pd.read_csv('CA_HI_Feb2020.csv.gz')

fig = croquis.plot(x_axis='timestamp')
fig.add(pd.to_datetime(df.timestamp, unit='s'), df.temperature, groupby=df.name)
fig.show()
'''

# Create figures for explaining zoom & pan.
# (CELL1 content is the same as CELL1 inside tutorial.py.)
def gen_ui(launcher, context, page):
    cell, img = test_helper.run_jupyter_cell(page, 'CELL1', 'div.croquis_nbext')
    canvas = cell.wait_for_selector('div.cr_canvas')
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    x0, y0, w, h = box['x'], box['y'], box['width'], box['height']

    page.mouse.move(x0 + w * 0.1, y0 + h * 0.1)
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(x0 + w * 0.7, y0 + h * 0.7)
    page.wait_for_timeout(100)

    screenshot.save_screenshot(page, img, 'ui1-zoom.png')

    page.mouse.up()

    screenshot.save_screenshot(page, img, 'ui2-zoom.png')

    pan_btn = img.wait_for_selector('label:has-text("pan")')
    pan_btn.click()

    page.mouse.move(x0 + w * 0.7, y0 + h * 0.3)
    page.mouse.down()
    page.wait_for_timeout(100)
    page.mouse.move(x0 + w * 0.1, y0 + h * 0.6)
    page.wait_for_timeout(100)

    screenshot.save_screenshot(page, img, 'ui3-pan.png')

# Create figures for explaining selections.
def gen_selection(launcher, context, page):
    cell, img = test_helper.run_jupyter_cell(page, 'CELL2', 'div.croquis_nbext')
    screenshot.save_screenshot(page, img, 'sel1-initial.png')
    canvas = cell.wait_for_selector('div.cr_canvas')
    canvas.scroll_into_view_if_needed()

    def coord_cb():
        box = canvas.bounding_box()
        x = box['x'] + box['width'] * 0.65
        y = box['y'] + box['height'] * 0.25
        return int(x), int(y)

    test_helper.verify_tooltip(page, cell, coord_cb,
        lambda text: re.search(r'(?s)(CA|HI) US.*2020', text))
    screenshot.save_screenshot(page, img, 'sel2-tooltip.png')

    searchbox = cell.wait_for_selector('div.cr_searchbox input')
    searchbox.click()

    imgs = []
    imgs.append(screenshot.get_screenshot(page, img))

    for ch in list('yosemi') + ['Backspace'] * 6 + list('los angeles'):
        searchbox.press(ch)
        imgs.append(screenshot.get_screenshot(page, img, delay_msec=150))

    durations = [300] * len(imgs)
    durations[0] = durations[-1] = 1500
    imgs[0].save(
        'sel3-autoselect.png',
        save_all=True,
        append_images=imgs[1:],
        duration=durations,
        loop=0
    )

def gen_images(launcher, context):
    page = context.new_page()
    page.set_viewport_size(dict(width=1500, height=1200))
    cell_contents = re.split(r'(?m)^-+\n', CELLS)
    url = launcher.create_new_notebook('images_ui.ipynb', cell_contents)
    page.goto(url)

    gen_ui(launcher, context, page)
    gen_selection(launcher, context, page)

    page.close()
