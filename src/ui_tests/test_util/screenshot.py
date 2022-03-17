# Helper function for taking screenshots.

import io

from PIL import Image, ImageOps

def save_screenshot(page, locator, filename):
    # TODO: Add a js debug callback in FE so that we can decide when all the
    #       tiles are loaded.  Currently there's no way to know, so we just wait
    #       for some "reasonable" time.
    page.wait_for_timeout(500)

    img_data = locator.screenshot()
    img = Image.open(io.BytesIO(img_data))
    # Border: left/top/right/bottom.
    img = ImageOps.expand(img, (0, 10, 20, 0), (255, 255, 255))
    img.save(filename)
