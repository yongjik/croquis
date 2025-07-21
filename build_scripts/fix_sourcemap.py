#!/usr/bin/env python
#
# Fix sourcemap generated from "jupyter labextension develop".

import json
import os
import sys

jsmap_dir, source_dir, target_dir = sys.argv[1:]
target_dir = os.path.realpath(target_dir)
if not target_dir.endswith("/"):
    target_dir += "/"

for filename in os.listdir(jsmap_dir):
    if filename.endswith(".js.map"):
        filename = os.path.join(jsmap_dir, filename)
        print(f"Handling file {filename} ...")
        with open(filename, "r") as f:
            data = json.load(f)
        data["sources"] = \
            [s.replace(source_dir, target_dir) for s in data["sources"]]
        with open(filename, "w") as f:
            json.dump(data, f, indent=4)
