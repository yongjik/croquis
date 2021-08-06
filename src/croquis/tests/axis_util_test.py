# Use pytest to run.

import datetime
import re
import os
import sys
import time

curdir = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, f'{curdir}/../..')

os.environ['CROQUIS_UNITTEST'] = 'Y'
from croquis import axis_util

# TODO: test offset as well !!

def linear_helper(axis, x0, x1, width, expected):
    builder = axis_util._create_tick_builder('linear', axis, x0, x1, width, 0, 0)
    ticks = builder.run()

    print(ticks)
    assert len(ticks) >= 2

    for px, label in ticks:
        assert re.fullmatch(expected, label)
        coord = float(label)
        if axis == 'x':
            px1 = (coord - x0) / (x1 - x0) * (width - 1)
        else:
            px1 = (x1 - coord) / (x1 - x0) * (width - 1)
        assert abs(px - px1) <= 0.5 + 1e-6

def test_linear():
    linear_helper('x', 0.0223, 0.02244, 700, r'0\.022\d\d')
    linear_helper('x', 2.23e-5, 2.24e-5, 800, r'2\.2\d\de-05')
    linear_helper('x', -12345678, 12345679, 600, r'(0|-?\d+000000)')
    linear_helper('y', -500, 800, 300, r'(0|-?\d00)')
    linear_helper('y', 12345678, 12345679, 2000, r'1\.234567\d+e\+07')

# TODO: This function's behavior depends on the current timezone!
def timestamp_helper(axis, d0, d1, width, expected):
    _unix_ts = lambda d: time.mktime(time.strptime(d, '%Y%m%d-%H%M%S'))
    builder = axis_util._create_tick_builder(
        'timestamp', axis, _unix_ts(d0), _unix_ts(d1), width, 0, 0)
    ticks = builder.run()

    print(ticks)
    assert len(ticks) >= 2

    for px, label in ticks:
        assert re.fullmatch(expected, label)
        # TODO: verify that the time string actually matches the coordinate.

def test_timestamp():
    timestamp_helper('x', '20200101-000000', '20210101-000000', 800, r'202[01]-\d\d-01')
    timestamp_helper('x', '19000101-000000', '20210101-000000', 800, r'\d\d\d0')
    timestamp_helper('x', '20210401-000000', '20210601-000000', 800, r'2021-0[456]-\d\d')
    timestamp_helper('x', '20201231-210000', '20210101-120000', 800,
                     r'(202[01]-\d\d-\d\d )?\d\d:00')
    timestamp_helper('x', '20210131-235000', '20210201-000500', 800,
                     r'(2021-\d\d-\d\d )?\d\d:\d\d')
    timestamp_helper('x', '20210131-235955', '20210201-000005', 800,
                     r'(2021-\d\d-\d\d )?\d\d:\d\d:\d\d')
    timestamp_helper('x', '20191213-084904', '20210118-231056', 1000,
                     r'202[01]-\d\d-01')
