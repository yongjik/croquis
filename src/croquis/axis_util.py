# Helper function for generating axis labels.

from datetime import datetime, timedelta
import logging
import math
import time

import numpy as np

logger = logging.getLogger(__name__)

# Best/minimum distance between ticks (in pixels).
BEST_DIST_PX = 100
MIN_DIST_PX = 50

# Abstract base class for building "ticks": given a range (either x or y axis),
# create a list of pixel coordinates and labels for "ticks".
class TickBuilder(object):
    # `axis` is either 'x' or 'y', but inside this class we refer all
    # coordinates as x-axis.
    #
    # `offset` is how much canvas was panned in the direction.  E.g., if (width
    # == 500 and offset == 100), then the canvas was moved 100 pixels to the
    # right, so we need ticks in range [-100, 399].
    def __init__(self, axis, x0, x1, width, zoom_level, offset):
        self.axis = axis
        self.width = width
        self.offset = offset

        # Let's just apply zoom_level to modify x0 & x1 so that we don't have to
        # worry about it in the rest of the code.
        #
        # TODO: This same logic is appearing everywhere in slightly different
        #       form - we should do something about it.
        Z = np.power(1.5, zoom_level)
        x0, x1 = min(x0, x1), max(x0, x1)
        self.x0 = (x0 + x1) / 2 - (x1 - x0) / (2 * Z)
        self.x1 = (x0 + x1) / 2 + (x1 - x0) / (2 * Z)

        if self.axis == 'x':
            self.data_offset = (self.x1 - self.x0) / width * offset
        else:
            self.data_offset = (self.x0 - self.x1) / width * offset

    def run(self):
        try:
            ticks = self._get_best_ticks()
            if ticks is None: return []
        except:
            logger.exception('Failed to create ticks for %s axis.', self.axis)
            return []

        coords = ticks.get_coords()
        scale = (self.width - 1) / (self.x1 - self.x0)
        if self.axis == 'x':
            pixel_coords = [round((x - self.x0) * scale) for x, label in coords]
        elif self.axis == 'y':
            # We're creating the y-axis, so "x" is actually "y" here.
            pixel_coords = [round((self.x1 - x) * scale) for x, label in coords]
        else:
            assert None

        return list(zip(pixel_coords, (label for x, label in coords)))

    def _get_best_ticks(self):
        best_ticks = None
        best_score = 1e9

        for ticks in self._generate_ticks():
            # We require at least two ticks, unless the canvas is really
            # narrow, in which case we require at least one.
            if ticks.tick_cnt >= 2 or (ticks.tick_cnt == 1 and self.width < 100):
                score = ticks.score(self.width)
                if (best_score is None) or (score < best_score):
                    best_ticks = ticks
                    best_score = score

        return best_ticks

class LinearTickBuilder(TickBuilder):
    STEP_MULTIPLIERS = [1.0, 0.5, 0.2]

    class TickList(object):
        def __init__(self, x0, x1, step):
            self.step = step

            # Ticks are at position (cmin * step), ((cmin + 1) * step), ...,
            # (cmax * step).
            self.cmin = math.ceil(x0 / step)
            self.cmax = math.floor(x1 / step)
            self.tick_cnt = self.cmax - self.cmin + 1

            # How many multiples of `step` are we talking about?
            self.max_step = abs(max(self.cmin, self.cmax))

        # Larger score is bad.
        def score(self, width):
            return abs(width / (self.tick_cnt + 1e-6) - BEST_DIST_PX)

        def gen(self):
            return [x * self.step for x in range(self.cmin, self.cmax + 1)]

        def get_coords(self):
            coords = [x * self.step for x in range(self.cmin, self.cmax + 1)]

            # If `step` is integer and `max_step` is in a "reasonable" range,
            # print range as integer.
            if self.step >= 1 and self.max_step < 100000000:
                return [(x, str(round(x))) for x in coords]

            # If `step` is not too small and `max_step` is not too big, print
            # range in %f format.
            if 0.000001 <= self.step < 1 and self.max_step < 100000000:
                digits = int(-math.floor(math.log10(self.step)))
                fmt = '%.' + str(digits) + 'f'
                return [(x, fmt % x) for x in coords]

            # Otherwise, just use exponential format.
            #
            # If the numbers are too close, we don't want to print the same
            # label multiple times.  (E.g., if the range is between 1234.12 and
            # 1234.13, we shouldn't print "1234.1" several times!)  So let's
            # first try max digits and then pare down to minimum length that
            # still has distinct values.
            for precision in range(1, 15):
                fmt = '%.' + str(int(precision)) + 'e'
                labels = [fmt % x for x in coords]
                if len(set(labels)) == len(coords): break
            return list(zip(coords, labels))

    def __init__(self, *args):
        super().__init__(*args)

    def _generate_ticks(self):
        # We start with a step that's slightly larger than the canvas width, and
        # shorten it until we find something suitable.
        r = abs(self.x1 - self.x0)
        if r == 0 or math.isnan(r): return  # No ticks possible!
        step = math.pow(10, math.ceil(math.log10(r)))

        while True:
            for mult in self.STEP_MULTIPLIERS:
                ticks = self.TickList(
                    self.x0 - self.data_offset, self.x1 - self.data_offset,
                    step * mult)
                if ticks.tick_cnt >= 2 and \
                   ticks.tick_cnt > self.width / MIN_DIST_PX:
                    return
                else:
                    yield ticks

            step *= 0.1

# TODO: Support different timezones.
class TimestampTickBuilder(TickBuilder):
    STEPS = [
        (10, 'year'),
        (5, 'year'),
        (2, 'year'),
        (1, 'year'),
        (6, 'month'),
        (3, 'month'),
        (2, 'month'),
        (1, 'month'),
        (15, 'day'),
        (7, 'day'),
        (2, 'day'),
        (1, 'day'),
        (12, 'hour'),
        (6, 'hour'),
        (3, 'hour'),
        (2, 'hour'),
        (1, 'hour'),
        (30, 'minute'),
        (15, 'minute'),
        (10, 'minute'),
        (5, 'minute'),
        (2, 'minute'),
        (1, 'minute'),
        (30, 'second'),
        (15, 'second'),
        (10, 'second'),
        (5, 'second'),
        (2, 'second'),
        (1, 'second'),
    ]

    class TickList(object):
        def __init__(self, x0, x1, d0, d1, step, unit):
            self.step = step
            self.x0 = x0
            self.x1 = x1
            self.d0 = d0
            self.d1 = d1
            self.step = step
            self.unit = unit

            if unit == 'year':
                self.tick_cnt = (d1.year // step) - (d0.year // step)
            elif unit == 'month':
                v0 = d0.year * 12 + d0.month - 1
                v1 = d1.year * 12 + d1.month - 1
                self.tick_cnt = (v1 // step) - (v0 // step)
            elif unit == 'day':
                # NOTE: This isn't clean because, unlike other units, we can't
                # "nicely" divide any time interval in, say, 10 days - each
                # month has different number of days.
                self.tick_cnt = (d1.date() - d0.date()).days // step
            elif unit == 'hour':
                delta = self._normalize(d1) - self._normalize(d0)
                hours = (delta.days * 86400 + delta.seconds) // 3600
                self.tick_cnt = hours // step
            elif unit == 'minute':
                delta = self._normalize(d1) - self._normalize(d0)
                minutes = (delta.days * 86400 + delta.seconds) // 60
                self.tick_cnt = minutes // step
            elif unit == 'second':
                self.tick_cnt = (x1 // step) - (x0 // step)

        # Larger score is bad.
        def score(self, width):
            return abs(width / (self.tick_cnt + 1e-6) - BEST_DIST_PX)

        def get_coords(self):
            # Create timestamp.
            _ts = lambda d: time.mktime(d.timetuple())

            result = []
            if self.unit == 'year':
                for y in range(self.d0.year, self.d1.year + 1):
                    if y % self.step == 0:
                        d = datetime(year=y, month=1, day=1)
                        t = _ts(d)
                        if self.x0 <= t <= self.x1:
                            result.append((t, str(y)))
            elif self.unit == 'month':
                for y in range(self.d0.year, self.d1.year + 1):
                    for m in range(1, 13):
                        if (m - 1) % self.step == 0:
                            d = datetime(year=y, month=m, day=1)
                            t = _ts(d)
                            if self.x0 <= t <= self.x1:
                                result.append((t, '%d-%02d-01' % (y, m)))
            elif self.unit == 'day':
                d = self.d0.date()
                while d <= self.d1.date():
                    t = _ts(d)
                    if self.x0 <= t <= self.x1:
                        result.append(
                            (t, '%d-%02d-%02d' % (d.year, d.month, d.day)))
                    d += timedelta(days=self.step)
            elif self.unit == 'hour':
                d = self._normalize(self.d0)
                last_day = None
                while d <= self.d1:
                    t = _ts(d)
                    if self.x0 <= t <= self.x1:
                        if d.date() != last_day:
                            label = '%d-%02d-%02d %02d:00' % \
                                    (d.year, d.month, d.day, d.hour)
                            last_day = d.date()
                        else:
                            label = '%02d:00' % d.hour
                        result.append((t, label))
                    d += timedelta(hours=self.step)
            elif self.unit == 'minute':
                d = self._normalize(self.d0)
                last_day = None
                while d <= self.d1:
                    t = _ts(d)
                    if self.x0 <= t <= self.x1:
                        if d.date() != last_day:
                            label = '%d-%02d-%02d %02d:%02d' % \
                                    (d.year, d.month, d.day, d.hour, d.minute)
                            last_day = d.date()
                        else:
                            label = '%02d:%02d' % (d.hour, d.minute)
                        result.append((t, label))
                    d += timedelta(minutes=self.step)
            elif self.unit == 'second':
                d = self._normalize(self.d0)
                last_day = None
                while d <= self.d1:
                    t = _ts(d)
                    if self.x0 <= t <= self.x1:
                        if d.date() != last_day:
                            label = '%d-%02d-%02d %02d:%02d:%02d' % \
                                    (d.year, d.month, d.day,
                                     d.hour, d.minute, d.second)
                            last_day = d.date()
                        else:
                            label = '%02d:%02d:%02d' % \
                                    (d.hour, d.minute, d.second)
                        result.append((t, label))
                    d += timedelta(seconds=self.step)
            else:
                assert None

            return result

        # Only supports hours and minutes for now.
        def _normalize(self, d):
            if self.unit == 'hour':
                hour = (d.hour // self.step) * self.step
                return d.replace(hour=hour, minute=0, second=0, microsecond=0)
            elif self.unit == 'minute':
                minute = (d.minute // self.step) * self.step
                return d.replace(minute=minute, second=0, microsecond=0)
            elif self.unit == 'second':
                second = (d.second // self.step) * self.step
                return d.replace(second=second, microsecond=0)
            else:
                assert None

    def __init__(self, *args):
        super().__init__(*args)

    def _generate_ticks(self):
        # Compare two endpoints to decide the suitable tick interval.
        d0 = datetime.fromtimestamp(self.x0 - self.data_offset)
        d1 = datetime.fromtimestamp(self.x1 - self.data_offset)

        started = False
        for step, unit in self.STEPS:
            v0 = getattr(d0, unit) // step
            v1 = getattr(d1, unit) // step
            if started or v0 != v1:
                started = True
                ticks = self.TickList(
                    self.x0 - self.data_offset, self.x1 - self.data_offset,
                    d0, d1, step, unit)
                if ticks.tick_cnt >= 2 and \
                   ticks.tick_cnt > self.width / MIN_DIST_PX:
                    return
                else:
                    yield ticks

        # TODO: Handle sub-second resolution !!

def _create_tick_builder(axis_type, *args):
    if axis_type == 'linear':
        return LinearTickBuilder(*args)
    elif axis_type == 'timestamp':
        return TimestampTickBuilder(*args)
    else:
        assert None, f'Unsupported axis type {axis_type}'

# Create label data given the canvas config.
def create_labels(data, canvas_config, zoom_level, axis_config):
    x_offset = round(data.get('x_offset', 0))
    y_offset = round(data.get('y_offset', 0))

    data['axes'] = {
        'x': _create_tick_builder(
                 axis_config['x'], 'x',
                 canvas_config.x0, canvas_config.x1,
                 canvas_config.w, zoom_level, x_offset
             ).run(),
        'y': _create_tick_builder(
                 axis_config['y'], 'y',
                 canvas_config.y0, canvas_config.y1,
                 canvas_config.h, zoom_level, y_offset
             ).run(),
    }

    # logger.info('x0 x1 w = %s %s %s', x0, x1, w)
