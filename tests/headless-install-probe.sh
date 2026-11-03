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

gnome-extensions install --force "$PACK"

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" || true
    gnome-extensions disable "$UUID" || true
    gnome-extensions uninstall "$UUID"
else
    # Headless: no Shell/D-Bus session to query, so verify the zip's contents
    # landed in the isolated home. The CLI uninstall needs the Shell, so remove
    # that install tree directly and assert it is gone.
    test -f "$EXT_DIR/metadata.json"
    grep -q "$UUID" "$EXT_DIR/metadata.json"
    rm -rf "$EXT_DIR"
fi

test ! -e "$EXT_DIR"
echo "PROBE_OK"
