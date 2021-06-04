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
