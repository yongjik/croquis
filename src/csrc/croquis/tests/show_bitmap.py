#!/usr/bin/env python3
#
# A utility script to visualize the given bitmap.

import sys

import numpy as np
import matplotlib.pyplot as plt

with open(sys.argv[1], 'rb') as f:
    dat = f.read()

dat = np.frombuffer(dat, dtype=np.uint8).reshape(256, 256)

plt.imshow(dat)
plt.show()
