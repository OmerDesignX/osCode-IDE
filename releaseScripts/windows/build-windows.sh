#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOST_LABEL="${1:-Windows 10 or 11}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "Run the $HOST_LABEL release script in Git Bash on a native 64-bit Windows host." >&2
    exit 1
    ;;
esac

echo "Building osCode for $HOST_LABEL"
node "$ROOT/releaseScripts/common/cleanup-release.mjs"
bash "$ROOT/releaseScripts/common/prepare-source.sh"
cd "$ROOT"
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm exec electron-builder --win nsis --x64 --publish never
node scripts/verify-package.mjs windows --run-smoke
pnpm run release:stage:windows
node releaseScripts/common/cleanup-release.mjs
