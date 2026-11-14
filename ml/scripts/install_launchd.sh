#!/bin/bash
# Install (or reinstall) the daily job as a launchd agent for the current user.
# Uninstall: ml/scripts/install_launchd.sh --uninstall
set -euo pipefail
LABEL="com.tipoff.daily"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs/tipoff"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DEST"; echo "uninstalled $LABEL"; exit 0
fi

mkdir -p "$LOG_DIR" "$(dirname "$DEST")"
intervals=""
for hour in 9 10 11 12 13 14 15 16 17 18; do
  intervals+="    <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>30</integer></dict>"$'\n'
done
python3 - "$SCRIPTS/com.tipoff.daily.plist.template" "$DEST" "$SCRIPTS/daily.sh" "$LOG_DIR" "$intervals" <<'PY'
import sys
src, dest, daily, logs, intervals = sys.argv[1:]
text = open(src).read().replace("__DAILY_SH__", daily).replace("__LOG_DIR__", logs)
open(dest, "w").write(text.replace("__INTERVALS__", intervals.rstrip("\n")))
PY
plutil -lint "$DEST"
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "installed $LABEL -> $DEST (logs: $LOG_DIR/daily.log)"
