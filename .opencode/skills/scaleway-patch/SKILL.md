# Skill: Scaleway 化兼容改造（opencode2api）

> 目标：对任意版本 `TiaraBasori/OpenCode2API` 上游代码，**最小、可重复、可验证**地施加 Scaleway Functions / Containers 兼容补丁，并保持上游可合并。

## 何时使用

- 上游发布新 tag / commit，需同步到本 scaleway 分支
- 需要验证 `function.zip` 在 `node22` 下可部署
- CI 自动化打补丁

## 补丁清单（原子变更）

1. **新增 `handler.js`**  
   - `export async function handle(event,context)`  
   - `import {createApp} from './src/proxy.js'` + `import {buildConfig} from './src/config.js'`  
   - 单例缓存 `serverless-http` 包装的 Express app  
   - 兼容 Scaleway 事件形状（`httpMethod`/`path`/`rawPath`）  
   - 本地 `if (import.meta.url===pathToFileURL(process.argv[1]).href) serveHandler(handle,8080)`

2. **新增 `src/config.js`**  
   - 抽离 `index.js` 重复的 `parseBool`/`parseToolAllowlist`/`buildConfig`  
   - 新增 `isScalewayFunctionEnv()` 探测：`SCW_FUNCTION_NAME|SCW_FUNCTION_ID|SCW_EXECUTION_ENV|FUNCTION_NAME|SCALEWAY_*`  
   - Functions 下强制 `USE_ISOLATED_HOME=true`, `jail=/tmp/opencode-proxy-jail`, `AUTO_CLEANUP=false`, `PORT` 兼容 `8080`

3. **修改 `package.json`**  
   - `dependencies += { "serverless-http": "^3.2.0" }`  
   - `scripts += { "dev:scaleway":"node handler.js", "pack:function":"bash scripts/pack-function.sh", "deploy:scaleway":"bash scripts/scaleway-interactive.sh" }`

4. **修改 `src/proxy.js`**  
   - 头部 `import {isScalewayFunctionEnv} from './config.js'`  
   - 修复 `createRequestToolContext` 重复 return 死代码  
   - `ensureBackend` 在 SCW 且 `MANAGE_BACKEND=false` 时快速失败（3次×500ms）并抛 `502 backend_unavailable` 带可操作 hint  

5. **修改 `index.js`**  
   - 重构为 `import {buildConfig} from './src/config.js'; const finalConfig=buildConfig();`  
   - 保留 `config.json` 加载日志兼容

6. **修改 `entrypoint.sh`**  
   - 顶部增加 `PORT→OPENCODE_PROXY_PORT` 映射 + SCW 检测提示

7. **新增脚本**  
   - `scripts/pack-function.sh`（幂等、无交互）  
   - `scripts/scaleway-interactive.sh`（TUI、含 wizard/pack/test/deploy/clean）

8. **文档/忽略**  
   - `.gitignore += function.zip, .env.scaleway, .scaleway.state`  
   - `README.md` 注入 Scaleway 章节  
   - `docs/scaleway.md`, `scaleway.toml.example`, `.env.scaleway.example`

## 自动化脚本

### 一键同步上游并重打补丁

`scripts/sync-upstream.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
UPSTREAM=${1:-https://github.com/TiaraBasori/OpenCode2API}
BRANCH=${2:-main}
WORK=/tmp/opencode2api_upstream_fresh
rm -rf $WORK && git clone --depth=1 -b $BRANCH $UPSTREAM $WORK
rsync -av --exclude='.git' --exclude='node_modules' --exclude='function.zip' --exclude='.env*' $WORK/ ./  \
  --exclude='handler.js' --exclude='src/config.js' --exclude='scripts/pack-function.sh' --exclude='scripts/scaleway-interactive.sh'
# 重新应用补丁（本 skill 的 8 步）
bash .opencode/skills/scaleway-patch/apply.sh
npm install --ignore-scripts
npm test -- --runInBand --passWithNoTests
bash scripts/pack-function.sh
echo "✓ sync done, verify handler.js & function.zip"
```

### `apply.sh`（幂等）

- 检查 `src/proxy.js` 是否含 `isScalewayFunctionEnv`，若无则打 patch
- 检查 `handler.js` 是否存在，若无则生成
- `npm pkg get dependencies.serverless-http` 若空则 `npm i serverless-http`
- 校验 `zipinfo -1 function.zip | grep handler.js`

## 验证清单

- [ ] `npm test` 通过
- [ ] `bash scripts/pack-function.sh` 生成 `function.zip` 且 `zipinfo | grep handler.js`
- [ ] `PORT=8080 API_KEY=test OPENCODE_ZEN_API_KEY=xxx node handler.js` 后 `curl localhost:8080/health` 200
- [ ] `curl localhost:8080/v1/models -H "Authorization: Bearer test"` 返回 JSON
- [ ] `scw functions function deploy --dry-run` 或控制台手动上传成功

## 回滚

`git diff HEAD -- src/proxy.js index.js entrypoint.sh package.json` 查看补丁，`git checkout -- <file>` 回滚单文件。

## 维护者

- 上游：TiaraBasori/OpenCode2API
- 本分支：scaleway-edition
- 关联 issue：Scaleway Functions `PORT=8080` + `jail /tmp` + `serverless-http`
