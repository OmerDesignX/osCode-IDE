#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

node "$SCRIPT_DIR/sync-version.mjs"
cd "$ROOT"
pnpm install --frozen-lockfile
pnpm run release:check-disk
pnpm run format:check
pnpm test
pnpm run git:prepare
pnpm run python:prepare
pnpm run llama:prepare
pnpm run terminal:prepare
pnpm run computer:prepare
pnpm run native:check
NODE_OPTIONS=--max-old-space-size=4096 pnpm exec vite build
