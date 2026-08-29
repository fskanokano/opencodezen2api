# Scaleway 部署指南

> 适配分支：基于 `TiaraBasori/OpenCode2API v1.5.0` 的最小 Scaleway 化改动  
> 支持：**Scaleway Serverless Functions**（zip）与 **Scaleway Serverless Containers**（Docker）  
>  handler：`handler.handle` | Runtime：`node22` | Zip：`function.zip`

---

## 1. 架构

```
Client (OpenAI SDK / Cursor / ChatGPT)
  |  Authorization: Bearer <API_KEY>
  v
[Scaleway Functions] handler.js -> createApp() -> @opencode-ai/sdk -> opencode serve (/tmp jail)
  |  OPENCODE_ZEN_API_KEY 透传到 Zen
  v
https://opencode.ai/zen/v1
```

- 同一代码在本地/Docker/Functions/Containers 四环境运行，通过 `isScalewayFunctionEnv()` 自动切换：
  - Functions：`MANAGE_BACKEND=false`（默认），`USE_ISOLATED_HOME=true`，`jail=/tmp/opencode-proxy-jail`，`PORT` 兼容 `8080`
  - Containers：沿用原 Docker 逻辑，`PORT` 映射到 `OPENCODE_PROXY_PORT`

---

## 2. 快速开始（交互脚本）

```bash
git clone <this-repo> && cd opencodezen2api
bash scripts/scaleway-interactive.sh
```

菜单：

```
1) 🧙 配置向导（API_KEY / OPENCODE_ZEN_API_KEY）
2) 📦 一键打包 function.zip
3) 🧪 本地联调（node handler.js :8080）
4) 🚀 部署到 Functions
5) 🐳 部署到 Containers
6) 🔍 查看配置
7) 🧹 清理
8) 📖 改动说明
```

非交互（CI）：

```bash
export API_KEY=$(openssl rand -hex 16)
export OPENCODE_ZEN_API_KEY=sk-xxxx
bash scripts/scaleway-interactive.sh --pack --yes
bash scripts/scaleway-interactive.sh --deploy-fn --yes
```

---

## 3. 手动打包

```bash
bash scripts/pack-function.sh
# 或 npm run pack:function
ls -lh function.zip
zipinfo -1 function.zip | head
```

依赖：`node>=18`, `npm`, `zip`, `curl`。脚本会自动 `npm ci --omit=dev` 并校验 `handler.handle` 导出。

Zip 内容（根必须包含）：

```
handler.js
package.json
src/
node_modules/  (含 serverless-http, express, @opencode-ai/sdk)
```

大小建议 < 50MB（Scaleway 限制 100MB 解压后）。

---

## 4. 手动部署到 Scaleway Functions（控制台）

1. https://console.scaleway.com/functions/namespaces → Create Namespace (`fr-par`)
2. Create Function → Runtime `Node 22` → Handler `handler.handle` → Upload `function.zip`
3. Environment variables:

| Key | 必填 | 示例 | 说明 |
|-----|-----|------|------|
| `API_KEY` | 是 | `openssl rand -hex 16` | 客户端 Bearer |
| `OPENCODE_ZEN_API_KEY` | 否 | `sk-...` | 为空走免费限流（~200/日） |
| `OPENCODE_SERVER_PASSWORD` | 否 | - | 若 MANAGE_BACKEND=true 时的后端密码 |
| `OPENCODE_PROXY_DEBUG` | 否 | `false` | 调试日志 |

4. Memory `512MB`，Timeout `300s`，Deploy
5. 测试：

```bash
FN=https://<id>.functions.fnc.fr-par.scw.cloud
curl $FN/health
curl $FN/v1/models -H "Authorization: Bearer $API_KEY"
curl $FN/v1/chat/completions -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode/big-pickle","messages":[{"role":"user","content":"hi"}]}'
```

---

## 5. scw CLI 一键部署

```bash
# 1. 安装并登录
curl -s https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh
scw init

# 2. 创建 Namespace（如无）
scw functions namespace create name=opencode2api region=fr-par
# 记录 id: <ns-id>

# 3. 创建 Function
scw functions function create name=opencode2api namespace-id=<ns-id> \
  runtime=node22 handler=handler.handle memory-limit=512 timeout=300s region=fr-par \
  env.API_KEY=your-key env.OPENCODE_ZEN_API_KEY=sk-... 

# 4. 部署
scw functions function deploy function-id=<fn-id> region=fr-par zip-file=function.zip

# 5. 查看
scw functions function get function-id=<fn-id> region=fr-par
curl https://<domain>/health
```

脚本 `4) 部署到 Functions` 已自动化上述流程。

---

## 6. 部署到 Scaleway Containers

```bash
docker build -t rg.fr-par.scw.cloud/<namespace>/opencode2api:latest .
docker push rg.fr-par.scw.cloud/<namespace>/opencode2api:latest

# 控制台或 scw
scw container namespace create name=opencode2api region=fr-par
scw container container create namespace-id=<ns-id> name=opencode2api \
  region=fr-par registry-image=rg.fr-par.scw.cloud/<namespace>/opencode2api:latest \
  port=10000 cpu-limit=500 memory-limit=512 min-scale=0 max-scale=3 \
  env.API_KEY=xxx env.OPENCODE_ZEN_API_KEY=yyy
```

`entrypoint.sh` 已处理 `PORT` 映射，Containers 注入的 `PORT=8080` 会自动映射。

---

## 7. 本地联调

```bash
# 方式一：Functions 仿真
npm install
cp .env.scaleway.example .env.scaleway  # 填入你的 key
set -a; source .env.scaleway; set +a
npm run dev:scaleway   # node handler.js :8080
curl http://localhost:8080/health
curl http://localhost:8080/v1/models -H "Authorization: Bearer $API_KEY"

# 方式二：原生 Express
npm start  # :10000 + :10001
```

---

## 8. 配置详解（Functions 专用）

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8080` (SCW 注入) | Functions 入口端口，自动映射到 `OPENCODE_PROXY_PORT` |
| `API_KEY` | 空 | 为空则不鉴权（不推荐） |
| `OPENCODE_ZEN_API_KEY` | 空 | 为空走 `public` 免费档 |
| `OPENCODE_PROXY_MANAGE_BACKEND` | `false` (Functions) | 是否在函数内 `spawn opencode serve`。`true` 需镜像含 `opencode-ai` 二进制，冷启动 +5s |
| `OPENCODE_SERVER_URL` | `http://127.0.0.1:10001` | 若 `MANAGE_BACKEND=false`，需指向外部可达的 `opencode serve` |
| `OPENCODE_USE_ISOLATED_HOME` | `true` (Functions) | 强制 `/tmp` jail，避免只读文件系统错误 |

---

## 9. 故障排查

| 现象 | 原因 | 解法 |
|------|------|------|
| `502 backend_unavailable` | `OPENCODE_SERVER_URL` 不可达且 `MANAGE_BACKEND=false` | 设 `OPENCODE_PROXY_MANAGE_BACKEND=true` 或提供外部后端 |
| `Missing dependency serverless-http` | 打包时未安装 | `npm i serverless-http` 后重打包 |
| `handler.handle not found` | 压缩包根未含 `handler.js` | 检查 `zipinfo -1 function.zip` |
| `Free usage exceeded` | 免费档日超限 | 等 00:00 本地重置或换 IP，或配置 `OPENCODE_ZEN_API_KEY` |
| Zip >50MB | `node_modules` 过大 | `npm ci --omit=dev`, 检查未排除 `tests/docs` |

日志：Scaleway Console → Functions → Logs；本地 `DEBUG=true npm run dev:scaleway`

---

## 10. 成本估算

- Functions：按请求 + GB·秒，冷启动免费额度内约 €0；适合低频/突发
- Containers：按运行秒 + 并发，常驻约 €5-10/月；适合常驻/SSE
- Zen：按 token，免费档 0，付费见 `opencode.ai/docs/zen`

---

## 11. 上游同步

见 `SKILL.md` 与 `.opencode/skills/scaleway-patch/`，执行 `bash scripts/sync-upstream.sh` 可一键合入上游并重新打补丁。
