#!/usr/bin/env bash
# pack-function.sh — 最简 Scaleway Function 打包（默认不含 node_modules）
# 用法： bash scripts/pack-function.sh [--with-node-modules] [--output function.zip]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'

WITH_NODE_MODULES=false
OUT="function.zip"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-node-modules) WITH_NODE_MODULES=true; shift ;;
    --output|-o) OUT="$2"; shift 2 ;;
    --help|-h) echo "Usage: $0 [--with-node-modules] [--output function.zip]"; exit 0 ;;
    *) echo "未知参数 $1" >&2; exit 1 ;;
  esac
done

echo -e "${GREEN}▸ Packing Scaleway function.zip (minimal)${NC}"
echo -e "  模式: $([[ "$WITH_NODE_MODULES" == true ]] && echo "含 node_modules (13M+)" || echo "不含 node_modules (极简 ~100KB，Scaleway 自动 npm install)")"

# 预检
if ! command -v zip >/dev/null 2>&1; then
  echo -e "${RED}✗ zip 未安装${NC}"; exit 1
fi
if [[ ! -f handler.js ]]; then
  echo -e "${RED}✗ handler.js 缺失${NC}"; exit 1
fi
if [[ ! -f package.json ]]; then
  echo -e "${RED}✗ package.json 缺失${NC}"; exit 1
fi
if [[ ! -f src/config.js ]]; then
  echo -e "${YELLOW}⚠ src/config.js 缺失，可能是旧分支${NC}"
fi

# 清理旧包
rm -f "$OUT"

# 临时排除文件：若用户在本地有 .env / config.json 等敏感文件，不打进去
echo "  → 创建 $OUT …"

if [[ "$WITH_NODE_MODULES" == true ]]; then
  # 兼容旧行为：含 node_modules（如需离线部署）
  if [[ ! -d node_modules ]]; then
    echo "  → node_modules 缺失，执行 npm install --omit=dev ..."
    if [[ -f package-lock.json ]]; then
      npm ci --omit=dev --ignore-scripts 2>&1 | tail -n 20 || npm install --omit=dev --ignore-scripts 2>&1 | tail -n 20
    else
      npm install --omit=dev --ignore-scripts 2>&1 | tail -n 20
    fi
  fi
  # 确保关键依赖在
  if [[ ! -d node_modules/serverless-http ]]; then
    echo "  → 补充 serverless-http ..."
    npm install --save serverless-http --ignore-scripts 2>&1 | tail -n 5 || true
  fi
  zip -r "$OUT" \
    handler.js \
    package.json \
    package-lock.json \
    src \
    node_modules \
    -x "node_modules/.cache/*" "node_modules/.bin/*" "*.log" ".git/*" \
    > /tmp/pack.log 2>&1 || { cat /tmp/pack.log; echo -e "${RED}✗ zip 失败${NC}"; exit 1; }
else
  # 极简模式：仅源码 + package.json，Scaleway 部署时自动 npm install
  # 注意：必须包含 package.json 以便平台安装 serverless-http/express 等
  zip -r "$OUT" \
    handler.js \
    package.json \
    src \
    -x "*.log" ".git/*" \
    > /tmp/pack.log 2>&1 || { cat /tmp/pack.log; echo -e "${RED}✗ zip 失败${NC}"; exit 1; }
  # 可选：带上 lock 以保证版本一致
  if [[ -f package-lock.json ]]; then
    zip -u "$OUT" package-lock.json >/dev/null 2>&1 || true
  fi
fi

# 可选：若存在 config.json（非敏感示例）则附加
if [[ -f config.json ]]; then
  zip -u "$OUT" config.json >/dev/null 2>&1 || true
  echo "  → 已附加 config.json"
fi

SIZE=$(du -h "$OUT" | cut -f1)
FILES=$(zipinfo -1 "$OUT" 2>/dev/null | wc -l)
echo -e "${GREEN}✓ 已创建 $OUT  大小=$SIZE  文件数=$FILES${NC}"

if ! grep -q "export.*handle" handler.js; then
  echo -e "${YELLOW}⚠ handler.js 未导出 handle，Scaleway 需 handler.handle${NC}"
else
  echo "  → handler.handle: OK"
fi

# 校验：极简模式下 zip 内不应有 node_modules
if [[ "$WITH_NODE_MODULES" == false ]] && zipinfo -1 "$OUT" | grep -q "node_modules/"; then
  echo -e "${RED}✗ 极简模式不应包含 node_modules${NC}"; exit 1
fi

cat <<NEXT

下一步：
  • 本地测试:  npm install && PORT=8080 API_KEY=test node handler.js
              curl http://localhost:8080/health
  • 控制台部署: 上传 $OUT 到 Scaleway Console → Functions → Create → Zip
    Handler: handler.handle  Runtime: node22
    环境变量: API_KEY, OPENCODE_ZEN_API_KEY (MANAGE_BACKEND 默认关闭)
  • CLI 部署:  ./scripts/scaleway-interactive.sh → 4) 部署

提示：极简 zip 由平台自动 npm install，如需离线/加速可用 --with-node-modules
NEXT

BYTES=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT" 2>/dev/null || echo 0)
if [[ "$BYTES" -gt 52428800 ]]; then
  echo -e "${YELLOW}⚠ 超过 50MB，建议用极简模式${NC}"
fi
echo -e "${GREEN}完成.${NC}"
