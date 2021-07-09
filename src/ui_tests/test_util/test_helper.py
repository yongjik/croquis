# Utility functions for testing.

def get_center_coord(page, selector):
    item = page.wait_for_selector(selector)
    if item is None: return None
    box = item.bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
