# 2026-11-14 容量治理与发布保留策略

## 生产只读复核

- 清理了 Loomic 生产目录中的数据库备份、静态发布归档、候选发布目录、临时升级目录和旧环境备份；没有删除 PostgreSQL 数据目录、浏览器依赖或当前活动发布目录。
- `/www` 清理后可用空间约 33.5 GiB，使用率 55%。
- 系统盘 `/` 只读复核后可用空间约 2.89 GiB，使用率 91%。PostgreSQL 数据目录约 2.5 GiB，保留不动。
- 清理了未使用的 APT 包缓存、旧 journal 和 pnpm 缓存；没有发现正在运行的 pnpm/npm 构建任务。
- Nginx 配置检查通过，`/api/health` 返回 `ok: true`；蓝色 Server/Worker 与项目 Server 保持在线。

## 发布流程修复

- `scripts/release-desktop.py` 现在在上传并验证公开安装包后执行桌面安装包保留预览。
- 默认只返回 `review_required` 清单，不删除文件。
- 显式传入 `--apply-retention` 后，才会应用经过文件身份、发布清单和硬链接校验的保留计划。
- 规则仍保留每个更新渠道最近三个版本，以及发布清单引用和兼容性门禁要求的版本。

## 本地验证

- `python -m unittest scripts.test_release_desktop -q`：20/20 通过。
- 生产稳定性探针：磁盘、Nginx、PM2 和回执文件检查通过。

## 边界

- 系统盘仍未达到数据库备份恢复门禁所需的安全余量；本轮没有创建新生产备份、迁移数据库或部署候选版本。
- 活动服务版本和 HTTP 健康状态在清理后保持正常，但这不是长时间连续可用性证明。

## 当日第二次清理：Web 静态副本

- 重新连接生产主机，发现旧清理范围遗漏了 `apps/web/out.prev*`、`out.previous*`、`out.rollback*`、带时间的 `out.*`、`.capture-final.*`、`.selection-final.*`、`.helstera-static.*`、`.closure-static.*` 及 `.local-workspace-*` 静态发布副本。
- 一共删除 129 个经过清单确认的目录，另包括旧 `apps/web-pricing-stage`、`.qiniu-release.9pBctb` 和 `/www/helstera-backups`。`.local-workspace-*` 已检查为发布后的 HTML、JS、下载目录副本，并非用户本地工程。
- 删除前检查绝对路径、目录身份、时间戳、挂载点、Nginx 配置引用、PM2 进程路径、`/proc` 工作目录/文件描述符/映射及当前应用符号链接；检查通过后按清单逐个删除。
- 目录之间存在硬链接。分别统计目录得到的 114.11 GiB 不等于可释放空间；本轮只采用文件系统实测差值：`/www` 从 35,969,306,624 字节可用升至 62,708,424,704 字节，实际释放 **26,739,118,080 字节（24.90 GiB）**。
- 清理 `/root/.cache/pnpm` 包元数据缓存、`/root/.npm/_cacache` 和 `/root/.cache/pip`；检查没有缓存文件被进程打开后删除。系统盘实际释放 **902,459,392 字节（860.65 MiB）**。未删除 `/www/.pnpm-store` 或 Chromium 安装目录。
- 最终 `df -P`：系统盘可用 3,734,552 KiB，使用率 89%；业务盘可用 61,238,696 KiB，使用率 22%。分别约 **3.56 GiB / 58.40 GiB**。
- `nginx -t` 成功；首页、`/video`、`/fashion-gallery/`、`/api/health` 均 HTTP 200。未登录的 `/api/agent/browser/sessions` 返回 HTTP 401，没有复现 502。
- 蓝色 API / Worker PID 保持 1027 / 1030，PM2 重启次数均为 0。健康接口仍报告 `0.0.0-stability-20261110-1`。
- 当前服务目录、PostgreSQL、用户上传素材、浏览器依赖及公开下载目录保留。其他网站的备份没有作为 Helstera 残留删除。本轮没有重启、切流或部署。
- 远端清单及实际删除回执：`/tmp/helstera-backup-cleanup-20261114.json`、`/tmp/helstera-backup-cleanup-20261114-result.json`。它们只含路径和文件系统元数据。
- 系统盘仍低于先前 6 GiB 的恢复余量要求；后续隔离恢复与候选构建应使用有余量的业务盘，并按真实预计写入量重新验算门禁。
