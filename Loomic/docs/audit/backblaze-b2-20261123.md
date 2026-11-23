# Backblaze B2 接入验收

2026-11-23，Asia/Shanghai。用户授权使用 B2 替代当前无法写入的七牛异机备份，保留三份，并选择在免费额度内分三天下载验证。充值仍暂停；本次没有绑定付款方式或提高支出上限。

## 已验证的生产状态

- 私有桶 `helstera-studio-backups-20261123`，endpoint `https://s3.us-east-005.backblazeb2.com`，region `us-east-005`。SSE-B2 开启，Object Lock 关闭。
- 应用密钥限定该桶和 `helstera-backups/v1/` 前缀，使用 Read and Write 预设，没有创建、重置或使用 Master Key；未启用列举所有桶名。生产密钥文件 `/www/helstera/ops/b2.env` 权限为 0600，密钥不入库、不进命令行、不出现在验收输出。
- 生产已启用 `offsiteEnabled=true`、`offsiteKeep=3`、`storageVersioned=true`、`storageMaxBytes=10000000000`。本机每日备份、每周隔离恢复和故障监控继续执行。
- `20261123T130859Z.tar.enc` 于 2026-11-23 14:57:45 UTC 上传完成，共 2,276,957,011 字节。生产 `latest.json` 和归档收据均已有 `offsite`、`offsiteCompletedAt`；任务正常退出。
- 源归档与远端对象 metadata SHA-256 一致：`2fcd08a9a7f01a68849221d2ba4496999e7c10cd82fa98f3387d17d94f687ab7`。这是上传与对象元数据核验；完整下载后的内容哈希仍待三日任务完成。
- 匿名 HEAD 返回 401，S3 HeadObject 显示 `AES256`；当前 1 个正式对象版本、0 个删除标记、占用 2,276,957,011 字节。

## 三份保留与免费边界

在专用测试前缀 `helstera-backups/v1/retention-check-20261123/` 实际创建四个归档名称、旧名称的第二个版本及删除标记，再执行保留三份。旧名称的两个版本和删除标记全部删除，三个最新归档保留，无关测试文件保留。验证后删除所有测试版本，测试前缀已空。没有删除正式备份。

目前同等大小的三份归档约占 6.83 GB；上传第四份再清理时约占 9.11 GB。容量检查包含所有历史版本和未完成分片，预计超过 10 GB 时停止上传并由监控报告，不先删除可靠副本。实际数据库增长可能触发此保护，不能将当前大小当作永久保证。

B2 控制台账号支出上限保持 $0：存储 10 GB、下载每日 1 GB；未绑定付款方式。免费空间按账号合计，其他现有桶 `addxiaoyi` 检查时为 0 bytes。备份前缀容量保护之外，账号上限负责阻止额外收费。

## 分三天下载和恢复

固定验证上述归档，每个 UTC 日最多请求 900,000,000 字节，每段先落盘预算再请求；失败请求同样占用预算，SDK 自动重试关闭。同日重复启动不会重新获得额度。服务器必须返回准确的 HTTP 206 和 Content-Range，否则停止。固定 VersionId，保留断点和预算，完整下载后才公布文件并校验 SHA-256。

- 11 月 23 日：已下载 900,000,000 字节，任务退出码 0。同日再次启动仍为相同进度与预算，没有追加下载。
- 11 月 24 日 10:30 Asia/Shanghai：计划续传最多 900,000,000 字节。
- 11 月 25 日 10:30 Asia/Shanghai：计划下载剩余 476,957,011 字节，然后解密并恢复验证。

Windows 任务 `Helstera-B2-Free-Recovery-20261123` 已注册，启用错过后补跑、唤醒及防重入。必须让当前电脑开机且当前 Windows 用户已登录；未执行的计划不等于完成。若停机错过任务，应尽快检查，因为正式三份保留会在后续备份中清理该固定旧归档。

任务完成下载后，使用仅在用户电脑保存的 DPAPI 私钥验证 AES-GCM 解密及数据库 dump SHA-256，再恢复到独立的 PostgreSQL 17 实例（127.0.0.1:56997），校验用户、工作区、项目、Google 身份和迁移表。成功后停库、删除临时明文及临时本机 B2 凭据，保留收据和永久恢复私钥，并禁用这项一次性任务。

本机已用独立的小型合成数据库执行同一组解密与恢复脚本，五张目标表计数均为 1，实例正常停止，临时文件已清理，B2 下载消耗为 0。Windows 的 `pg_ctl` 启停输出写入日志文件，避免服务子进程继承 PIPE 导致启动等待不退出。此项是本机执行链路预演，不替代正式归档的完整恢复验收。

**当前完整下载、解密与数据库恢复尚未完成，不能据此宣称异机灾备恢复已验收。** 本机隔离恢复的既有结果不替代这次 B2 下载恢复证明。

本机证据目录：`M:/loomic-builds/launch-20261123/`，仅当前用户、SYSTEM 和管理员可访问。主要收据：`b2-remote-check.json`、`b2-retention-check.json`、`b2-schedule-check.json`、`b2-day1-check.json`、`b2-recovery-job.json`、`b2-recovery-smoke-check.json`；后续完成时生成 `b2-download-check.json`、`b2-decryption-check.json`、`b2-restore-check.json`。一次性密钥页面副本与临时 SSH 凭据已删除；本机 B2 凭据留给后续两天任务，永久恢复私钥保留。

## 代码与 CI

独立 B2 凭据、版本清理和容量保护提交 `3c36312b`；凭据缺失不阻断本机备份及告警提交 `a1e97899`。两次提交的 Desktop Candidate 和 Agent Closure CI 均已通过。

本轮增加四并行分片上传和免费分日下载，并把下载测试加入 Agent Closure CI。相关本地测试共 21 项通过（16 Node、5 Python），覆盖短 read 完整读取、分片顺序和失败收尾、三天续传、同日重复执行、截断响应、忽略 Range、版本变化及额度损坏。新增提交的 CI 需单独核对，旧 CI 结果不能替代。

最终代码提交 `09dcb33568992ed7f9b2492a0d6e80b8d44b9bb3` 已推送；对应 [Desktop Candidate CI](https://github.com/addxiaoyi/studio/actions/runs/45200548112) 和 [Agent Closure CI](https://github.com/addxiaoyi/studio/actions/runs/45200547920) 均为 success。后者的合同/数据库/运维检查与完整浏览器检查全部通过，最后一组画布工作流为 24 passed。生产运维文件的 SHA-256 与该提交的本机文件一致。之后仅追加验收文档，无运行时代码变更。

## 后续收尾

三日任务结束后查看完整恢复收据与明文清理结果。永久恢复密钥 `backup-private-key.dpapi` 及其 Windows 用户配置必须保留；它不是临时 SSH 凭据。用户在后续巡检中确认测试告警邮件已收到；真实充值仍暂停，详见 [非付费巡检与最后验收步骤](production-nonpaid-20261123.md)。

参考：[B2 价格](https://www.backblaze.com/cloud-storage/pricing)、[应用密钥](https://www.backblaze.com/docs/cloud-storage-create-and-manage-app-keys)、[S3 权限](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys)。
