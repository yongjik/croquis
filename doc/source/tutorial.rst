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

.. image:: images/tutorial1-first.png

The size of the graph will automatically adjust to match the browser window.
(Sorry, currently there's no option to manually modify graph dimension.)

Adding multiple lines at once
-----------------------------

While the previous code works, it's not the most efficient way to handle large
data.  If your data is already in a rectangular block, you can add them at
once::

    fig = croquis.plot()

    X = np.linspace(0, 2 * np.pi, 200)
    freqs = np.linspace(0, 1, 100).reshape(100, 1)
    Y = np.sin(freqs * X)  # matrix of size 100 x 200
    fig.add(X, Y, labels=['freq=%.2f' % f for f in freqs])

    fig.show()

This will show 100 pieces of sine waves, each with a different frequency.

.. image:: images/tutorial2-multiple-lines.png

