#!/bin/bash

set -o errexit
set -o pipefail

mode=install
build_type=Release
compiler=clang++
builder=ninja

while true; do
    if [[ "$1" == "Debug" ]]; then
        build_type=Debug
        shift
    elif [[ "$1" == "RelWithDebInfo" ]]; then
        build_type=RelWithDebInfo
        shift
    elif [[ "$1" == "gcc" ]]; then
        compiler=g++
        shift
    elif [[ "$1" == "make" ]]; then
        builder=make
        shift
    elif [[ "$1" == "ninja" ]]; then
        builder=ninja
        shift
    elif [[ "$1" == "-e" ]]; then
        mode=editable
        shift
    else
        break
    fi
done

cxx=$(which $compiler)
echo "mode=$mode build_type=$build_type cxx=$cxx builder=$builder"

build_js () {
    pushd src/js
    if [ -d node_modules ]; then
        echo "We already have node_modules directory, skipping 'npm install' ..."
        echo "Please run 'npm install' manually if you want to update node dependency."
    else
        npm install
    fi
    npm run build
    popd
}

build_cxx () {
    if [[ "$builder" == "make" ]]; then
        mkdir -p build.make
        pushd build.make
        cmake -G"Unix Makefiles" -DCMAKE_CXX_COMPILER=$cxx \
              -DCMAKE_BUILD_TYPE=$build_type \
              ../src
        make -j8 VERBOSE=1 "$@"
        popd
    elif [[ "$builder" == "ninja" ]]; then
        mkdir -p build.ninja
        cd build.ninja
        cmake -GNinja -DCMAKE_CXX_COMPILER=$cxx \
              -DCMAKE_BUILD_TYPE=$build_type \
              ../src &&
        ninja -v "$@"
        popd
    else
        echo "Unknown builder $builder"
        exit 1
    fi
}

build_py () {
    if [[ "mode" == "editable" ]]; then
        pip install --no-build-isolation -e .
        jupyter labextension develop . --overwrite

        # Update sourcemap so that breakpoints work on vscode.
        python misc/fix_sourcemap.py \
            src/myjext/labextension/static \
            'webpack://myjext-js/' \
            src/js
    else
        # TODO: what now?
        print "Non-development not supported yet!"
        exit 1
    fi
}

set -o xtrace

cd $(dirname $0)
build_js
build_cxx
build_py
