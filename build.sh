#!/bin/bash

set -o errexit
set -o pipefail

mode=wheel
build_type=Release
compiler=clang++
builder=ninja
build_isolation=yes

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
    elif [[ "$1" == "clean" ]]; then
        mode=clean
        shift
    elif [[ "$1" == "-e" ]]; then
        mode=editable
        shift
    elif [[ "$1" == "--no-build-isolation" ]]; then
        build_isolation=no
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
    if [[ "$mode" == "clean" ]]; then
        npm run clean
    elif [[ "$mode" == "editable" ]]; then
        npm run build
    elif [[ "$mode" == "wheel" ]]; then
        npm run build:prod
    else
        echo "Invalid mode $mode"
        exit 1
    fi
    popd
}

build_cxx () {
    if [[ "$mode" == "clean" ]]; then
        rm -rf build.make/
        rm -rf build.ninja/
        rm -rf src/croquis/lib/_csrc*.so
    elif [[ "$builder" == "make" ]]; then
        mkdir -p build.make
        pushd build.make
        cmake -G"Unix Makefiles" -DCMAKE_CXX_COMPILER=$cxx \
              -DCMAKE_BUILD_TYPE=$build_type \
              ../src
        make -j8 VERBOSE=1 "$@"
        popd
    elif [[ "$builder" == "ninja" ]]; then
        mkdir -p build.ninja
        pushd build.ninja
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
    if [[ "$mode" == "clean" ]]; then
        rm -rf src/croquis/labextension
        rm -rf src/croquis/lib/_csrc*
    elif [[ "$mode" == "editable" ]]; then
        if [[ "$build_isolation" == "yes" ]]; then
            pip install -e .
        else
            build_scripts/check_version.py hatchling 1.27.0
            build_scripts/check_version.py pybind11
            build_scripts/check_version.py editables
            pip install --no-build-isolation -e .
        fi
        CROQUIS_UNITTEST=1 jupyter labextension develop . --overwrite

        # Update sourcemap so that breakpoints work on vscode.
        python misc/fix_sourcemap.py \
            src/croquis/labextension/static \
            'webpack://croquis-js/' \
            src/js
    else
        rm -rf dist/
        hatch build -t wheel

        set +o xtrace

        if $(ls dist/*.whl >/dev/null 2>&1); then
            echo "Wheel file generated as:" $(ls dist/*.whl)
        else
            echo "Cannot find wheel file !!!"
            exit 1
        fi

        set -o xtrace
    fi
}

set -o xtrace

cd $(dirname $0)
build_js
build_cxx
build_py
