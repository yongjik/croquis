# Helper function for taking screenshots.

import io

from PIL import Image, ImageOps

def get_screenshot(page, locator, delay_msec=500):
    # TODO: Add a js debug callback in FE so that we can decide when all the
    #       tiles are loaded.  Currently there's no way to know, so we just wait
    #       for some "reasonable" time.
    page.wait_for_timeout(delay_msec)

    img_data = locator.screenshot()
    img = Image.open(io.BytesIO(img_data))
    # Border: left/top/right/bottom.
    return ImageOps.expand(img, (0, 10, 20, 0), (255, 255, 255))

def save_screenshot(page, locator, filename, delay_msec=500):
    get_screenshot(page, locator, delay_msec=delay_msec).save(filename)

def save_animated_screenshot(images, filename,
                             frame_duration=300,
                             initial_frame_duration=1500,
                             final_frame_duration=1500):
    durations = [frame_duration] * len(images)
    durations[0] = initial_frame_duration
    durations[-1] = final_frame_duration
    images[0].save(
        filename,
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0
    )
