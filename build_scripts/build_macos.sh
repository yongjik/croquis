#!/bin/bash
#
# Build wheel files for Mac OS, using Anaconda.
#
# See: https://packaging.python.org/guides/packaging-binary-extensions/
#      https://github.com/MacPython/wiki/wiki/Spinning-wheels
#
# The `conda` command should be in PATH.
#
# How to use: build_linux.sh (python version) (conda env name to create) (package version) (git branch/tag)
# e.g.,       build_linux.sh 3.8 PKG38 0.1.0 master

if [[ $(uname -s) != "Darwin" ]]; then
    echo "This script is for Mac OS."
    exit 1
fi

set -o errexit
set -o pipefail
set -o xtrace

if [[ "$INSIDE_BUILD_ENV" != "Y" ]]; then
    root_dir=$(dirname "$0")/..
    py_version="$1"
    conda_env="$2"
    pkg_version="$3"
    git_tag="$4"

    if [[ "$py_version" == "" || "$conda_env" == "" || "$pkg_version" == "" || "$git_tag" == "" ]]; then
        set +o xtrace
        echo "How to use: build_linux.sh (python version) (conda env name to create) (package version) (git branch/tag)"
        echo "e.g.,       build_linux.sh 3.8 PKG38 0.1.0 master"
        exit 1
    fi

    conda run -n "$conda_env" true && {
        set +o xtrace
        echo "Conda environment $conda_env already exists."
        echo "Please specify a non-existent environment name!"
        echo "Or remove the environment by running: conda env remove -n $conda_env"
        exit 1
    }

    rm -rf .pkg_build || true
    mkdir .pkg_build

    # Create .zip file out of the whole source code.
    #
    # However, we copy a potentially "dirty" version of this script
    # (build_linux.sh) to run inside Docker, because otherwise it's just too
    # painful to debug this script itself.
    (
        cd "$root_dir"
        git archive --format=zip "$git_tag"
    ) > .pkg_build/croquis_src.zip
    cp "$0" .pkg_build

    conda create --yes -n "$conda_env" python="$py_version" cmake pybind11
    conda run -n "$conda_env" --no-capture-output \
        --cwd "$PWD/.pkg_build" \
        bash -c "mkdir build ; cd build ; unzip ../croquis_src.zip ;
                 INSIDE_BUILD_ENV=Y ../build_macos.sh \
                     '$py_version' '$pkg_version'"

else
    echo $PATH
    echo prefix = $CONDA_PREFIX

    # We're inside the build environment now.
    py_version="$1"  # E.g., "3.8"
    py_short_version=$(echo "$py_version" | sed -e 's/\.//')  # E.g., 38
    pkg_version="$2"

    python -V 2>&1 | grep -qF "Python $py_version" || {
        echo "Python version mismatch: expected $py_version, got $(python -V)"
        exit 1
    }

    # Now build!
    mkdir build.make
    cd build.make
    # We need -DPython3_FIND_VIRTUALENV=ONLY because otherwise CMake tries to
    # find other random Python versions hanging around in the system... -_-;;
    cmake -G'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release \
        -DPython3_FIND_VIRTUALENV=ONLY \
        ../src
    CR_PKG_VERSION="$pkg_version" make -j8 VERBOSE=1 wheel

    exit 0
fi

# We're back outside.
conda env remove -n "$conda_env"
pkg_file=$(find .pkg_build/build/dist -name "croquis-$pkg_version-*.whl")
cp "$pkg_file" .
rm -rf .pkg_build

set +o xtrace
echo "Created package file: "$(basename "$pkg_file")
