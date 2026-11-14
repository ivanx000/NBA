#!/bin/bash
# Daily Tip-Off job: ingest yesterday's games, predict today's, publish to prod.
# Safe to run many times a day: with --if-needed it exits early once today is published.
# Runs on the developer's machine only (stats.nba.com blocks cloud IPs).
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${TIPOFF_LOG_DIR:-$HOME/Library/Logs/tipoff}"
mkdir -p "$LOG_DIR"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export MLFLOW_DISABLE_AGENT_HINT=1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# After waking from sleep the network can take a moment; wait up to ~2 minutes.
for i in $(seq 1 24); do
  if curl -s -o /dev/null --max-time 5 https://cdn.nba.com; then break; fi
  log "waiting for network ($i)"; sleep 5
done

cd "$ML_DIR"
log "start: tipoff daily --target prod --if-needed"
if uv run tipoff daily --target prod --if-needed; then
  log "done"
else
  status=$?
  log "FAILED with exit $status (will retry at the next scheduled hour)"
  exit "$status"
fi
