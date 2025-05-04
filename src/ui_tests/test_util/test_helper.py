# Utility functions for testing.

import time

import playwright.async_api

def print_matches(locator):
    print("locator = ", locator)

    # courtesy of ChatGPT.
    wanted_attrs = ['class', 'id']
    for i in range(locator.count()):
        tag = locator.nth(i).evaluate(f'''(el) => {{
            const wanted = {wanted_attrs};
            const attrs = Array.from(el.attributes)
                .filter(attr => wanted.includes(attr.name))
                .map(attr => `${{attr.name}}="${{attr.value}}"`)
                .join(" ");
            return `<${{el.tagName.toLowerCase()}} ${{attrs}}>`;
        }}''')
        print(tag)

def wait_until_kernel_is_idle(page):
    page.locator('div[aria-label="Kernel status" i]').hover()
    page.get_by_text("Kernel status: Idle").wait_for()

# Execute a Jupyter cell containing the given substring (`substr`).
# Wait until an element with `result_selector` is available, and return that
# element.
def run_jupyter_cell(
    page, substr, result_selector,
    *,
    clear_first=False, **kwargs
):
    print(f"  >> Running a cell with {substr} ...")
    cell = page.locator("div.jp-Cell", has_text=substr)

    retry = 0
    while True:
        # Turns out the new version of Jupyter just wipes out (!!) hidden cells from
        # DOM, so we can't even use locator!  How nice.  So we need to manually
        # search for it.

        # Wait until we have some visible cell.
        page.locator("div.jp-Cell").filter(visible=True).first.hover()

        page.keyboard.press("Control+F")
        searchbox = page.locator('textarea[title="Find" i]')
        searchbox.press("Delete")
        searchbox.type(substr)
        searchbox.press("Enter")
        searchbox.press("Escape")
        searchbox.wait_for(state="hidden")

        if cell.filter(visible=True).count() > 0:
            break  # We found it!

        print(f"    >> Could not find cell {substr} - retrying ...")

        page.wait_for_timeout(1000)
        retry += 1
        assert retry < 3, f"Cannot find cell containing {substr}!"

    cell.click()
    page.locator("div.jp-Cell.jp-mod-selected", has_text=substr).wait_for()
    #cell.scroll_into_view_if_needed()

    if clear_first:
        cell.click(button="right")
        page.locator("li", has_text="Clear Cell Output") \
            .filter(visible=True).click()
        cell.locator("div.jp-OutputArea").wait_for(state="hidden")

    cell.press("Control+Enter")
    cell_output = cell.locator(result_selector, **kwargs) 
    cell_output.wait_for()

    return cell, cell_output

def save(page):
    page.press('text=File', 'Control+S')
    page.wait_for_timeout(500)  # Wait 0.5 sec just be sure.

def restart_kernel(page):
    print('Restarting the ipython kernel ...')

    # Restart sometimes takes forever (including the next cell execution), so we
    # need huge timeout.
    page.set_default_timeout(10000)  # 10 sec.

    page.locator(
        'button[aria-label*="restart the kernel" i]'
        ':not([aria-label*="run all cells" i])'
    ).click()
    page.get_by_text("Restart kernel?").wait_for()
    page.locator('button:has-text("Restart")').click()  # Confirm.
    wait_until_kernel_is_idle(page)

def get_center_coord(elem):
    box = elem.bounding_box()
    if box is None: return None
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

def get_center_coord1(page, selector: str):
    item = page.locator(selector)
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
        x1, y1 = coord_callback() or (None, None)
        if (x1 is not None) and (abs(x - x1) + abs(y - y1) > 1.0):
            # import datetime; print(datetime.datetime.now())
            # print(f'Moving cursor from {x} {y} to {x1} {y1}')
            x, y = x1, y1
            page.mouse.move(x, y)

        # Just wait 100 ms, because element coordinates may change.
        try:
            tooltip = cell.locator("div.cr_tooltip")
            tooltip.wait_for(timeout=100)
        except playwright.async_api.TimeoutError:
            continue

        content = tooltip.text_content()
        if verify_callback(content): return content

    # page.pause()
    raise TimeoutError

# Check the plot is functioning by hovering at the center of the plot and
# checking that we get the correct label.
def check_center_label(page, cell, label, **kwargs):
    def coord_cb():
        grid = cell.locator('.cr_grid')
        grid.scroll_into_view_if_needed()
        return get_center_coord(grid)

    verify_tooltip(page, cell, coord_cb, lambda text: label in text, **kwargs)
