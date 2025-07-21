#!/bin/bash
#
# Build wheel files for Linux, using the "manylinux" docker image.
#
# See: https://packaging.python.org/guides/packaging-binary-extensions/
#      https://github.com/pypa/manylinux
#
# How to use: build_linux.sh (python version) (git branch/tag)
# e.g.,       build_linux.sh 3.8 master

set -o errexit
set -o pipefail
set -o xtrace

if [[ "$INSIDE_DOCKER" != "Y" ]]; then
    root_dir=$(dirname "$0")/..
    cache_dir=$(dirname "$0")/docker-build-cache
    py_version="$1"
    git_tag="$2"
    docker_container_name="crbuild-$py_version"

    if [[ "$py_version" == "" || "$git_tag" == "" ]]; then
        set +o xtrace
        echo "How to use: build_linux.sh (python version) (package version) (git branch/tag)"
        echo "e.g.,       build_linux.sh 3.8 0.1.0 master"
        exit 1
    fi

    rm -rf .pkg_build || true
    mkdir .pkg_build

    if [[ ! -d "$cache_dir" ]]; then
        mkdir -p "$cache_dir"
        echo "Cache directory for build_linux.sh; safe to remove." > "$cache_dir"/README
    fi

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

    # Let's use manylinux_2_28: says it should support Ubuntu 18.10+, which
    # should be good enough.
    docker rm "$docker_container_name" || true
    docker pull quay.io/pypa/manylinux_2_28_x86_64
    docker run --name "$docker_container_name" \
        --mount type=bind,src="$PWD/.pkg_build",dst=/mnt/bind \
        --mount type=bind,src="$cache_dir",dst=/root/.cache \
        quay.io/pypa/manylinux_2_28_x86_64:latest \
        bash -c "mkdir /build ; cd /build ; unzip /mnt/bind/croquis_src.zip ;
                 INSIDE_DOCKER=Y /mnt/bind/build_linux.sh '$py_version'"

else
    # We're inside docker now.
    py_version="$1"  # E.g., "3.8"
    py_short_version=$(echo "$py_version" | sed -e 's/\.//')  # E.g., 38

    # Directory names looks like: /opt/python/cp36-cp36m. /opt/python/cp310-cp310,
    # etc.
    #
    # Hmm not sure why globbing doesn't work, but let's use `find` ...
    pypath=$(find /opt/python -name "cp${py_short_version}-*")/bin
    export PATH="$pypath":"$PATH"

    # Set up shared cache directory.
    mkdir -p /root/.cache/pip \
             /root/.nvm \
             /root/.cache/nvm \
             /root/.cache/npm
    ln -sf /root/.cache/nvm /root/.nvm/.cache

    # Install necessary components.
    pip3 install pybind11 jupyterlab hatch

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    set +o xtrace
    . $NVM_DIR/nvm.sh
    nvm install node
    set -o xtrace

    npm config set cache /root/.cache/npm

    # Now build!
    cd /build
    ./build.sh gcc make

    # Add manylinux tags to the package.
    auditwheel repair dist/croquis-*.whl
    cp wheelhouse/croquis-*.whl /mnt/bind/

    exit 0
fi

# We're back outside.
docker container rm "$docker_container_name"
pkg_file=$(find .pkg_build -name "croquis-*.whl")
cp "$pkg_file" .
rm -rf .pkg_build

set +o xtrace
echo "Created package file: "$(basename "$pkg_file")
