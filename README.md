# Croquis: plot graphs 100x faster on Jupyter Notebook

Croquis is a lightweight Python library for drawing interactive graphs *really
fast* on Jupyter Notebook.  It lets you effortlessly browse and examine much
larger data than other similar libraries.

As an example, here's hourly ground temperature data of 2020 from the world's
weather stations, downloaded from [NOAA website](https://www.ncdc.noaa.gov/isd/data-access).
The data set contains 127 million points.

XXX video should be here XXX

The word "croquis" means [a quick, sketchy drawing](https://en.wikipedia.org/wiki/Croquis) -
it's from French *croquis* which simply means "sketch."  (The final -s is
silent: it's French, after all.)

## Requirements

- 64-bit Linux/Mac OS running on x86 with
  [AVX2](https://en.wikipedia.org/wiki/Advanced_Vector_Extensions#CPUs_with_AVX2)
  instruction set support.  (Intel: Haswell (2013) or later; AMD: Excavator
  (2015) or later.)
  - Windows support is under work.
  - Sorry, other architectures aren't supported yet.
- Python 3.6 or later.
- Jupyter Notebook.
- A modern browser (if it can run Jupyter Notebook, it's probably fine).

## How to install

```
pip install croquis
```

For building from the source, see [DEVELOPMENT.md](DEVELOPMENT.md).

TODO: Add a few lines for starting.

XXX Buy me a coffee?

## Limitations

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
then please consider filing an issue.  (Of course I can't guarantee anything,
but it will be nice to know that someone's interested.)

## FAQ

### Is it really 100 times faster?

With large data, croquis can be *several hundred times* faster than other
popular libraries.  With very small data, there's less difference, as fixed-size
overheads start to dominate.

### Can we use it outside of Jupyter Notebook?

No, croquis is currently tied to Jupyter's message passing architecture, and all
computation is done in the backend, so it needs an active Jupyter Python
kernel.

### How does it work?

Unlike most other similar libraries, croquis works by running a C++ "tile
server," which computes fixed-sized "tiles" which is then sent back to the
browser.  If you have used Google Maps, the idea should be familiar.  This has
an important advantage:

- The browser only has to know about tiles.  Hence, the size of the data the
  browser needs to know is independent of the data set size.

As a result, the browser stays lean and "snappy" even with massive data.
(Croquis even supports `copy_data=False` option that eliminates data copies
altogether.)

Moreover, unlike the browser's single-threaded javascript code, the C++-based
tile server can draw multiple tiles in parallel, which allows even more speedup.

(On the other hand, there are drawbacks - we have to basically re-implement every
graph drawing algorithm inside this tile server, not being able to use any
javascript API, except for very trivial things like coordinate grids.)

XXX need a small "manual" here!
