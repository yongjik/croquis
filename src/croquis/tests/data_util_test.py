#!/usr/bin/env python3

import os
import sys

curdir = os.path.dirname(os.path.realpath(sys.argv[0]))
sys.path.insert(0, f'{curdir}/../..')

os.environ['CROQUIS_UNITTEST'] = 'Y'
from croquis import data_util

import numpy as np

gen = np.random.default_rng(12345)

def run_test(nkeys, nrows):
    key_idxs = gen.integers(0, nkeys, size=nrows)
    keys = ['key%04d' % k for k in key_idxs]

    unique_keys, idxs, start_idxs = data_util.compute_groupby(keys)

    assert len(unique_keys) == len(set(unique_keys))
    assert set(unique_keys) == set(keys)
    assert set(idxs) == set(range(nrows))
    assert len(start_idxs) == len(unique_keys)

    assert start_idxs[0] == 0
    for key_idx in range(len(start_idxs) - 1):
        assert start_idxs[key_idx] < start_idxs[key_idx + 1]

        # Verify that keys are added in the order of their first occurrence.
        # (I.e., idxs[start_idxs[key_idx]] is the first occurrence of the key
        # unique_keys[key_idx].)
        assert idxs[start_idxs[key_idx]] < idxs[start_idxs[key_idx + 1]]

    for key_idx, start_idx in enumerate(start_idxs):
        next_idx = start_idxs[key_idx + 1] if key_idx < len(start_idxs) - 1 \
                                           else nrows

        for idx in range(start_idx + 1, next_idx):
            assert idxs[idx] > idxs[idx - 1]

        for idx in range(start_idx, next_idx):
            assert keys[idxs[idx]] == unique_keys[key_idx]

run_test(1, 1)
run_test(1, 10000)
run_test(10000, 10000)

for nkeys in range(1, 100):
    run_test(nkeys, 1000)

print('All done!')
