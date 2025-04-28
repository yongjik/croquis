# A "figure data" chunk that was added by a single Plotter.add() function.

import collections
import datetime
import logging

import numpy as np

from . import color_util, data_util, datatype_util, misc_util
from .buf_util import ensure_buffer

logger = logging.getLogger(__name__)

class FigData(object):
    def __init__(self, parent):
        # Let's not store the parent, because that will introduce reference
        # cycles.
        self.start_item_id = parent.next_item_id
        self.item_cnt = 0  # Should be filled in by subclass.

    # Subclasses may override this.  The default function assumes the existence
    # of self.colors.
    def get_label_styles(self, item_ids):
        item_ids = np.array(item_ids, dtype=np.int32)
        colors = np.array(self.colors)
        if len(colors.shape) == 1: colors = colors.reshape(1, -1)
        colors = colors[item_ids - self.start_item_id]

        if np.issubdtype(colors.dtype, np.integer):
            colors = colors.astype(np.uint8)
        else:
            colors = (colors * 255.0).clip(0, 255).round().astype(np.uint8)

        colors = ['%02x%02x%02x' % tuple(row) for row in colors]
        return [f'{c}:{self.marker_size}:{self.line_width}' for c in colors]

    # Get the coordinate of the nearest point currently visible on the canvas.
    def get_nearest_pt(self, parent, canvas_config, mouse_x, mouse_y, item_id):
        c = canvas_config
        X, Y = self.get_pts(item_id)

        # Compute pixel coordinates: see the comments for CanvasConfig.
        Z = np.power(1.5, c.zoom_level)
        px = (c.w - 1) * (Z * (X - (c.x0 + c.x1) / 2) / (c.x1 - c.x0) + 0.5)
        py = (c.h - 1) * (Z * (Y - (c.y0 + c.y1) / 2) / (c.y0 - c.y1) + 0.5)

        dist2 = (mouse_x - c.x_offset - px) ** 2 + \
                (mouse_y - c.y_offset - py) ** 2
        ipx = np.rint(px).astype(np.int32) + c.x_offset
        ipy = np.rint(py).astype(np.int32) + c.y_offset
        in_canvas, = np.where(
            (0 <= ipx) & (ipx < c.w) & (0 <= ipy) & (ipy < c.h))

        if len(in_canvas) == 0: return None  # No data!

        best_idx = in_canvas[np.argmin(dist2[in_canvas])]
        screen_x = ipx[best_idx]
        screen_y = ipy[best_idx]
        data_x = X[best_idx]

        # TODO: Find a better way to represent the coordinate as string!
        # TODO: Refactore datetime-related functions into a separate module?
        def _data_coord(axis, val):
            axis_type = parent.axis_config[axis]
            if axis_type == 'linear':
                return '%8g' % val
            elif axis_type == 'timestamp':
                return str(datetime.datetime.fromtimestamp(val))
            else:
                assert None, f'Unsupported axis type {axis_type}'

        return {
            'screen_x': int(ipx[best_idx]),
            'screen_y': int(ipy[best_idx]),
            'data_x': _data_coord('x', X[best_idx]),
            'data_y': _data_coord('y', Y[best_idx]),
        }

    def _verify_labels(self, parent, kwargs):
        if ('label' in kwargs) and ('labels' in kwargs):
            raise ValueError('`label` and `labels` cannot be used together.')
        if 'label' in kwargs:
            if self.item_cnt != 1:
                raise ValueError('`label` requires exactly one line: '
                                 'for other cases, please use `labels.`')
            labels = [kwargs.pop('label')]
        elif 'labels' in kwargs:
            labels = kwargs.pop('labels')
            if type(labels) == str: labels = [labels]
            if self.item_cnt != len(labels):
                raise ValueError(
                    '`labels` must have same number of labels as items: '
                    f'`labels` has {len(labels)} items, while X & Y has '
                    f'{self.item_cnt} lines.')
        else:
            labels = [f'Line #{self.start_item_id + x}'
                      for x in range(self.item_cnt)]
        parent.add_labels(labels)

class RectangularLineData(FigData):
    def __init__(self, parent, X, Y, colors=None, **kwargs):
        super().__init__(parent)

        copy_data = kwargs.pop('copy_data', True)
        self.X = ensure_buffer(X, copy_data=copy_data)
        self.Y = ensure_buffer(Y, copy_data=copy_data)
        if colors is not None:
            self.colors = ensure_buffer(colors, copy_data=copy_data)

        # `lines`: number of lines (= items).
        # `pts`: number of points per line.
        # `rgb': duh.
        checker = datatype_util.DimensionChecker()
        checker.add('X', self.X, ('lines', 'pts'))
        checker.add('Y', self.Y, ('lines', 'pts'))
        if colors is not None:
            checker.add('colors', self.colors, ('lines', 'rgb'))

        self.item_cnt = checker.verify('lines', 1)
        self.pts_cnt = checker.verify('pts')

        if colors is not None:
            checker.verify('rgb', must=3)
        else:
            self.colors = ensure_buffer(
                color_util.default_colors(self.start_item_id, self.item_cnt))
            # print(self.colors.shape)

        self._verify_labels(parent, kwargs)

        self.marker_size = kwargs.pop('marker_size', 3)
        self.line_width = kwargs.pop('line_width', 3)
        self.highlight_line_width = kwargs.pop('highlight_line_width', 5)

        parent._C.add_rectangular_line_data(
            self.X, self.Y, self.colors, self.item_cnt, self.pts_cnt,
            self.marker_size, self.line_width, self.highlight_line_width)

        misc_util.check_empty(kwargs)

    def get_pts(self, item_id):
        X = np.asarray(self.X)
        Y = np.asarray(self.Y)
        return (X if X.ndim == 1 else X[item_id - self.start_item_id],
                Y if Y.ndim == 1 else Y[item_id - self.start_item_id])

class FreeformLineData(FigData):
    def __init__(self, parent, X, Y, colors=None, **kwargs):
        super().__init__(parent)

        copy_data = kwargs.pop('copy_data', True)
        self.X = ensure_buffer(X, copy_data=copy_data)
        self.Y = ensure_buffer(Y, copy_data=copy_data)

        checker = datatype_util.DimensionChecker()
        checker.add('X', self.X, ('pts',))
        checker.add('Y', self.Y, ('pts',))

        if 'groupby' in kwargs:
            assert 'start_idxs' not in kwargs, \
                   '`groupby` and `start_idxs` cannot appear together!'
            groupby = kwargs.pop('groupby')

            checker.add('groupby', groupby, ('pts',))
            self.total_pts_cnt = checker.verify('pts')

            unique_keys, idxs, start_idxs = data_util.compute_groupby(groupby)

            checker.add('unique_keys', unique_keys, ('lines',))

            self.X = ensure_buffer((np.asarray(self.X))[idxs], copy_data=False)
            self.Y = ensure_buffer((np.asarray(self.Y))[idxs], copy_data=False)
            self.start_idxs = ensure_buffer(start_idxs, copy_data=False)

            if ('label' not in kwargs) and ('labels' not in kwargs):
                kwargs['labels'] = [str(k) for k in unique_keys]

        else:
            self.start_idxs = ensure_buffer(
                kwargs.pop('start_idxs'), copy_data=copy_data)
            checker.add('start_idxs', self.start_idxs, ('lines',))
            self.total_pts_cnt = checker.verify('pts')

        if colors is not None:
            self.colors = ensure_buffer(colors, copy_data=copy_data)
            checker.add('colors', self.colors, ('lines', 'rgb'))
            self.item_cnt = checker.verify('lines', 1)
            checker.verify('rgb', must=3)

        else:
            self.item_cnt = checker.verify('lines', 1)
            self.colors = ensure_buffer(
                color_util.default_colors(self.start_item_id, self.item_cnt))

        self._verify_labels(parent, kwargs)

        self.marker_size = kwargs.pop('marker_size', 3)
        self.line_width = kwargs.pop('line_width', 3)
        self.highlight_line_width = kwargs.pop('highlight_line_width', 5)

        parent._C.add_freeform_line_data(
            self.X, self.Y, self.start_idxs, self.colors,
            self.item_cnt, self.total_pts_cnt,
            self.marker_size, self.line_width, self.highlight_line_width)

        misc_util.check_empty(kwargs)

    def get_pts(self, item_id):
        offset = item_id - self.start_item_id
        X = np.asarray(self.X)
        Y = np.asarray(self.Y)
        start_idx = self.start_idxs[offset]
        end_idx = self.start_idxs[offset + 1] if offset < self.item_cnt - 1 \
                                              else self.total_pts_cnt
        return X[start_idx:end_idx], Y[start_idx:end_idx]

# Create a figure of the appropriate class.
# TODO: Support other types!
def create_fig_data(parent, *args, **kwargs):
    if ('start_idxs' in kwargs) or ('groupby' in kwargs):
        return FreeformLineData(parent, *args, **kwargs)
    else:
        return RectangularLineData(parent, *args, **kwargs)
