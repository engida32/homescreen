#!/usr/bin/env bash
set -euo pipefail

UUID="homescreen@engida32.github.io"
CYCLES="${1:-20}"

for i in $(seq 1 "$CYCLES"); do
    gnome-extensions disable "$UUID" || true
    gnome-extensions enable "$UUID"
    sleep 0.3
done

echo "Cycled $UUID $CYCLES times"
echo "Now check: journalctl -f -o cat /usr/bin/gnome-shell"
