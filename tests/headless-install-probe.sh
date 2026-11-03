#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${HOMESCREEN_PROBE_BASE:-/tmp/opencode/homescreen-install-probe}"
UUID="homescreen@engida32.github.io"
PACK="$ROOT/dist/$UUID.shell-extension.zip"

rm -rf "$BASE"
mkdir -p "$BASE/home" "$BASE/data" "$BASE/config" "$BASE/cache"

export HOME="$BASE/home"
export XDG_DATA_HOME="$BASE/data"
export XDG_CONFIG_HOME="$BASE/config"
export XDG_CACHE_HOME="$BASE/cache"

EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"

test -f "$PACK"

# `gnome-extensions info`, `list`, and `uninstall` address the ambient Shell
# and D-Bus state, not this isolated XDG tree. Never call them here: on a
# machine where Homescreen is really installed they could touch the real
# extension. Verify the install landed in $EXT_DIR and remove it directly.
gnome-extensions install --force "$PACK"

test -f "$EXT_DIR/metadata.json"
grep -Fq "$UUID" "$EXT_DIR/metadata.json"
test -f "$EXT_DIR/extension.js"
test -f "$EXT_DIR/LICENSE"
test -f "$EXT_DIR/schemas/org.gnome.shell.extensions.homescreen.gschema.xml"

rm -rf "$EXT_DIR"

test ! -e "$EXT_DIR"
echo "PROBE_OK"
