#!/usr/bin/env bash
# pack-function.sh — One-click build of Scaleway Function zip
# Minimal, fast, reproducible. Called by scaleway-interactive.sh and directly.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Colors for minimal pack (no TUI)
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${GREEN}▸ Packing Scaleway function.zip${NC}"

# 1. Pre-flight
if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}✗ npm not found. Install Node.js 18+${NC}"; exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  echo -e "${RED}✗ zip not found. Install zip${NC}"; exit 1
fi
if [ ! -f package.json ]; then
  echo -e "${RED}✗ package.json not found in $ROOT_DIR${NC}"; exit 1
fi

# 2. Install production deps if needed
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] && [ ! -f node_modules/express/package.json ]; then
  echo "  → npm ci --omit=dev (installing production deps)…"
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --ignore-scripts
  else
    npm install --omit=dev --ignore-scripts
  fi
else
  echo "  → node_modules present, skipping install (rm -rf node_modules to force reinstall)"
fi

# Ensure serverless-http present (required for handler)
if [ ! -d node_modules/serverless-http ]; then
  echo "  → installing serverless-http…"
  npm install --save serverless-http --ignore-scripts
fi

# 3. Sanity: handler exists?
if [ ! -f handler.js ]; then
  echo -e "${RED}✗ handler.js missing. This repo should contain handler.js for Scaleway Functions.${NC}"; exit 1
fi
if [ ! -f src/config.js ]; then
  echo -e "${YELLOW}⚠ src/config.js missing — may be outdated checkout${NC}"
fi

# 4. Clean previous zip
OUT="function.zip"
rm -f "$OUT"

# 5. Build file list — include only runtime needed, exclude dev artifacts
# Scaleway expects zip root to contain handler.js + package.json + node_modules + src
echo "  → creating $OUT …"

# Use zip with exclusions to keep size low (< 50MB limit)
# Exclude: .git, tests, docs, .github, scripts except pack scripts, *.log, .env
zip -r "$OUT" \
  handler.js \
  index.js \
  package.json \
  src \
  node_modules \
  -x "node_modules/.cache/*" \
     "node_modules/.bin/*" \
     "*.log" \
  > /tmp/pack.log 2>&1 || {
    cat /tmp/pack.log
    echo -e "${RED}✗ zip failed${NC}"; exit 1
  }

# Optional: include config.json if present (user may have committed)
if [ -f config.json ]; then
  zip -u "$OUT" config.json >/dev/null
  echo "  → included config.json"
fi

SIZE=$(du -h "$OUT" | cut -f1)
FILES=$(zipinfo -1 "$OUT" | wc -l)
echo -e "${GREEN}✓ Created $OUT  size=$SIZE  files=$FILES${NC}"

# 6. Quick validation: handler exports 'handle'?
if ! grep -q "export.*handle" handler.js; then
  echo -e "${YELLOW}⚠ handler.js does not export 'handle' — Scaleway expects handler.handle${NC}"
else
  echo "  → handler.handle export: OK"
fi

# 7. Show next steps
cat <<NEXT

Next steps:
  • Local test:  npm run dev:scaleway   # http://localhost:8080
                 curl http://localhost:8080/health
  • Deploy via console:  Upload $OUT to Scaleway Console > Functions > Create > Zip
     Handler = handler.handle , Runtime = node22
     Env vars: API_KEY, OPENCODE_ZEN_API_KEY (see README)
  • Deploy via CLI:      ./scripts/scaleway-interactive.sh  → choose Deploy

NEXT

# 8. Size warning (Scaleway limit 100MB uncompressed, 10MB compressed recommended)
BYTES=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT" 2>/dev/null || echo 0)
if [ "$BYTES" -gt 52428800 ]; then
  echo -e "${YELLOW}⚠ Zip is >50MB — consider pruning node_modules or using .scwignore${NC}"
fi

echo -e "${GREEN}Done.${NC}"
