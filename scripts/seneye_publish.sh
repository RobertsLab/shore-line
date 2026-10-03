#!/bin/bash
# Collect one seneye reading and publish it to the `seneye-data` branch,
# where the site build picks it up (SENEYE_URL repo variable points at the
# raw file). Run every 15 min by launchd on a Mac inside the UW network;
# install with scripts/install_seneye_agent.sh (launchd may not read
# ~/Documents, so the installer copies this script and the collector out).
#
# The branch is a single amended commit force-pushed each run, so it never
# accumulates history. The collector keeps its own 14-day series in the file.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="${COLLECTOR:-$HERE/collect_seneye.py}"
DATA_DIR="${SENEYE_DATA_DIR:-$HOME/Library/Application Support/shore-seneye/data}"
PYTHON="${PYTHON:-python3}"
REMOTE="${SHORE_REMOTE:-https://github.com/RobertsLab/shore-line.git}"

if [ ! -d "$DATA_DIR/.git" ]; then
  mkdir -p "$DATA_DIR"
  if git ls-remote --exit-code --heads "$REMOTE" seneye-data >/dev/null 2>&1; then
    git clone --quiet --depth 1 --branch seneye-data "$REMOTE" "$DATA_DIR"
  else
    git -C "$DATA_DIR" init --quiet
    git -C "$DATA_DIR" checkout --quiet --orphan seneye-data
    git -C "$DATA_DIR" remote add origin "$REMOTE"
  fi
fi

cd "$DATA_DIR"
"$PYTHON" "$COLLECTOR" --out seneye.json --tank left-blue >/dev/null

git add seneye.json
git -c user.name="seneye[bot]" -c user.email="sr320@users.noreply.github.com" \
  commit --quiet --amend --allow-empty -m "seneye: latest readings" 2>/dev/null \
  || git -c user.name="seneye[bot]" -c user.email="sr320@users.noreply.github.com" \
       commit --quiet -m "seneye: latest readings"
git push --quiet --force origin seneye-data
echo "$(date '+%F %T') published $("$PYTHON" -c 'import json;print(json.load(open("seneye.json"))["latest"]["temp_c"])') C"
