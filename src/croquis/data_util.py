# Miscellaneous utility functions for shuffling data.

import numpy as np

# Given a numpy array `keys` where the same key may be repeated multiple times,
# construct the following:
#
# - `unique_keys`: contains each key just once, in the order they appear first.
# - `idxs`: a map for shuffling data in `keys` so that key values are grouped
#           together.
# - `start_idxs`: contains the start index of each unique key in keys[idxs].
#
# For example if
#   keys == ['foo', 'foo', 'bar', 'foo', 'qux', 'baz', 'baz', 'qux', 'baz'],
#            0      1      2      3      4      5      6      7      8
#   (total 9 rows with 4 unique keys)
#
# then the intermediate variables below are:
#   unique == ['bar', 'baz', 'qoo', 'qux']
#   idxs0 == [2 5 0 4]
#   inverse == [2 2 0 2 3 1 1 3 1]
#   counts == [1 3 3 2]
#
#   order = [2 0 3 1]
#
# and the return values are:
#   unique_keys = ['foo', 'bar', 'qux', 'baz']  # in the order they appear
#   idxs = [0 1 3 2 4 7 5 6 8]  # 0 1 3 == foo
#                               # 2     == bar
#                               # 4 7   == qux
#                               # 5 6 8 == baz
#   start_idxs = [0, 3, 4, 6, (9)]  # Only returns the first 4 numbers.
def compute_groupby(keys):
    unique, idxs0, inverse, counts = np.unique(
        keys, return_index=True, return_inverse=True, return_counts=True)

    order = np.argsort(idxs0, kind='stable')

    try:
        # This will succeed if `keys` is a numpy array.
        unique_keys = keys[idxs0[order]]
    except TypeError:
        unique_keys = [keys[idxs0[i]] for i in order]

    idxs = np.argsort(idxs0[inverse], kind='stable')

    start_idxs = np.zeros(dtype=np.int64, shape=(len(unique_keys) + 1))
    np.cumsum(counts[order], out=start_idxs[1:])

    return unique_keys, idxs, start_idxs[:-1]
