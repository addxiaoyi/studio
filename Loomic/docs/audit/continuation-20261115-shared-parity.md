# 2026-11-15 实际候选 Shared 副本补验

此前 `shared-deploy-parity.test.ts` 因工作区没有 `deploy/server-runtime` 而跳过；每个完整发布 ZIP 实际包含单独的 Shared 运行时副本。本轮从已经生成的 r3 候选读取该副本，而非先从当前 build 复制出相同目录再测试。

## 测试修复

- 支持进程变量 `HELT_SHARED_SHIPPED_DIR` 指向候选提取目录。
- 显式指定目录时，缺少构建或候选 `contracts.js` 会失败，不能被自动跳过。
- 递归比较全部 `.js` 与 `.d.ts` 文件列表和内容，拒绝嵌套漂移、遗漏及多余运行时文件；不要求源映射的环境路径相同。
- 拒绝运行时树内的符号链接。
- 将原先仅检查 `typeof bothPresent === 'boolean'` 的空测试替换为五项文件边界回归：嵌套 JS、嵌套声明、缺失/额外文件、映射文件边界和缺失入口。

## 实际候选证据

输入 ZIP 为 `.codex-release/production-closure-20261115-r3.zip`，完整 SHA-256 `d68599f776b74c987be5ce427090a2c4c569021faa961f1b21f8068bbd1208ef`。提取前重新调用生产部署校验器，验证 ZIP 路径、manifest、文件摘要及 Creative 完整性。

仅提取 `deploy/server-runtime/packages/shared/dist/` 下的 208 个文件，拒绝绝对路径、路径跳转、反斜线及符号链接；每个文件再核对 manifest SHA-256。输出为 `.creative-test-results/shared-r3-extracted-75c4cd5764ec45ee86e82ad16d5dd09c`，逐文件清单位于 `shared-r3-extraction-20261115.json`，标记 `copiedFromCurrentBuild: false`。

对该提取目录和当前 `packages/shared/dist` 运行测试：**6/6 通过，零跳过**。其中实际部署副本检查为原先跳过的 1 项；其余为新增边界测试。Server 类型检查和本次测试文件 Biome 通过。

证据：`.creative-test-results/shared-r3-parity-20261115.log`、同名 JSON、`shared-r3-parity-typecheck-20261115.log`。没有修改 r3 ZIP、恢复稀疏 `scripts/deploy`、复制到 `deploy/server-runtime` 或操作生产。

该结论只对应 r3 的实际副本；后续候选必须重新提取并执行检查，不能把本次一致性推断到未来发布。
