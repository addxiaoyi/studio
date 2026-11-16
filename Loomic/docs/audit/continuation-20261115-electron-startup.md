# 2026-11-15 Electron 启动故障根因定位

本轮没有修改产品权限、Windows ACL、访问令牌、全局设置或 Chromium sandbox；没有创建数据库或启动真实业务桌面窗口。所有诊断进程已退出，UI 验收仍未通过。

## 直接证据

官方 Electron 33.4.11 Windows x64 的正常 Chromium 模式在应用 JS 执行前退出 `2147483651 / 0x80000003`。`--version`、带日志参数及 `--disable-gpu` 均复现；Node 模式正常。前一轮已核对 73 个文件与官方 ZIP 的 SHA-256 内容。

本轮通过 Windows 原生调试事件观测正常进程，没有跳过故障断点继续执行：

- electron.exe 的断点 RVA 为 `0x1d63c58`，第一轮、第二轮异常位于同一地址。
- 在该断点读取的 `RAX=0x0c`，主线程 TEB `LastErrorValue=5`（`ERROR_ACCESS_DENIED`）。
- 用可执行文件内 RSDS 标识 `62B1119A08EFD1994C4C44205044422E1` 对照官方 Electron PDB，附近函数为 `sandbox::policy::Sandbox::Initialize`。仅用 HTTP Range 获取必要符号流，没有下载整个 3.4 GB PDB。
- Electron v33.4.11 的 DEPS 与 `process.versions.chrome` 都确认 Chromium 为 `130.0.6723.191`。
- 对应 Chromium 源码的 `Sandbox::Initialize` 对 `CreateAlternateDesktop(Desktop::kAlternateWinstation)` 的返回值执行 `CHECK(result == SBOX_ALL_OK)`；`sandbox_types.h` 定义返回值 12 为 `SBOX_ERROR_CANNOT_CREATE_WINSTATION`。该路径中的窗口站创建失败与错误码 5 相符。
- 当前命令启动器和 Electron 子进程的 `TokenHasRestrictions=1`；不属于 AppContainer，宿主 Job UI 限制为 0。该观测不能单独证明是哪条宿主访问控制规则拒绝窗口站创建，但能排除把失败归为业务 preload、应用路由或 GPU 初始化的猜测。

因此已经定位到 **Chromium sandbox broker 创建备用窗口站时被当前执行环境拒绝**，并非仅凭通用 `STATUS_BREAKPOINT` 猜测原因。现有授权环境内没有验证过可行的正常安全启动路径；不以禁用 sandbox 或修改 ACL 取得假的通过结果。

来源：

- https://symbols.electronjs.org/electron.exe.pdb/62B1119A08EFD1994C4C44205044422E1/electron.exe.pdb
- https://raw.githubusercontent.com/electron/electron/v33.4.11/DEPS
- https://chromium.googlesource.com/chromium/src/+/refs/tags/130.0.6723.191/sandbox/policy/sandbox.cc
- https://chromium.googlesource.com/chromium/src/+/refs/tags/130.0.6723.191/sandbox/win/src/sandbox_types.h
- https://chromium.googlesource.com/chromium/src/+/refs/tags/130.0.6723.191/sandbox/win/src/window.cc

本地证据：`.creative-test-results/electron-debug-events-20261115.json`、`electron-symbol-ranges/`、`electron-sandbox-source/`。调试器捕获的是这个独立测试进程，不是用户浏览器或其他应用。

## 健康检查诊断改进

`run-renderer-health.mjs` 在执行前清除指定测试目录的旧 health/diagnostics 报告，避免引用上次结果。异常退出后记录数值/十六进制退出码、终止信号、当前是否生成 health 报告，以及只读 Windows 启动器探针结果。

Windows token 检查只在失败后执行，不成为常规启动的前置拦截，也不会将所有 `0x80000003` 都归为 sandbox 故障。探针失败会明确写入 `windowsProbeError`；本机 PowerShell 的 AllSigned 策略拒绝未签名的探针脚本，此条件被记录，未使用绕过执行策略的参数。

四项诊断回归通过，三份 JS 文件的 Biome 检查通过。真实 renderer 健康命令仍退出 1，现在明确报告 `0x80000003 before writing its report`，附证据目录和探针不可用原因。真实验收仍需在允许 Chromium 创建其安全窗口站的正常运行环境中重跑同一 sandboxed harness，然后再验证 Electron 回执丢失/重连与 renderer 恢复。

可运行的诊断回归：

```powershell
node --test apps/desktop/scripts/renderer-startup-diagnostics.test.mjs
node apps/desktop/scripts/run-renderer-health.mjs
```

本轮真实运行证据：`.creative-test-results/renderer-diagnostic-20261115.log`，测试目录 `D:/UserCache/Temp/loomic-renderer-health-k92wiq`；进程已退出，没有改动旧的停止数据库目录。
