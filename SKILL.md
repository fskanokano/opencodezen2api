# Skill: OpenCode2API → Scaleway 化（最小兼容）

本 Skill 固化了将 `TiaraBasori/OpenCode2API` 任意版本改造为 **Scaleway Serverless Functions / Containers** 可部署形态的最小补丁集，确保上游可无痛合并。

## 一句话目标

> **同一份代码，四处运行**：`本地 npm start` / `Docker` / `Scaleway Functions（zip handler.handle）` / `Scaleway Containers（PORT=8080）`，改动面 < 6 文件。

## 补丁原理

- **探测**：`isScalewayFunctionEnv()` 检测 `SCW_*` / `FUNCTION_NAME` / `PORT=8080` 等环境变量，自动切换路径
- **隔离**：Functions 强制 `jail=/tmp/opencode-proxy-jail` + `USE_ISOLATED_HOME=true`，避免只读文件系统
- **适配**：`handler.js` 用 `serverless-http` 将 Scaleway 事件转为 Express `req/res`，复用 `createApp()`
- **容错**：`ensureBackend` 在 SCW 下 `MANAGE_BACKEND=false` 时 3 次快速失败 + 中文 `502 backend_unavailable` hint，而不是盲等 120s

## 文件清单

| 文件 | 动作 | 行数 |
|------|------|------|
| `handler.js` | 新增 | ~150 |
| `src/config.js` | 新增 | ~120 |
| `scripts/pack-function.sh` | 新增 | ~90 |
| `scripts/scaleway-interactive.sh` | 新增 | ~600 |
| `package.json` | +`serverless-http` +3 scripts | 5 |
| `src/proxy.js` | +import +快速失败 +删死代码 | ~20 |
| `index.js` | 重构为 `buildConfig()` | -80+5 |
| `entrypoint.sh` | +PORT 映射 | 5 |

全量 diff 可通过 `git diff upstream/main...HEAD --stat` 查看。

## 使用

```bash
# 新环境一键
bash scripts/scaleway-interactive.sh  # 选 1→2→3→4

# CI
bash scripts/scaleway-interactive.sh --pack --yes
bash scripts/pack-function.sh  # 纯打包

# 同步上游
bash scripts/sync-upstream.sh https://github.com/TiaraBasori/OpenCode2API main
bash .opencode/skills/scaleway-patch/apply.sh
npm test && bash scripts/pack-function.sh
```

## 验证

- `npm test` 通过
- `zipinfo -1 function.zip | grep -E 'handler.js|src/config.js'`
- `PORT=8080 API_KEY=t OPENCODE_ZEN_API_KEY=xxx node handler.js & curl localhost:8080/health`

## 维护

- 上游更新时，运行 `sync-upstream.sh`，冲突仅可能在 `src/proxy.js` / `index.js` 的配置块，手动合并 `isScalewayFunctionEnv` 分支即可。
- 本 Skill 位于 `.opencode/skills/scaleway-patch/SKILL.md`，`apply.sh` 为幂等校验脚本。

## 参考

- Scaleway 官方：`functions-handlers` / `serverless-functions-node` / `packaging zip`
- 本地文档：`docs/scaleway.md`
