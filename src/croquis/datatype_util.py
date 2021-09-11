# Utility functions for handling different input data types.

import collections
import types

import numpy as np

# Helper function to check if the given object is a pandas DataFrame.
def is_dataframe(obj):
    try:
        import pandas as pd
        return isinstance(obj, pd.DataFrame)
    except ImportError:
        return False

# Return a numpy array object that represents `data`.
# If `copy_data` is true, always make a copy; otherwise, copy only if necessary.
#
# If a list is given, convert to a numpy array first, using `dtype`.  Otherwise,
# `dtype` is unused.
def convert_to_numpy(data, dtype=None, copy_data=True):
    # Sanity check.
    if isinstance(data, types.GeneratorType):
        raise TypeError(
            f'Cannot convert a generator {type(data)} to a buffer: '
            'did you use (... for ... in ...) instead of [...]?')

    data = np.array(data, copy=copy_data, dtype=dtype)
    if data.dtype.hasobject:
        raise TypeError('Object-type numpy arrays are not supported.')

    return data

# Helper class to check that various numpy arrays we receive are in the correct
# dimension.
class DimensionChecker():
    def __init__(self):
        self.dim_info = []
        self.dims = collections.defaultdict(dict)

    # Record the dimensions of parameter `data` (with name `name`), where each
    # dimension is named using `dim_names`.
    #
    # If multi-dimensional lists are possible (e.g., X = [[1,2],[3,4]]), the
    # caller must first call ensure_buffer() or convert_to_numpy() so that we
    # can infer the correct dimension.
    #
    # Due to broadcast logic, not all dimensions need to be present.  E.g., if
    # dim_names == ('lines', 'pts'), then `data` can have shape (200,), in which
    # case we only record `pts == 200` (`lines` will be absent).
    def add(self, name, data, dim_names : tuple, min_dims=1):
        assert type(dim_names) == tuple
        try:
            shape = data.shape
        except AttributeError:
            shape = (len(data),)

        self.dim_info.append((name, shape))

        assert min_dims <= len(shape) <= len(dim_names)
        dim_names = dim_names[-len(shape):]
        for dim_name, sz in zip(dim_names, shape):
            self.dims[dim_name][name] = sz

    # Verify that the recorded dimensions are consistent.
    def verify(self, dim_name, default=None, must=None):
        def _raise(msg):
            raise ValueError(
                msg + ': please check if arguments have correct shapes:' +
                str(self.dim_info))

        if dim_name not in self.dims:
            if default is None: _raise(f'Missing dimension ({dim_name})')
            return default

        s = set(self.dims[dim_name].values())
        if len(s) != 1: _raise(f'Inconsistent dimension ({dim_name})')
        dim, = s
        if must is not None and dim != must:
            _raise(f'Dimension ({dim_name}) must be {must}')
        return dim
