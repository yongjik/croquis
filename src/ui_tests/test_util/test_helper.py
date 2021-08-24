# Utility functions for testing.

import time

import playwright.async_api

# Execute a Jupyter cell containing the given substring (`substr`).
# Wait until an element with `result_selector` is available, and return that
# element.
def run_jupyter_cell(page, substr, result_selector, **kwargs):
    selector = f'pre[role="presentation"]:has-text("{substr}")'
    pre = page.wait_for_selector(selector)
    pre.click()
    cell = page.wait_for_selector(f'div.cell.selected:has({selector})')
    focus = cell.wait_for_selector('textarea')
    focus.press('Control+Enter')

    return cell, cell.wait_for_selector(result_selector, **kwargs)

def save(page):
    page.press('text=File', 'Control+S')
    page.wait_for_timeout(500)  # Wait 0.5 sec just be sure.

def restart_kernel(page):
    print('Restarting the ipython kernel ...')

    # Restart sometimes takes forever (including the next cell execution), so we
    # need huge timeout.
    page.set_default_timeout(10000)  # 10 sec.

    page.click('button.btn[title*="restart the kernel"]')
    page.wait_for_selector('text="Restart kernel?"')
    page.click('button:has-text("Restart")')  # Confirm.
    page.wait_for_selector('.kernel_idle_icon[id=kernel_indicator_icon]')

def get_center_coord(elem):
    box = elem.bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

def get_center_coord1(page, selector):
    item = page.wait_for_selector(selector)
    if item is None: return None
    return get_center_coord(item)

# Hover mouse cursor at the given coordinate, verify that the tooltip's content
# matches the given condition, and return.
#
# TODO: Get timeout from command line argument?
def verify_tooltip(page, cell, coord_callback, verify_callback, timeout=2500):
    x, y = -999, -999
    T = time.time()

    while time.time() < T + timeout * 0.001:
        x1, y1 = coord_callback()
        if abs(x - x1) + abs(y - y1) > 1.0:
            x, y = x1, y1
            page.mouse.move(x, y)

        # Just wait 100 ms, because element coordinates may change.
        try:
            tooltip = cell.wait_for_selector(
                'div.cr_tooltip', state='visible', timeout=100)
        except playwright.async_api.TimeoutError:
            continue

        content = tooltip.text_content()
        if verify_callback(content): return content

    raise TimeoutError

# Check the plot is functioning by hovering at the center of the plot and
# checking that we get the correct label.
def check_center_label(page, cell, label, **kwargs):
    def coord_cb():
        grid = cell.wait_for_selector('.cr_grid')
        grid.scroll_into_view_if_needed()
        return get_center_coord(grid)

    verify_tooltip(page, cell, coord_cb, lambda text: label in text, **kwargs)
