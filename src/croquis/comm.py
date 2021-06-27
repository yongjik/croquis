# Communications support: see
#   https://jupyter-notebook.readthedocs.io/en/stable/comms.html

import collections
import logging
import uuid
import weakref

logger = logging.getLogger(__name__)

# Create a unique UUID so that FE can find out when BE restarts.
BE_uuid = str(uuid.uuid4())

class CommManager(object):
    def __init__(self):
        self.is_open = False
        self.comm = None

        self.plots = {}

        # handlers[canvas_id][msgtype] = weakref.WeakMethod(callback)
        self.handlers = collections.defaultdict(dict)

    # Called only if we're inside IPython: otherwise obviously there's no
    # communications channel!
    def open(self):
        logger.info('Opening communication channel ...')
        assert not self.is_open, 'Already opened!'
        get_ipython().kernel.comm_manager.register_target(
            'croquis', self._open_handler)
        self.is_open = True

    # Register a Plotter object so that it's not garbage-collected when the user
    # loses the reference to it - which is quite common because people will just
    # reuse the variable `fig` in different cells.
    def register_plot(self, canvas_id, plot):
        self.plots[canvas_id] = plot

    # Register a handler for message received from FE.  The callback is called
    # with `canvas_id`, `msgtype`, and json contents of the message.
    #
    # I'm not sure if I have to worry, but to make sure that objects are
    # properly garbage collected, we assume `callback` is a "bound method" and
    # create a weak reference to it, so that we don't accidentally hold a
    # reference to the underlying object.
    #
    # For sending messages out, see thr_manager.register_cpp_callback().
    def register_handler(self, canvas_id, msgtype, callback):
        ref = weakref.WeakMethod(callback)
        if msgtype in self.handlers[canvas_id]:
            logger.warn('Handler already registered for %s (%s) ...',
                        canvas_id, msgtype)
        self.handlers[canvas_id][msgtype] = ref

    # if `msgtype` is None, deregister the whole cell.
    def deregister_handler(self, canvas_id, msgtype=None):
        if msgtype is None:
            del self.handlers[canvas_id]
            del self.plots[canvas_id]
        else:
            del self.handlers[canvas_id][msgtype]

    # Send a message.  `attachments` is an optional list of memoryview objects
    # (or some objects that supports the buffer protocol).
    def send(self, canvas_id, msgtype, attachments=None, **kwargs):
        kwargs.update(canvas_id=canvas_id, msg=msgtype)
        if attachments is not None:
            if attachments == []:
                attachments = None
            elif type(attachments) != list:
                attachments = [attachments]
        logger.debug('CommManager.send() sending message: %s', kwargs)
        self.comm.send(kwargs, buffers=attachments)

    # Handler for the initial message.
    def _open_handler(self, comm, open_msg):
        logger.debug('Initial open packet received from client: ', open_msg)
        self.comm = comm

        comm.on_msg(self._msg_handler)

        logger.debug('Sending BE_ready packet ...')
        logger.debug(type(comm))
        comm.send({'msg': 'BE_ready'})
        logger.debug('Sent BE_ready packet ...')

    # Handler for all subsequent messages.
    # See also ThrManager._callback_entry_point().
    def _msg_handler(self, msg):
        logger.debug('Data received from client: %s', msg)
        try:
            data = msg['content']['data']
            canvas_id = data['canvas_id']
            msgtype = data['msg']
        except KeyError:
            logger.error('Malformed message: %s', msg)
            return

        if canvas_id not in self.handlers:
            logger.warning('Unrecognized canvas_id %s', canvas_id)
            return

        if msgtype not in self.handlers[canvas_id]:
            logger.warning('Missing handler for canvas_id=%s, msgtype=%s',
                           canvas_id, msgtype)
            return

        callback = self.handlers[canvas_id][msgtype]
        cb = callback()
        if cb is None:
            logger.warning('Handler gone for canvas_id=%s, msgtype=%s',
                           canvas_id, msgtype)
            del self.handlers[canvas_id][msgtype]
            return

        cb(canvas_id, msgtype, msg)

comm_manager = CommManager()
