# Building from the source

The following should work on Linux and Mac OS.  (Other OS's are not supported yet.)

## Prerequisites

In order to build, you need CMake and
[pybind11](https://pybind11.readthedocs.io/en/stable/index.html).
You can install pybind11 by:

```
# If you're using conda:
conda install pybind11

# Otherwise:
pip3 install pybind11
```

## Building the wheel package

```
cd (croquis top level directory)
# Any directory name will do, except for "build", because setup.py uses it.
mkdir build.make
cd build.make
cmake -G'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release ../src
make -j8 VERBOSE=1 wheel
```

If you want to use a different compiler, add the compiler path to CMake argument
(e.g., `-DCMAKE_CXX_COMPILER=/usr/local/bin/clang++`).

If you want to use [Ninja](https://ninja-build.org/):

```
cd (croquis top level directory)
mkdir build.ninja
cd build.ninja
cmake -GNinja -DCMAKE_BUILD_TYPE=Release ../src
ninja -v wheel
```

After that, wheel file is available in the `dist` directory:

```
cd (top level directory)/dist
pip3 install croquis-0.1.0-cp39-cp39-linux_x86_64.whl  # Or something similar.
```

## Testing at the source tree

If you want to fiddle around, you can just build the C++ shared library by
omitting `wheel` from the build commands.  I.e.,

```
cd (croquis top level directory)
mkdir build.make
cd build.make
cmake -G'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release ../src
make -j8 VERBOSE=1
ls ../src/croquis/lib
# Will see something like: _csrc.cpython-39-x86_64-linux-gnu.so
```

Use `-DCMAKE_BUILD_TYPE=Debug` to build in Debug mode; use `make check` to run
tests (there aren't many).

Now you can simply add `src` directory to your Python import path and do:

```
import croquis
```

In this way, croquis is working in the "dev environment", which will slightly
tweak operations to (hopefully) make life easier:

* We reload js/css file every time you restart the kernel.
* Python/C++ code will leave logging on `dbg.log` (under the current directory).
