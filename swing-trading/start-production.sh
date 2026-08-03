#!/bin/bash
set -e
NODE_BINARY="${SWING_NODE_BINARY:-$HOME/opt/node-v20/bin/node}"
test -x "$NODE_BINARY" || { echo "Swing Node runtime missing: $NODE_BINARY" >&2; exit 1; }
exec "$NODE_BINARY" dist/src/index.js serve
