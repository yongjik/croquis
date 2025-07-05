#!/usr/bin/env python
#
# Auxiliary script to check installed package version.

import importlib.metadata
import sys
from packaging.version import Version

def main():
    package_name = sys.argv[1]
    min_version = sys.argv[2] if  len(sys.argv) >= 3 else None
    try:
        installed_version = importlib.metadata.version(package_name)
        if min_version is not None:
            assert Version(installed_version) >= Version(min_version), (
                f"Python package {package_name} has {installed_version} "
                f"but we need >={min_version}"
            )
    except:
        assert None, f"Python package {package_name} not found!"

if __name__ == "__main__":
    main()
