The user interface
==================

Let's revisit :ref:`the simple graph example <Tutorial1>` in the tutorial::

    import croquis
    import numpy as np

    fig = croquis.plot()

    for fn in np.sin, np.cos, np.tanh:
        X = np.linspace(-5, 5, 100)
        Y = fn(X)
        fig.add(X, Y, label=fn.__name__)

    fig.show()

.. image:: images/tutorial1-first.png

Zoom and pan
------------

If **zoom** is selected on the upper right corner, you can drag and select a
rectangular area:

.. image:: images/ui1-zoom.png

The selected area will be zoomed:

.. image:: images/ui2-zoom.png

You can also use the magnifier (🔍) buttons to zoom in/out, or use the 🏠
**Reset** button to return to the initial state.

If you select **pan** on the upper right corner, then you can drag the plot
around with the mouse:

.. image:: images/ui3-pan.png

Selection
---------

Croquis lets you select/deselect a large number of items ...
