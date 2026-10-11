#!/usr/bin/env python3
"""ZIP a packaged application, retaining Unix executable modes and symlinks."""

import argparse
import os
from pathlib import Path
import zipfile


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("application", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
application = args.application.resolve()
if not application.is_dir():
    parser.error("application must be a packaged application directory")
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for entry in [application, *sorted(application.rglob("*"))]:
        name = entry.relative_to(application.parent).as_posix()
        if entry.is_symlink():
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = entry.lstat().st_mode << 16
            archive.writestr(info, os.readlink(entry))
        else:
            archive.write(entry, name)
print(args.output)
