Croquis: a fast plotting library for Jupyter Notebook
=====================================================

(This page is under construction: please look at github page for now.)

Croquis is a lightweight Python library for drawing interactive graphs *really
fast* on Jupyter Notebook.  It lets you effortlessly browse and examine much
larger data than other similar libraries.

..
    Hmm how do I include a figure here ...

**Install croquis by running:**

.. code-block:: bash

    pip install croquis

For installing from the source code, please look at
:githublink:`DEVELOPMENT.md <DEVELOPMENT.md>`.

Though still experimental, croquis is ruthlessly optimized for speed: it will
effortlessly draw a graph involving a hundred million points, while being fully
interactive inside your browser.  Moreover, because the graph is drawn inside a
multi-threaded C++ engine (called by the Python backend), the browser does not
need to keep the plotting data, which means that the browser remains as snappy
as ever regardless of how much data you have.

The word "croquis" means `a quick, sketchy drawing <https://en.wikipedia.org/wiki/Croquis>`_ -
it's from French *croquis* which simply means "sketch."  (The final -s is
silent: it's French, after all.)

Requirements
------------

- 64-bit Linux/Mac OS running on x86 with
  `AVX2 <https://en.wikipedia.org/wiki/Advanced_Vector_Extensions#CPUs_with_AVX2>`_
  instruction set support.  (Intel: Haswell (2013) or later; AMD: Excavator
  (2015) or later.)

  - Sorry, other architectures aren't supported yet.
  - In particular, Windows and ARM (e.g., Apple M1) architectures are not
    supported yet.

- Python 3.6 or later.
- Jupyter Notebook.
- A modern browser (if it can run Jupyter Notebook, it's probably fine).

Limitations
-----------

Croquis is still experimental: as of version 0.1, we only support the **absolute
bare minimum** functionality.  In particular:

- Only line plots are supported, nothing else: no bars, pie charts, heatmaps, etc.
- All lines are solid: no dotted/dashed lines.
- All markers are solid circles: no other shapes are currently supported.
- No subplots: each Jupyter cell can contain only one graph.
- Very few options to customize the plot.  No titles, axis labels, or secondary axes.
- No support for mobile browsers.
- No dark mode.
- As you can see, the UI is rather primitive.

If croquis seems useful to you, but some features are missing for your use case,
then please feel free to file an issue.  (Of course I can't guarantee anything,
but it will be nice to know that someone's interested.)

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   tutorial
   ui
   faq

..
   TODO: add this?
         add more reference !!
   autofunction:: croquis.plot

Indices and tables
------------------

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
