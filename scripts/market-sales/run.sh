#!/bin/bash
# launchd entrypoint: self-update the repo, then run the worker.
# git failures are non-fatal (an offline Monday still runs last week's code).
HERE="$(cd "$(dirname "$0")" && pwd)"
(cd "$HERE/../.." && git pull --quiet 2>/dev/null) || true
exec /usr/bin/python3 "$HERE/worker.py" "$@"
