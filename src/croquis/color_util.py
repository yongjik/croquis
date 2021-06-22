# Generator for the default color scheme.
#
# We may go "fancy" later, but for now, let's stick to the 90's feel.

import numpy as np

# The default color was created in a very "scientific" way by manually
# generating a sequence of points in the HSV coordinate and tweaking it until it
# sort of looked alright.  I.e.,
#
#-------------------------------------------------
# import matplotlib.colors
# import numpy as np
#
# N = 20
# mult = 7
#
# HSV = np.zeros((N, 3))
#
# # Give larger distance around green & purple.
# HSV[:, 0] = [
#     0, 1, 2, 3, 4, 5,
#     7, 9, 11, 13, 15,
#     16, 17, 18, 19, 20,
#     22, 24, 26, 28,
# ]
# HSV[:, 0] /= 30
#
# HSV[:, 1] = 1
# HSV[:, 2] = 1
#
# HSV[[1, 4, 6, 9, 12, 15, 18], 1] = 0.8
# HSV[[1, 4, 6, 9, 12, 15, 18], 2] = 0.8
# HSV[[2, 5, 7, 10, 13, 16, 19], 2] = 0.5
# HSV[8, 2] = 0.3
#
# RGB = matplotlib.colors.hsv_to_rgb(HSV)
#
# for idx in range(N):
#     color = (RGB[(idx * mult) % N] * 255).astype(np.uint8)
#     print('  0x%02x, 0x%02x, 0x%02x,  # %d' % (tuple(color) + (idx,)))
#-------------------------------------------------

BLK_SIZE = 20
DEFAULT_COLORS = np.array([
    0xff, 0x00, 0x00,  # 0
    0x19, 0x7f, 0x00,  # 1
    0x00, 0x33, 0xff,  # 2
    0xcc, 0x49, 0x28,  # 3
    0x00, 0x4c, 0x0f,  # 4
    0x28, 0x28, 0xcc,  # 5
    0x7f, 0x33, 0x00,  # 6
    0x28, 0xcc, 0x8a,  # 7
    0x32, 0x00, 0x7f,  # 8
    0xff, 0x99, 0x00,  # 9
    0x00, 0x7f, 0x7f,  # 10
    0xcc, 0x00, 0xff,  # 11
    0xcc, 0xab, 0x28,  # 12
    0x00, 0xcb, 0xff,  # 13
    0xcc, 0x28, 0xab,  # 14
    0x7f, 0x7f, 0x00,  # 15
    0x28, 0x8a, 0xcc,  # 16
    0x7f, 0x00, 0x33,  # 17
    0x8a, 0xcc, 0x28,  # 18
    0x00, 0x33, 0x7f,  # 19
], dtype=np.uint8).reshape(BLK_SIZE, 3)

def default_colors(start_item_id, item_cnt):
    if item_cnt == 0: return np.zeros((0, 3), dtype=np.uint8)

    start_block = start_item_id // BLK_SIZE
    end_block = (start_item_id + item_cnt + BLK_SIZE - 1) // BLK_SIZE
    offset = start_item_id - start_block * BLK_SIZE

    C = np.tile(DEFAULT_COLORS, (end_block - start_block, 1))
    return C[offset:(offset + item_cnt), :]
