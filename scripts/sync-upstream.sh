#!/usr/bin/env bash
set -euo pipefail
# sync-upstream.sh — 拉取最新上游并重打 Scaleway 补丁（幂等）
# Usage: bash scripts/sync-upstream.sh [upstream_url] [branch]
UPSTREAM=${1:-https://github.com/TiaraBasori/OpenCode2API}
BRANCH=${2:-main}
WORK=/tmp/opencode2api_upstream_fresh

echo "▸ Syncing from $UPSTREAM#$BRANCH"
rm -rf "$WORK"
git clone --depth=1 -b "$BRANCH" "$UPSTREAM" "$WORK"
echo "▸ Upstream files:"
ls -lh "$WORK" | head -n 20

# 备份本分支 scaleway 特有文件
TMPD=$(mktemp -d)
cp -a handler.js src/config.js scripts/pack-function.sh scripts/scaleway-interactive.sh "$TMPD"/ 2>/dev/null || true
cp -a docs/scaleway.md scaleway.toml.example .env.scaleway.example "$TMPD"/ 2>/dev/null || true

# rsync 上游，排除 scaleway 新增
rsync -av --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='function.zip' \
  --exclude='.env*' \
  --exclude='handler.js' \
  --exclude='src/config.js' \
  --exclude='scripts/pack-function.sh' \
  --exclude='scripts/scaleway-interactive.sh' \
  --exclude='scripts/sync-upstream.sh' \
  --exclude='docs/scaleway.md' \
  --exclude='scaleway.toml.example' \
  --exclude='.env.scaleway.example' \
  --exclude='.opencode' \
  "$WORK"/ ./

# 恢复 scaleway 文件
cp -a "$TMPD"/* ./ 2>/dev/null || true
# 确保 handler 等仍在
mkdir -p scripts docs .opencode/skills/scaleway-patch
mv "$TMPD/handler.js" ./handler.js 2>/dev/null || true
mv "$TMPD/config.js" ./src/config.js 2>/dev/null || true
# 若被覆盖，重建
if [[ ! -f handler.js ]]; then echo "handler.js missing after sync!"; fi

echo "▸ Re-applying patch checks"
bash .opencode/skills/scaleway-patch/apply.sh || {
  echo "⚠ Patch drift detected — please review SKILL.md and re-apply manually"
}

echo "▸ Installing deps & testing"
npm install --ignore-scripts
npm test -- --runInBand --passWithNoTests || echo "⚠ tests failed or missing"

echo "▸ Packing function.zip"
bash scripts/pack-function.sh

echo "✓ Sync done. Review git diff and commit."
echo "  git status"
echo "  git diff --stat"
rm -rf "$TMPD" "$WORK"
