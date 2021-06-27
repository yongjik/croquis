# A minimal plotting function, for starters.

import collections
import logging
import re
import threading

import numpy as np

from .lib import _csrc
from . import axis_util, comm, display, fig_data, png_util, thr_manager

logger = logging.getLogger(__name__)

class Plotter(object):
    # TODO: Also call add() if kwargs contains X, Y, etc.
    def __init__(self, **kwargs):
        self._C = _csrc.Plotter()
        self.selection_map_lock = threading.Lock()
        self.show_called = False

        # For now, supports 'linear' and 'timestamp'.
        self.axis_config = kwargs.pop('axis', {})
        for axis in 'x', 'y':
            arg = kwargs.pop(f'{axis}_axis', None)
            if arg is not None: self.axis_config[axis] = arg
            self.axis_config.setdefault(axis, 'linear')

        self.fig_data_list = []
        self.labels = []
        self.next_item_id = 0

        # I don't know if we can guarantee that requests are called in order: so
        # we remember out-of-order requests so that we can apply them in order.
        # Key is the corresponding `sm_vesrion`.
        self.ooo_updates = {}
        self.ooo_tile_reqs = collections.defaultdict(list)

        self.disp = display.DisplayObj(**kwargs)

        thr_manager.register_cpp_callback(self._C, self._send_msg)

    def add(self, *args, **kwargs):
        fd = fig_data.create_fig_data(self, *args, **kwargs)
        self.fig_data_list.append(fd)
        self.next_item_id += fd.item_cnt

    # Called by FigData constructors.
    def add_labels(self, labels):
        # We need list() operator in case `labels` is, e.g., a numpy array of
        # np.str_.
        self.labels += list(labels)

    def show(self):
        assert not self.show_called, 'Plotter.show() called twice!'
        self.show_called = True

        # Keep a list of canonical lowercase strings for matching.
        self.lower_labels = [s.casefold() for s in self.labels]

        # Owned by C++ object.
        sm = self._C.init_selection_map()
        self.selection_map = np.frombuffer(sm, dtype=bool)

        comm.comm_manager.register_plot(self.disp.canvas_id, self)

        self.disp.register_handler('resize', self._resize_handler)
        self.disp.register_handler('cell_fini', self._cell_fini_handler)
        self.disp.register_handler('zoom_req', self._zoom_req_handler)
        self.disp.register_handler('axis_req', self._axis_req_handler)
        self.disp.register_handler('tile_req', self._tile_req_handler)
        self.disp.register_handler('pt_req', self._pt_req_handler)
        self.disp.register_handler('search', self._search_handler)
        self.disp.register_handler('update_selection',
                                   self._update_selection_handler)

        self.disp.show()

    # Called when the canvas is ready or its size changes.
    def _resize_handler(self, canvas_id, msgtype, msg):
        data = msg['content']['data']
        width, height = data['w'], data['h']
        config_id = data.get('config_id', -1)
        zoom_level = data.get('zoom_level', 0)
        x_offset = data.get('x_offset', -1)
        y_offset = data.get('y_offset', -1)
        self._C.resize_handler(
            width, height, config_id, zoom_level, x_offset, y_offset)

    # Called by C++ code via callback mechanism.
    def _send_msg(self, json_data, data1, data2):
        logger.debug('Sending message to FE: %s', json_data)
        msgtype = json_data.pop('msg')

        if msgtype == 'tile':
            # Construct PNG file data.
            assert data1 is not None
            is_transparent = 'item_id' in json_data
            data1 = png_util.generate_png(data1, is_transparent)

            # Add label info.
            if is_transparent:
                item_id = json_data['item_id']
                json_data['label'] = self.labels[item_id]
                style, = self._get_figdata(item_id).get_label_styles([item_id])
                json_data['style'] = style

            # For debugging.
           #fn = 'tile-r%d-c%d.png' % (json_data['row'], json_data['col'])
           #with open(fn, 'wb') as f:
           #    f.write(data1)

            logger.debug('PNG data created %d bytes', len(data1))

        if msgtype == 'new_canvas_config':
            # This isn't clean, but we want to have the same API as inside
            # _axis_req_handler(), and we can't call _C.get_canvas_config() here
            # because we're being called from C++ code: so we already hold
            # Plotter::m_ here.
            canvas_config = _csrc.CanvasConfig(
                json_data['config_id'], json_data['w'], json_data['h'],
                float(json_data['x0']), float(json_data['y0']),
                float(json_data['x1']), float(json_data['y1']))
            axis_util.create_labels(json_data, canvas_config, 0, self.axis_config)
            logger.debug('Added axis data to message: %s', json_data)

        comm.comm_manager.send(
            self.disp.canvas_id, msgtype,
            attachments=[x for x in (data1, data2) if x is not None],
            **json_data)

    # Called when the canvas is no longer in use.
    def _cell_fini_handler(self, canvas_id, msgtype, msg):
        logger.info('Destroying cell %s ...', canvas_id)
        comm.comm_manager.deregister_handler(canvas_id)
        self._C = None

    def _zoom_req_handler(self, canvas_id, msgtype, msg):
        msgdata = msg['content']['data']
        self._C.zoom_req_handler(
            msgdata['config_id'], msgdata['zoom_level'],
            msgdata['x0'], msgdata['y0'], msgdata['x1'], msgdata['y1'])

    def _axis_req_handler(self, canvas_id, msgtype, msg):
        # For "axis_req", we don't have a C++ handler: we use `axis_util` to
        # generate reply here.
        msgdata = msg['content']['data']
        config_id = msgdata['config_id']

        canvas_config = self._C.get_canvas_config(config_id)
        if canvas_config.id != config_id:
            logger.warn('_axis_req_handler: unknown config_id %d, ignored!',
                        config_id)
            return

        json_data = {
            'config_id': msgdata['config_id'],
            'axis_seq': msgdata['axis_seq'],
            'x_offset': msgdata['x_offset'],
            'y_offset': msgdata['y_offset'],
        }
        axis_util.create_labels(
            json_data, canvas_config, msgdata['zoom_level'], self.axis_config)

        comm.comm_manager.send(
            self.disp.canvas_id, 'axis_ticks', **json_data)

    # Called when FE needs more tiles.
    def _tile_req_handler(self, canvas_id, msgtype, msg):
        msgdata = msg['content']['data']
        # logger.info('Received tile req: %s', msgdata)

        ack_seqs = msgdata['ack_seqs']
        if len(ack_seqs) > 0: self._C.acknowledge_seqs(ack_seqs)

        # Given a list of coordinates such as ['0:1:100', '0:2:101'], transform
        # it into a simple list of integers, i.e., [0, 1, 100, 0, 2 101].
        def _flatten(coords):
            retval = []
            for coord in coords:
                row, col, seq_no = coord.split(':')
                retval += [int(row), int(col), int(seq_no)]
            return retval

        def _call_cpp_handler(item, item_id):
            self._C.tile_req_handler(
                msgdata['config_id'], msgdata['zoom_level'],
                item.get('id', -1), _flatten(item['prio']), _flatten(item['reg']))

        # Call the C++ handler for each item in the request.
        for item in msgdata['items']:
            if 'id' in item:
                assert 'version' not in item
                self._tile_req_helper(msgdata, item)
                continue

            # Regular tile request (e.g., after selection update): check if the
            # request version is newer than the version we currently know.
            req_version = item['version']

            with self.selection_map_lock:
                curr_version = self._C.sm_version
                if req_version > curr_version:
                    self.ooo_tile_reqs[req_version].append((msgdata, item))
                    continue

            self._tile_req_helper(msgdata, item)

    # Find the point nearest to the given screen coordinate.
    def _pt_req_handler(self, canvas_id, msgtype, msg):
        msgdata = msg['content']['data']
        config_id = msgdata['config_id']
        item_id = msgdata['item_id']

        canvas_config = self._C.get_canvas_config(config_id)
        resp = self._get_figdata(item_id).get_nearest_pt(
            self,
            canvas_config, msgdata['zoom_level'],
            msgdata['x_offset'], msgdata['y_offset'],
            msgdata['mouse_x'], msgdata['mouse_y'],
            item_id)
        if resp is None: return

        # Echo back the request parameters.
        for key in ('config_id zoom_level x_offset y_offset '
                    'mouse_x mouse_y item_id').split():
            resp[key] = msgdata[key]

        comm.comm_manager.send(self.disp.canvas_id, 'pt', **resp)

    def _search_handler(self, canvas_id, msgtype, msg):
        msgdata = msg['content']['data']

        # Also update selection: must be called *before* _search_labels()
        # because otherwise _search_labels() will return incorrect values for
        # `selected`!
        #
        # TODO: Currently we're calling _get_matching_ids() twice!
        if 'version' in msgdata:
            msgdata['how'] = 'exact'
            self._update_selection_handler(canvas_id, msgtype, msg)

        self._search_labels(msgdata)

    def _update_selection_handler(self, canvas_id, msgtype, msg):
        msgdata = msg['content']['data']
        new_version = msgdata['version']
        # logger.info('Received selection update: %s', msgdata)

        # Odd numbers are reserved to indicate SelectionMap being under update.
        assert new_version % 2 == 0, \
               'SelectionMap version should be even!'

        pending_tile_reqs = []

        with self.selection_map_lock:
            curr_version = self._C.sm_version
            assert new_version > curr_version, \
                   'Unexpected new version (%d) vs curr_version (%d)' % \
                   (new_version, curr_version)

            self.ooo_updates[new_version] = msgdata

            # Selection updates must be applied in order, so we check if the
            # version is in order.
            if new_version != curr_version + 2:
                logger.warning(
                    'Selection update received out of order: '
                    'expecting version %d, received %d',
                    curr_version + 2, new_version)
                return

            self._C.start_selection_update()

            while True:
                msgdata = self.ooo_updates.pop(curr_version + 2, None)
                if msgdata is None: break
                curr_version += 2
                assert msgdata['version'] == curr_version

                pending_tile_reqs += self.ooo_tile_reqs.pop(curr_version, [])

                how = msgdata['how']
                if 'ids' in msgdata:
                    item_ids = msgdata['ids']
                else:
                    assert 'pat' in msgdata and 'regex' in msgdata
                    item_ids = self._get_matching_ids(msgdata)

                if how == 'select':
                    self.selection_map[item_ids] = True
                elif how == 'deselect':
                    self.selection_map[item_ids] = False
                elif how == 'exact':
                    newmap = np.zeros(len(self.selection_map), dtype=bool)
                    newmap[item_ids] = True
                    self.selection_map[:] = newmap
                else:
                    assert None, 'Unknown command %s' % how

            self._C.end_selection_update(curr_version)

        # Call tile requests that were pending until the requested version was
        # reached.
        for msg, item in pending_tile_reqs:
            self._tile_req_helper(msg, item)

    # TODO: In the methods above, we use `msgdata` to the data sent by FE.
    #       Below, we're using `msg` - this is confusing!

    # Send back list of labels matching the given pattern.
    def _search_labels(self, msg):
        matching_ids = self._get_matching_ids(msg)
        count = len(matching_ids)
        matching_ids = matching_ids[:200]  # Only send back first 200 items.
        selected = self.selection_map[matching_ids].tolist()

        matching_labels = [self.labels[item_id] for item_id in matching_ids]
        styles = self._concat_over_fd(
            matching_ids, lambda fd, ids: fd.get_label_styles(ids))

        labels = list(zip(matching_ids, selected, matching_labels, styles))
        logger.debug('Sending message to FE: count=%d labels=%s', count, labels)
        comm.comm_manager.send(self.disp.canvas_id, 'labels',
                               count=count, labels=labels)

    # Helper function for generating the list of matching labels, given a
    # message containing 'pat' and 'regex'.
    def _get_matching_ids(self, msg):
        if msg['regex']:
            try:
                pat = re.compile(msg['pat'])
                return [
                    item_id for item_id, label in enumerate(self.labels)
                    if pat.search(label)
                ]
            except re.error:
                # TODO: Return error message?
                return []
        else:
            substr = msg['pat'].casefold()
            return [
                item_id for item_id, label in enumerate(self.lower_labels)
                if substr in label
            ]

    # Helper function to call C++ tile_req_handler().
    #
    # `msg` is a message of msgtype 'tile_req', and `item` is an element of
    # msg['items'].
    def _tile_req_helper(self, msg, item):
        # Given a list of coordinates such as ['0:1:100', '0:2:101'], transform
        # it into a simple list of integers, i.e., [0, 1, 100, 0, 2 101].
        def _flatten(coords):
            retval = []
            for coord in coords:
                row, col, seq_no = coord.split(':')
                retval += [int(row), int(col), int(seq_no)]
            return retval

        self._C.tile_req_handler(
            msg['config_id'], msg['zoom_level'],
            item.get('id', -1), _flatten(item['prio']), _flatten(item['reg']))

    # Helper function for finding a FigData that contains the given item.
    def _get_figdata(self, item_id):
        for fd in self.fig_data_list:
            start_item_id = fd.start_item_id
            end_item_id = start_item_id + fd.item_cnt
            if start_item_id <= item_id < end_item_id: return fd

        assert None, f'Invalid item_id {item_id}'

    # Helper function for calling a function on a bunch of FigData objects.
    # `item_ids` must be sorted.
    def _concat_over_fd(self, item_ids, f):
        pos = 0
        result = []
        for fd in self.fig_data_list:
            start_item_id = fd.start_item_id
            end_item_id = start_item_id + fd.item_cnt

            assert pos == len(item_ids) or item_ids[pos] >= start_item_id
                # Sanity check.

            next_pos = pos
            while next_pos < len(item_ids) and \
                  item_ids[next_pos] < end_item_id:
                next_pos += 1

            result += f(fd, item_ids[pos:next_pos])
            pos = next_pos

        return result

def plot(**kwargs):
    return Plotter(**kwargs)
