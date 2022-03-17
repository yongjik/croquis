FAQ
===

How fast is it compared to other libraries?
-------------------------------------------

With large data, croquis can be *a hundred times* faster than other popular
libraries: see the following measurement of drawing *N* lines, each with 1,000
points.

+------------------+----------------------------------------------+--------------+
| Library          | time to draw [2]_                            | interactive? |
|                  +----------------------------------------------+              |
|                  | # lines (# points)                           |              |
|                  +-----------+-----------+-----------+----------+              |
|                  | 1K (1M)   |  5K (5M)  | 10K (10M) | 100K     |              |
|                  |           |           |           | (100M)   |              |
+==================+===========+===========+===========+==========+==============+
| **croquis** [1]_ | **0.31s** | **0.41s** | **0.71s** | **6.5s** | ✅           |
+------------------+-----------+-----------+-----------+----------+--------------+
| `bokeh`_ [1]_    | 2.4s      | 11s       | 21s       |          | ✅           |
+------------------+-----------+-----------+-----------+----------+--------------+
| `plotly`_        | 15s       | 81s       | (fails)   |          | ✅           |
+------------------+-----------+-----------+-----------+----------+--------------+
| `matplotlib`_    | 1.2s      | 5.5s      | 11s       | 100+s    | ❌           |
+------------------+-----------+-----------+-----------+----------+--------------+

.. _bokeh: https://bokeh.org/
.. _plotly: https://plotly.com/python/
.. _matplotlib: https://matplotlib.org/

.. [1] For croquis and bokeh, we used a batch API to add all lines at once,
       which is generally faster than adding lines one by one in a loop.  For
       croquis, if we *do* add lines one by one, the durations increase to
       0.33/0.58/1.2/11 seconds.

.. [2] Running on Chrome on a Linux box with AMD 1700X (8 cores) and 32GB RAM;
       duration is from the start of the jupyter cell execution (ctrl+Enter)
       until the figure is complete.

(With very small data, there's less difference, as fixed-size overheads start to
dominate.)

Can we use it outside of Jupyter Notebook?
------------------------------------------

No, croquis is currently tied to Jupyter's message passing architecture, and all
computation is done in the backend, so it needs an active Jupyter Python
kernel.

How does it work?
-----------------

Unlike most other similar libraries, croquis works by running a C++ "tile
server," which computes fixed-sized "tiles" which is then sent back to the
browser.  If you have used Google Maps, the idea should be familiar.  This has
an important advantage:

- The browser only has to know about tiles.  Hence, the size of the data the
  browser needs to know is independent of the data set size.

As a result, the browser stays lean and "snappy" even with massive data.
(As explained in the reference, we support ``copy_data=False`` option that even
eliminates data copies altogether.)

..
    TODO: change "reference" above to the proper reference !!

Moreover, unlike the browser's single-threaded javascript code, the C++-based
tile server can draw multiple tiles in parallel, which allows even more speedup.

(On the other hand, there are drawbacks - we have to basically re-implement every
graph drawing algorithm inside this tile server, not being able to use any
javascript API, except for very trivial things like coordinate grids.)
