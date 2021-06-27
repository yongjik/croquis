# Utility functions for handling buffers.

import types

import numpy as np

# Return a memoryview object that represents `data`.
# If `copy_data` is true, make a copy first.
#
# If a list is given, convert to numpy array first, using `dtype`.  Otherwise,
# `dtype` is unused.
#
# TODO: I'm not sure if using memoryview is useful.  Since we need numpy anyway,
#       maybe we should just move everything to numpy arrays?
def ensure_buffer(data, dtype=None, copy_data=True):
    # Sanity check.
    if isinstance(data, types.GeneratorType):
        raise TypeError(
            f'Cannot convert a generator {type(data)} to a buffer: '
            'did you use (... for ... in ...) instead of [...]?')

    try:
        data = memoryview(data)
    except TypeError:
        # If `data` does not support Python buffer protocol (e.g., it is a
        # list), then we first convert it to a numpy array.
        #
        # cf. https://docs.python.org/3/c-api/buffer.html
        data = np.array(data, copy=copy_data, dtype=dtype)

        # Convert numpy datetime to unix timestamp.
        if np.issubdtype(data.dtype, np.datetime64):
            data = (data - np.datetime64(0, 's')) / np.timedelta64(1, 's')

        return memoryview(data)

    if copy_data:
        data = memoryview(np.copy(data))
    return data
