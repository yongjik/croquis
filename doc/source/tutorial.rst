Getting started with croquis
============================

Creating a graph involves the following three steps:

1. Create a figure object: ``fig = croquis.plot(...)``
2. Add one or more lines: ``fig.add(x, y, ...)``
3. Generate the figure: ``fig.show()``

Step 2 can be repeated as many times as you want: the first two arguments must
always be X and Y coordinates; the rest are options.  Now let's see some
examples.

Adding multiple lines, one by one
---------------------------------

Please paste into a Jupyter cell::

    import croquis
    import numpy as np

    fig = croquis.plot()

    for fn in np.sin, np.cos, np.tanh:
        X = np.linspace(-5, 5, 100)
        Y = fn(X)
        fig.add(X, Y, label=fn.__name__)

    fig.show()

.. image:: images/tutorial1.png

