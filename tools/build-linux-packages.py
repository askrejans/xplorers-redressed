#!/usr/bin/env python3
"""Build DEB and RPM packages with Electron's sandbox helper installed correctly."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile


root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text())["version"]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--app-dir", type=Path, default=root / "releases/Xplorers Redressed-linux-x64")
parser.add_argument("--output-dir", type=Path, default=root / "releases/publish")
args = parser.parse_args()
if not (args.app_dir / "chrome-sandbox").is_file():
    parser.error("build the Linux application with npm run package:linux first")
if not shutil.which("dpkg-deb") or not shutil.which("rpmbuild"):
    parser.error("dpkg-deb and rpmbuild are required; on Ubuntu install the rpm package")
args.output_dir.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="xplorers-deb-") as temporary:
    workspace = Path(temporary)
    stage = workspace / "payload"
    stage.mkdir(mode=0o755)
    application = stage / "opt/xplorers-redressed"
    shutil.copytree(args.app_dir, application, symlinks=True)
    binary = stage / "usr/bin/xplorers-redressed"
    binary.parent.mkdir(parents=True)
    binary.symlink_to("/opt/xplorers-redressed/Xplorers Redressed")
    desktop = stage / "usr/share/applications/xplorers-redressed.desktop"
    desktop.parent.mkdir(parents=True)
    desktop.write_text("""[Desktop Entry]
Type=Application
Name=Xplorers Redressed
Comment=Play AsoBrain Xplorers with a modern desktop compatibility framework
Exec=xplorers-redressed
Icon=xplorers-redressed
Terminal=false
Categories=Game;BoardGame;
""")
    icon = stage / "usr/share/pixmaps/xplorers-redressed.png"
    icon.parent.mkdir(parents=True)
    shutil.copyfile(root / "packaging/icon.png", icon)
    documentation = stage / "usr/share/doc/xplorers-redressed"
    documentation.mkdir(parents=True)
    for name in ("LICENSE", "NOTICE"):
        shutil.copyfile(root / name, documentation / name)
    for entry in [stage, *stage.rglob("*")]:
        if not entry.is_symlink():
            entry.chmod(0o755 if entry.is_dir() or entry.stat().st_mode & 0o111 else 0o644)
    (application / "chrome-sandbox").chmod(0o4755)
    installed_size = sum(entry.stat().st_size for entry in stage.rglob("*") if entry.is_file() and not entry.is_symlink())
    control = stage / "DEBIAN/control"
    control.parent.mkdir()
    control.parent.chmod(0o755)
    control.write_text(f"""Package: xplorers-redressed
Version: {version}
Section: games
Priority: optional
Architecture: amd64
Maintainer: Arvis Skrejans <askrejans@users.noreply.github.com>
Installed-Size: {(installed_size + 1023) // 1024}
Depends: libc6 (>= 2.28), libgtk-3-0t64 | libgtk-3-0, libnss3, libxss1, libxtst6, libatspi2.0-0t64 | libatspi2.0-0, libdrm2, libgbm1, libxkbcommon0, libasound2t64 | libasound2
Homepage: https://github.com/askrejans/xplorers-redressed
Description: Desktop compatibility framework for AsoBrain Xplorers
 Uses the original AsoBrain account and servers through WebAssembly.
 The original client is downloaded from AsoBrain on first use and is
 not included in this package. All game credit belongs to AsoBrain.
""")
    control.chmod(0o644)
    deb = args.output_dir / f"xplorers-redressed-{version}-linux-amd64.deb"
    subprocess.run(["dpkg-deb", "--root-owner-group", "--build", str(stage), str(deb.resolve())], check=True)
    shutil.rmtree(control.parent)
    rpm_root = workspace / "rpm"
    for directory in ("SOURCES", "SPECS", "BUILD", "BUILDROOT", "RPMS", "SRPMS"):
        (rpm_root / directory).mkdir(parents=True)
    with tarfile.open(rpm_root / "SOURCES/payload.tar.gz", "w:gz") as archive:
        archive.add(stage, arcname=".")
    spec = rpm_root / "SPECS/xplorers-redressed.spec"
    # This is an already built Electron payload; preserve its bytes and modes.
    spec.write_text(f"""%define __os_install_post %{{nil}}
%define _build_id_links none
%define debug_package %{{nil}}
Name: xplorers-redressed
Version: {version}
Release: 1
Summary: Desktop compatibility framework for AsoBrain Xplorers
License: GPL-3.0-only
URL: https://github.com/askrejans/xplorers-redressed
Source0: payload.tar.gz
BuildArch: x86_64
Requires: gtk3, nss, libXScrnSaver, libXtst, at-spi2-core, libdrm, mesa-libgbm, libxkbcommon, alsa-lib

%description
Uses the original AsoBrain account and servers through WebAssembly.
The original client is downloaded from AsoBrain on first use and is
not included in this package. All game credit belongs to AsoBrain.

%prep
%setup -q -c -n payload

%install
mkdir -p %{{buildroot}}
cp -a . %{{buildroot}}/

%files
%defattr(-,root,root)
/opt/xplorers-redressed
/usr/bin/xplorers-redressed
/usr/share/applications/xplorers-redressed.desktop
/usr/share/pixmaps/xplorers-redressed.png
%doc /usr/share/doc/xplorers-redressed
""")
    subprocess.run(["rpmbuild", "--define", f"_topdir {rpm_root}", "--target", "x86_64", "-bb", str(spec)], check=True)
    rpm = args.output_dir / f"xplorers-redressed-{version}-linux-x86_64.rpm"
    shutil.copyfile(next((rpm_root / "RPMS/x86_64").glob("*.rpm")), rpm)
print(deb)
print(rpm)
