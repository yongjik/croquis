# Invoked as a hook by pyproject.toml; tells hatch to add the C++ library.

import glob

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

class CustomBuildHook(BuildHookInterface):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def initialize(self, version: str, build_data: dict) -> None:
        build_data.update(dict(pure_python=False, infer_tag=True))
        pat = "src/croquis/lib/_csrc.*.so"
        lib_files = glob.glob(pat)
        assert len(lib_files) == 1, \
            f"Should have exactly one file matching {pat} but found {lib_files}"
        lib, = lib_files
        build_data["force_include"][lib] = lib.removeprefix("src/")
