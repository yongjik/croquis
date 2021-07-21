#!/bin/bash
#
# Build wheel files for Linux, using the "manylinux" docker image.
#
# See: https://packaging.python.org/guides/packaging-binary-extensions/
#      https://github.com/pypa/manylinux
#
# How to use: build_linux.sh (python version) (package version) (git branch/tag)
# e.g.,       build_linux.sh 3.8 0.1.0 master

set -o errexit
set -o pipefail
set -o xtrace

if [[ "$INSIDE_DOCKER" != "Y" ]]; then
    root_dir=$(dirname "$0")/..
    py_version="$1"
    pkg_version="$2"
    git_tag="$3"
    docker_container_name="crbuild-$pkg_version-$py_version"

    if [[ "$py_version" == "" || "$pkg_version" == "" || "$git_tag" == "" ]]; then
        set +o xtrace
        echo "How to use: build_linux.sh (python version) (package version) (git branch/tag)"
        echo "e.g.,       build_linux.sh 3.8 0.1.0 master"
        exit 1
    fi

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

    # We now need node.js, which doesn't work on manylinux2010, so let's use
    # manylinux2014.
    #
    # (Well, we could try running node.js *outside* of Docker, and just copy the
    # js bundle file into Docker, but that's a lot of work, and I'm not sure if
    # anyone actually needs it ...)
    docker rm "$docker_container_name" || true
    docker pull quay.io/pypa/manylinux2014_x86_64
    docker run --name "$docker_container_name" \
        --mount type=bind,src="$PWD/.pkg_build",dst=/mnt/bind \
        quay.io/pypa/manylinux2014_x86_64:latest \
        bash -c "mkdir /build ; cd /build ; unzip /mnt/bind/croquis_src.zip ;
                 INSIDE_DOCKER=Y /mnt/bind/build_linux.sh \
                     '$py_version' '$pkg_version'"

else
    # We're inside docker now.
    py_version="$1"  # E.g., "3.8"
    py_short_version=$(echo "$py_version" | sed -e 's/\.//')  # E.g., 38
    pkg_version="$2"

    # Directory names looks like: /opt/python/cp36-cp36m. /opt/python/cp310-cp310,
    # etc.
    #
    # Hmm not sure why globbing doesn't work, but let's use `find` ...
    pypath=$(find /opt/python -name "cp${py_short_version}-*")/bin
    export PATH="$pypath":"$PATH"

    # Install necessary components.
    pip3 install pybind11

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    set +o xtrace
    . $NVM_DIR/nvm.sh
    nvm install node
    set -o xtrace
    npm install -g webpack webpack-cli terser

    # Now build!
    mkdir -p /build/build.make
    cd /build/build.make
    cmake -G'Unix Makefiles' -DCMAKE_BUILD_TYPE=Release ../src
    CR_PKG_VERSION="$pkg_version" make -j8 VERBOSE=1 wheel

    # cp ../dist/croquis-$pkg_version-*.whl /mnt/bind/

    # Add manylinux tags to the package.
    auditwheel repair ../dist/croquis-$pkg_version-*.whl
    cp wheelhouse/croquis-$pkg_version-*.whl /mnt/bind/

    exit 0
fi

# We're back outside.
docker container rm "$docker_container_name"
pkg_file=$(find .pkg_build -name "croquis-$pkg_version-*.whl")
cp "$pkg_file" .
rm -rf .pkg_build

set +o xtrace
echo "Created package file: "$(basename "$pkg_file")
