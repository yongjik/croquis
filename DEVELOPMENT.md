# Building from the source

The following should work on x86 (64-bit) Linux.  (It also used to work on x86
Mac OS, but since they're rarely used these days, I decided to not update the
build script for them.  Some day I may add support for ARM-based Mac OS ...)

## Prerequisites


In order to build, you need [CMake](https://cmake.org/install/),
[npm](https://www.npmjs.com/),
[jupyterlab](https://jupyterlab.readthedocs.io/en/latest/),
[hatch](https://hatch.pypa.io/latest/), and
[pybind11](https://pybind11.readthedocs.io/en/stable/index.html).

Also I recommend using [Ninja](https://ninja-build.org/), though you can use
plain `make` instead, if you prefer.

You can install the necessary python dependencies by:

```
pip install pybind11 jupyterlab hatch
```

## Building the wheel package

The build script (`build.sh`) is a simple bash script that calls typescript,
C++, and python build scripts in order.  (It seemed easier that way.)

```
cd (croquis top level directory)
./build.sh

# To clean everything
./build.sh clean

# To use g++ instead of clang++ (default)
./build.sh gcc

# To use make instead of ninja
./build.sh make

# To build the C++ library in debug mode
./build.sh Debug
```

After that, wheel file is available in the `dist` directory:

```
cd (top level directory)/dist
pip3 install croquis-0.2.0-cp39-cp39-linux_x86_64.whl  # Or something similar.
```

## Editable install (testing at the source tree)

For development, you can do the equivalent of `pip install -e .` by:

```
cd (croquis top level directory)
pip install editables  # needed for --no-build-isolation
./build.sh -e --no-build-isolation

# Or, if you prefer to use make instead of ninja:
./build.sh -e --no-build-isolation make
```

Option `--no-build-isolation` is optional, but you might prefer it, because the
build script does not do proper build isolation anyway.  (npm and cmake build
steps look for python libraries installed in the current python environment.)

Currently there are only a minimal number of tests.  You can run them by:

```
# C++ tests
cd (croquis top level directory)
cd build.ninja  # or build.make
ninja check     # or "make check"

# Python tests
pip install pytest
cd (croquis top level directory)
pytest src/croquis/tests

# UI integration tests
pip install playwright
cd (croquis top level directory)
cd src/ui_tests
./run_all_tests.py
./run_all_tests.py --browser=firefox
./run_all_tests.py --browser=webkit
```

With editable installs, croquis is in the "dev environment": it will log more
stuff onto console and a file named `dbg.log` under the current directory.

## Packaging

Python packaging is the dark underside of an otherwise great language that
nobody speaks of in broad daylight.  There's no need for **you** to know
anything about it, as long as you want to just use croquis (or even modify and
develop it!) - honestly I'm not sure if *I* understand it correctly.

However, since I had trouble figuring it out, I wrote some
[helper scripts and notes](build_scripts/README.md), in the hopes that it may be
useful to future myself, or any other aspiring Pythonista who's thinking of
building and distributing their own wonderful Python package.

(Warning: as of July 2025, the build doc is not up to date!)

## IDE integration

Here are some [personal notes](doc/vscode.md) for using VS code (work in progress).
