#!/usr/bin/env python3
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
META = ROOT / "extension" / "metadata.json"
SCHEMA = ROOT / "extension" / "schemas" / "org.gnome.shell.extensions.homescreen.gschema.xml"

errors = []
if not META.exists():
    errors.append("missing extension/metadata.json")
else:
    data = json.loads(META.read_text())
    if data.get("uuid") != "homescreen@engida32.github.io":
        errors.append("wrong uuid")
    if data.get("shell-version") != ["50"]:
        errors.append("shell-version must be exactly [\"50\"]")
    if data.get("settings-schema") != "org.gnome.shell.extensions.homescreen":
        errors.append("wrong settings-schema")
    if data.get("session-modes") != ["user", "unlock-dialog"]:
        errors.append("metadata must opt into both user and unlock-dialog session modes")

if not SCHEMA.exists():
    errors.append("missing settings schema")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("metadata ok")
