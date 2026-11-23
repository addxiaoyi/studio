# Backblaze B2 接入进度

2026-11-23，Asia/Shanghai。用户指定 Backblaze B2 替代此前待办的七牛异机备份，并选择「先保留 3 份，控制在免费存储内」。

## 已完成

- 已在现有账号创建专用桶 `helstera-studio-backups-20261123`，bucket ID `2ae9cd0fb16f0684a32d0317`。
- 控制台确认类型 Private、服务端加密 Enabled、Object Lock Disabled，endpoint 为 `s3.us-east-005.backblazeb2.com`。
- 最新生产加密归档为 `20261123T130859Z.tar.enc`，2,276,957,011 字节，三份同等大小归档约 6.83 GB。
- 本地代码新增独立 B2 凭据配置、版本完整删除和分页、上传前容量检查（包括旧版本和未完成分片）、相同对象重复提交复用、完整下载 SHA-256 校验与禁止覆盖已有恢复文件。
- B2 容量限制设为 10,000,000,000 字节，保留三份；上传成功后才删除过期归档，暂时需要容纳第四份。超出预算则停止上传并由既有监控告警。B2 免费容量按账号合计，其他桶增量需要相应扣减预算。
- 新增六项 S3 配置/清理/分页/容量回归通过，既有五项加密与监控回归通过，脚本语法检查通过。

## 尚未执行

- 创建仅作用于该桶及 `helstera-backups/v1/` 前缀的读写应用密钥，存入服务端 mode-0600 文件；不得使用或重新生成 Master Key。
- 部署代码与 B2 配置，设置 `offsiteKeep=3`、`offsiteEnabled=true`、`storageVersioned=true`、`storageMaxBytes=10000000000`。
- 上传既有加密归档，验证匿名不可读、对象大小、SHA-256、版本清理权限。
- 完整下载、解密、恢复验证，更新 offsite 成功收据并复核监控恢复。

生产仍保持此前的本机备份及监控配置；B2 尚未接入、尚未上传文件，不能将本次桶创建视为异机备份完成。`M:/loomic-builds/launch-20261123/configure-b2-backup.py` 已准备好后续配置，但没有执行。

## 中断原因

Backblaze 的 Application Keys 页面可见且账号已登录，但桌面控制工具反复失去窗口状态，最终自动终止本轮 Computer Use：无法可靠确认当前 Windows 浏览器 URL，无法执行权限校验。受限应用密钥尚未生成，未读取、保存或导出任何 B2 密钥。后续应从该页面继续，不能重复创建桶。

## 官方依据

- [B2 定价](https://www.backblaze.com/cloud-storage/pricing)：前 10 GB 存储免费，公开按量价格 $6.95/TB/30 天；免费流量依据月均存储量计算，不能把免费存储等同于无限免费流量。
- [创建应用密钥](https://www.backblaze.com/docs/cloud-storage-create-and-manage-app-keys)：可限定桶、前缀和读写权限，密钥正文只显示一次。
- [S3 兼容权限](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys)：按名称删除与永久删除版本需要不同权限，永久清理必须包含版本 ID。

本地临时 SSH 凭据收尾删除；既有加密备份私钥继续保留，不应随临时凭据清理。
