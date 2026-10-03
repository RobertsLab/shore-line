#!/bin/bash
# Install (or update) the launchd job that publishes seneye readings every
# 15 min. Re-run after changing collect_seneye.py or seneye_publish.sh.
# Uninstall: launchctl unload ~/Library/LaunchAgents/com.robertslab.shore-seneye.plist
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/Library/Application Support/shore-seneye/bin"
PLIST="$HOME/Library/LaunchAgents/com.robertslab.shore-seneye.plist"
PY="$(command -v python3)"

mkdir -p "$BIN"
cp "$SRC/collect_seneye.py" "$SRC/seneye_publish.sh" "$BIN/"
chmod +x "$BIN/seneye_publish.sh"

sed -e "s#__BIN__#$BIN#g" -e "s#__PYTHON__#$PY#g" -e "s#__PATH__#$(dirname "$PY"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin#g" \
  "$SRC/com.robertslab.shore-seneye.plist" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed; log at /tmp/shore-seneye.log"
