This directory contains scripts for building and testing Python packages.
(You probably don't need to look at this unless you're the package maintainer.
Yes, you - you know who I'm talking about.)

Currently there's no automatic release testing, CI/CD, or anything fancy:
everything is manual.

# Linux

Build the wheel by running this [build_linux.sh](build_linux.sh), for example:

```
./build_linux.sh 3.8 0.1.0 master
```

It will download the [manylinux](https://github.com/pypa/manylinux) docker
image, run a build script inside it, and create a Python wheel (`.whl`) package
file.  The filename looks like: `croquis-0.1.0-cp38-cp38-linux_x86_64.whl`.

You can create a test environment using conda.

```
conda create -n env38 python=3.8
conda activate env38
conda install notebook jinja2 numpy
pip install croquis-0.1.0-cp38-cp38-linux_x86_64.manylinux_2_12_x86_64.whl
```

# Mac OS

It seems like Anaconda's Python versions are built against Mac OS 10.9, which is
old enough for building a distributable package.  For example, Numpy (1.20.x)
uses the same target.

```
$ python -c 'from distutils.util import get_platform; print(get_platform())'
macosx-10.9-x86_64
```

So, you can run [build_macos.sh](build_macos.sh) inside conda environment -
it will create a temporary conda environment (`PKG38` below), download necessary
packages, and run the build inside it.  (It's not as "hermetic" as Linux since
it still uses the system C++ compiler, but I think this should be good enough
now.)

```
./build_macos.sh 3.8 PKG38 0.1.0 master
```

# Uploading package

Use [twine](https://twine.readthedocs.io/en/latest/) to upload packages to PyPI.
For testing in the "sandbox" (test.pypi.org), see
[these instructions at python.org](https://packaging.python.org/tutorials/packaging-projects/#uploading-the-distribution-archives).
That is:

`twine upload -r testpypi *.whl`

You will probably need to run it on least two machines, once to upload Linux
packages and again for Mac packages.  PyPI will automatically register them into
the correct place.  (That is, if you upload "version 0.1.0" three times, PyPI
will only show one "version 0.1.0", not three different versions.)  To check
whether all the packages were correctly registered, see
[https://test.pypi.org/simple/croquis/](https://test.pypi.org/simple/croquis/).

I don't know what happens if you upload the "same" file twice - maybe it will
overwrite the previous version?

Obviously, remove `-r testpypi` (and be extra careful) when you're ready to
upload the real thing.
