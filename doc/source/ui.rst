The user interface
==================

Let's look at the UI elements in the figure.

Zoom and pan
------------

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

Search and selection
--------------------

Croquis lets you interactively select/deselect a large number of items based on
labels.  As an example, let's try the temperature data of weather stations in
California and Hawaii during February 2020 [1]_::

    import os
    import croquis
    import pandas as pd

    csv_filename = 'CA_HI_Feb2020.csv.gz'
    if not os.path.exists(csv_filename):
        import urllib.request
        urllib.request.urlretrieve(
            'https://raw.githubusercontent.com/yongjik/croquis-extra/master/noaa_temperature_data/CA_HI_Feb2020.csv.gz',
            csv_filename)

    fig = croquis.plot(x_axis='timestamp')
    fig.add(pd.to_datetime(df.timestamp, unit='s'), df.temperature, groupby=df.name)
    fig.show()

.. image:: images/sel1-initial.png

.. [1] The data was derived from hourly temperature data archives, downloaded
       from `NOAA website <https://www.ncdc.noaa.gov/isd/data-access>`_.

You can hover your mouse cursor over the plot, and the corresponding line will
be highlighted with its label and the nearest coordinate:

.. image:: images/sel2-tooltip.png

By default, the search box is in the "autoselect" mode: what you search is ...




