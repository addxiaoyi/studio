# 2026-11-15 Desktop 原生环境补验

工作目录沿用 `Loomic-continuation-20261112/Loomic`。本轮没有更改产品源码，没有部署、发布或调用真实支付。运行时测试使用独立临时目录、回环服务与一次性 PostgreSQL 集群，未访问用户的 Electron profile。

## Desktop 已补齐的覆盖

- 本机 FFmpeg 与 FFprobe 执行 `media-renderer.test.ts`、`video-export-integration.test.ts`，17/17 通过。其中 7 项此前因工具环境变量未提供而跳过，另 10 项已在上一轮通过。
- 真实导出验证包括缺少容器时长的 WebM、带声/静音素材裁剪拼接、拒绝伪装视频的播放列表、导出服务与请求处理器输出的 MP4 解码。
- 开启真实 Playwright MCP 包测试，`mcp-real-integration.test.ts` 5/5 通过。两个此前跳过的包连接（`latest` 与固定 `0.0.83`）均建立真实 stdio 子进程并确认工具目录；没有执行外部网页动作。
- 上一轮 Desktop 201 项通过、9 项跳过；本次新增覆盖这 9 项，去重合并为 **210 项已验证通过**。这不是在相同单次命令中重跑 210 项，也不是安装后的完整产品 UI 验收。

证据：`.creative-test-results/desktop-media-real-20261115.log`、`desktop-mcp-real-20261115.log`。

## Electron 二进制恢复与实际失败

Electron 依赖目录此前只有 Chromium 许可文件，缺少 `electron.exe` 和 `path.txt`。从现有官方 Electron 缓存取得锁定的 **33.4.11 Windows x64** ZIP，115,028,145 字节；SHA-256 与依赖包 `checksums.json` 完全匹配。验证 ZIP 内路径和符号链接边界后恢复到该依赖包的 `dist`，73 个解压文件逐项与 ZIP 内容哈希相同，没有修改依赖版本。

恢复后可启动 Electron 的 Node 模式，报告 Node 20.18.3；正常 Chromium 模式在应用脚本启动前以 **2147483651（0x80000003 / STATUS_BREAKPOINT）** 退出。相同退出码可通过 `--version`、隐藏 renderer 健康检查、短 ASCII 路径、干净环境和隐藏独立启动复现。未使用 `--no-sandbox` 或关闭系统安全保护来规避。

真实 Agent Goal 数据库套件已实际运行，**18 项通过、1 项失败**：Electron 回执丢失/重连用例因进程启动前退出而失败，不能继续按“缺二进制而跳过”描述，也不能冒充已验收。独立 renderer 健康测试同样失败，尚未证明 sandbox preload、重载和崩溃恢复在本机真实 Electron 33 上可用。没有证据把进程启动失败归因于业务代码，当前为待定位的本机运行环境问题。

证据：`.creative-test-results/desktop-agent-real-20261115.json`、`desktop-agent-real-20261115.log`、`desktop-renderer-real-20261115.log`、`desktop-renderer-debug-20261115.log`、`desktop-environment-20261115.json`。

## 临时进程终态

新增集群为 `D:/UserCache/Temp/helstera-electron-pg-eeu4gowp`，仅监听 `127.0.0.1:61650`，随机 SCRAM 密码不写入报告。`pg_ctl start` 已启动数据库，但其捕获管道被数据库子进程继承，观察命令最终超时；通过原 PID、目录和监听端口核验活进程后复用，没有重复启动。后续测试完成后确认测试数据库 0、其他客户端连接 0，使用 `pg_ctl -m fast -w stop` 正常停止；PID 文件消失，端口已关闭，原观察句柄也终止。

递归清理这个新临时目录的命令被自动审批拒绝，仅返回 `blocked by policy`，未再次尝试删除。集群目录与隔离 Electron 诊断目录保留，没有停止或删除其他数据库服务。
