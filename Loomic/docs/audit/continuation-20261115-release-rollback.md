# 2026-11-15 发布身份与回滚排空

本轮仅修复本地发布适配器和测试，没有生产切流、进程重启或数据库迁移，未改变 schema checksum 门禁。

## 已复现问题

- 旧 API 没有 drain 回执仍能完成 preflight，成功切流后才在停止旧 API 时发现无法验证排空。
- 停止 API/Worker 前不核对当前 PM2 PID 与先前已验证的实例，可先停止外部重启的新进程，事后才报回执不匹配。
- 旧 API 即使退出码非零，只要有 drained 文件也可能被当作成功退出。
- active-release 指针只在对象初始化时读取，之后被外部修改时，preflight/回滚仍可能覆盖新指针。
- 普通发布失败后的回滚未验证最终真实状态，stop 操作没有实际完成仍可能写 `rolled_back`。
- 回滚先停止候选 Worker 再停止候选 API，已有 WebSocket 请求仍可能在失去匹配 Worker 后继续提交工作；候选 API 的停止也未校验干净退出与 drained 回执。

故障回归分别记录在 `release-identity-red-20261115.log`、`release-rollback-red-20261115.log`、`release-pre-drain-red-20261115.log`、`release-api-drain-red-20261115.log`；合计 13 项预期拒绝/顺序断言在原实现失败。

## 修复行为

发布前要求旧 API 与 Worker 的 ready 回执。停止旧 API/Worker 前重新核对进程 PID 和已验证实例，停止后同时验证 stopped、exit code 0 和相同实例的 drained 回执。候选 Worker 同样拒绝身份改变。

preflight、旧 Worker 排空、切流和提交前重新核对 active-release 指针；Worker 排空前还核对 Nginx 原始字节。恢复只接受原指针或本次候选指针，不覆盖其他事务/人工写入的指针。

回滚在恢复流量后先排空候选 API，保持其 Worker 存活以完成在途请求；确认 API 已干净退出后才停止候选 Worker 并恢复旧 Worker。任意身份或排空不明即保留现场，不强制交接。候选 API PID/instance 写入持久化 context；旧 context 缺少该身份时，如果对应候选 API 仍存在，则拒绝自动恢复，不从当前进程猜测旧身份。候选 API 在达到 ready 前失败且无法证明身份/排空时也保留现场，需要检查后处理。

普通回滚与显式恢复共用最终状态验证，只有路由、指针、旧 Worker 和候选进程状态均核验后才能报告 `rolled_back`。

## 验证

- Windows：`test_blue_green_release`、`test_release_topology`、`test_blue_green_nginx`、`test_deploy_production_candidate` 共 82 项运行，79 通过、3 平台跳过。
- WSL Ubuntu：真实 Nginx 成功切流及故障回滚测试 1 项通过，连续 HTTP 观察保持 200。此测试与上述平台跳过有重叠，不叠加统计。
- 新增 adapter 回归验证：API 停止时匹配候选 Worker 仍存活；只有写出 drained 且 PM2 成功停止后才继续 Worker 交接；重复清理不再次 stop；旧 context 缺身份拒绝恢复且不改 context。
- Python 编译、`git diff --check` 通过。

最终日志：`.creative-test-results/release-rollback-verified-20261115.log`。没有再次执行完整 Linux PM2/PostgreSQL 业务进程套件，本轮的新增身份边界以真实文件和可控制 PM2 状态的适配器回归验证；不能将此当作生产长连接/供应商在途任务验收。

## HTTP 夹具在途请求回归

随后全 Python 179 项回归发现 HTTP 代理的回滚采样出现 502。原因是测试夹具仍用 `Popen.terminate()` 强制结束候选 API，打断已经路由到该进程的请求，没有模拟生产适配器依赖的 graceful drain 回执。

夹具现通过标准输入发送明确 drain 信号，上游使用非 daemon 请求线程，停止接收后等待已接收请求完成再退出；代理的路由选择与上游连接建立使用同一把锁，避免选中旧路由但尚未建立连接时就开始关闭。新增确定性 held 请求：它在切流/回滚前已返回头部，但只在收到 drain 信号后完成正文，证明请求确实跨越关闭阶段而未被丢弃。

连续采样全部为 200 的断言保持不变，并新增 held 请求成功与版本断言。将夹具的 graceful stop 在内存中替换回强杀，成功切流和回滚两场景均稳定产生 502；修复版重复 5 次全部通过。最终 `python -m unittest discover -s scripts -p 'test_*.py' -q`：179 项运行、165 通过、14 平台/环境跳过。日志为 `release-http-force-stop-red-20261115.log`、`release-http-drain-repeated-20261115.log` 和 `python-full-r5-verified-20261115.log`。没有通过增加固定等待或删除可用性断言掩盖失败；生产代码未因此改动。
