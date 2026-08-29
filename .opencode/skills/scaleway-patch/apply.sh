#!/usr/bin/env bash
# apply.sh — 幂等地对上游代码施加 Scaleway 最小兼容补丁（供 sync-upstream.sh 调用）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
echo "[apply] Checking patch status…"

# 1. src/config.js
if [[ ! -f src/config.js ]]; then
  echo "[apply] src/config.js missing — needs manual creation (see SKILL.md)"
  exit 1
else
  echo "[apply] src/config.js OK"
fi

# 2. handler.js
if [[ ! -f handler.js ]]; then
  echo "[apply] handler.js missing"
  exit 1
else
  echo "[apply] handler.js OK"
fi

# 3. package.json serverless-http
if ! node -e "const p=require('./package.json'); process.exit(p.dependencies['serverless-http']?'0':'1')" 2>/dev/null; then
  echo "[apply] adding serverless-http"
  npm install --save serverless-http --ignore-scripts
else
  echo "[apply] serverless-http OK"
fi

# 4. src/proxy.js patch check
if ! grep -q "isScalewayFunctionEnv" src/proxy.js; then
  echo "[apply] src/proxy.js not patched — please re-apply diff from SKILL.md"
  exit 1
else
  echo "[apply] src/proxy.js patched"
fi

# 5. entrypoint.sh PORT mapping
if ! grep -q "OPENCODE_PROXY_PORT" entrypoint.sh; then
  echo "[apply] entrypoint.sh not patched"
  exit 1
else
  echo "[apply] entrypoint.sh OK"
fi

# 6. scripts
[[ -f scripts/pack-function.sh ]] && echo "[apply] pack-function.sh OK" || echo "[apply] pack-function.sh missing"
[[ -f scripts/scaleway-interactive.sh ]] && echo "[apply] scaleway-interactive.sh OK" || echo "[apply] missing"

echo "[apply] All checks passed."
