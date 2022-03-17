#!/bin/bash
#
# This script is called by conf.py if we're running inside readthedocs docker
# container - we have to build the library ourselves.
#
# Yes, this is ugly, but the build itself is still pretty fast, so let's try
# this.  (If building the whole package starts to take more than a few minutes
# then we will have to figure out a better solution.)

set -o errexit
set -o pipefail
set -o xtrace

topdir=$(dirname "$0")/../..

cd "$topdir"
npm install -g webpack webpack-cli terser
playwright install chromium

mkdir -p build.make
cd build.make
cmake -G'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release ../src
make -j8 doc_images

echo "Build successful!"

mv doc/source/images/ ../doc/source
