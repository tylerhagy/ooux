#!/usr/bin/env bash
#
# serve.sh — launch ORCA on a fixed local port.
#
# PURPOSE
#   Serve this directory over http://localhost:8042 so the File System Access
#   API is available. The port is PINNED deliberately: folder permission grants
#   are keyed to the origin, port included, so a stable port is what lets the
#   app remember your folder between sessions.
#
# WHY NOT `serve`
#   The `serve` CLI rewrites HTML — it injects a favicon, adds data-source-lines
#   attributes and bolts on an inline-comment layer that hooks text selection.
#   Great for reading documents, wrong for an app with inline editing. This uses
#   Python's stdlib http.server, which serves bytes untouched.
#
# NOTES
#   - Opening index.html by double-clicking does NOT work: file:// is an opaque
#     origin and the folder picker does not exist there.
#   - Requires a Chromium browser (Chrome, Edge, Arc, Brave).
#
# Usage: ./serve.sh [port]

set -uo pipefail

PORT="${1:-8042}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use — ORCA may already be running."
  echo "Open http://localhost:$PORT"
  exit 1
fi

echo "ORCA  ->  http://localhost:$PORT"
echo "Serving $DIR (Ctrl-C to stop)"
echo

cd "$DIR" || exit 1
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

sleep 1
if command -v open >/dev/null 2>&1; then
  open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null \
    || open "http://localhost:$PORT"
fi

wait $SERVER_PID
