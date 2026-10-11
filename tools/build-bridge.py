#!/usr/bin/env python3
"""Build and verify owned framework helpers; no original client or artwork is needed."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
DIST = PROJECT / "dist"


def build():
    DIST.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="asobrain-bridge-") as temporary:
        classes = Path(temporary) / "classes"
        classes.mkdir()
        sources = sorted((PROJECT / "tools/bridge/local").rglob("*.java"))
        subprocess.run(["javac", "--release", "8", "-d", str(classes),
                        *map(str, sources)], check=True)
        helpers = sorted(classes.rglob("*.class"))
        verifier = Path(temporary) / "VerifyHelpers.java"
        verifier.write_text('public class VerifyHelpers { public static void main(String[] args) throws Exception {'
                            'for (String name : args) Class.forName(name, false, VerifyHelpers.class.getClassLoader());'
                            'System.out.println("Owned helper classes pass JVM bytecode verification"); }}\n')
        subprocess.run(["javac", "--release", "8", "-cp", str(classes), "-d", str(classes),
                        str(verifier), str(PROJECT / "tools/VerifySmoothAssets.java"),
                        str(PROJECT / "tools/VerifyBootstrap.java"),
                        str(PROJECT / "tests/fixtures/legacy/com/asobrain/games/a/a/m.java")], check=True)
        subprocess.run(["java", "-Xverify:all", "-cp", str(classes), "VerifyHelpers",
                        *[path.relative_to(classes).as_posix()[:-6].replace("/", ".")
                          for path in helpers]], check=True)
        subprocess.run(["java", "-Djava.awt.headless=true", "-Xverify:all", "-cp", str(classes),
                        "VerifySmoothAssets"], check=True)
        subprocess.run(["java", "-Djava.awt.headless=true", "-Xverify:all", "-cp", str(classes),
                        "VerifyBootstrap"], check=True)
        failed_launch = subprocess.run(["java", "-Djava.awt.headless=true", "-cp", str(classes),
                                       "local.asobrain.Bootstrap", "--client-class=VerifyBootstrap$Unsupported"],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if failed_launch.returncode != 1:
            raise AssertionError("An unsupported launcher did not return failure status 1")
        with zipfile.ZipFile(DIST / "bridge.jar", "w", zipfile.ZIP_DEFLATED) as jar:
            for path in helpers:
                jar.write(path, path.relative_to(classes).as_posix())
    with zipfile.ZipFile(DIST / "bridge.jar") as jar:
        if not all(name.startswith("local/asobrain/") and name.endswith(".class") for name in jar.namelist()):
            raise ValueError("The distributable helper contains upstream content")
    shutil.copyfile(PROJECT / "tools/bridge/bridge-runtime.js", DIST / "bridge-runtime.js")
    print("Built owned-code-only dist/bridge.jar and dist/bridge-runtime.js")


if __name__ == "__main__":
    build()
