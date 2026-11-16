# 2026-11-15 私有资产读取边界

工作目录沿用 `Loomic-continuation-20261112/Loomic`。本轮未部署、未读写生产数据库，也未删除真实用户资产。

## 供应商临时链接

原 `/api/provider-assets/:assetId` 验证短期签名后，只按资产 ID 读取 `asset_objects`。与普通下载不同，它没有检查软删除、到期或私有素材所有者的成员权限。因此用户删除素材后，已有签名在有效期内仍能访问原始照片；超过三天、尚未物理清理的原始上传也仍可读取。

新增真实 PostgreSQL 回归先复现两项错误响应（200，预期 404），修复后通过。现在签名读取与普通下载共用资产存活条件；私有资产还要求所有者当前属于工作区。签名仍限定一个资产和原有有效期，没有扩大权限。临时供应商响应改为 `private, no-store`，不让缓存延续已撤销的读取。

## 本地文件路径

普通下载、供应商链接和项目缩略图原来只检查字面路径在 storage 根目录内。新增三个真实目录链接用例证明，Windows junction（Linux 为目录 symlink）能够让这些入口返回根目录之外的文件。修复前 3/3 失败，修复后通过。

三个入口现在先验证字面路径，再解析根目录和目标文件的真实路径并核对包含关系，最后仅允许普通文件。传统无 bucket 的布局仍可在主位置不存在时读取；权限错误或非法路径不会触发备用布局。此修复不宣称防御持有主机写权限者在校验与打开之间进行任意文件系统替换。

## 私有预览缓存头

预览 304 分支原来在设置 Cache-Control/Vary 前提前返回。现条件请求也保留私有素材的 `no-store` 及 `Vary: Authorization, Cookie`；共享工作区预览继续保留原有 private 缓存策略。回归覆盖共享与私有两种预览。

## 验证

- 8 个文件、24 项定向测试通过：供应商生命周期、私有生命周期、云副本释放、本地文件/预览、路径边界、预览缓存、保留清理及签名。
- Server `tsc -p tsconfig.json --noEmit` 通过。
- 两个新增测试文件 Biome 通过；`git diff --check` 通过。没有把现有 `local-assets.ts` 全文件格式化或声称全仓 lint 通过。
- 原始证据位于 `.creative-test-results/provider-lifecycle-red-20261115.log`、`asset-path-red-20261115.log`、`assets-verified-20261115.log`、`assets-typecheck-20261115.log`。

本次仅新增业务改动到 `apps/server/src/http/local-assets.ts`；现有及新增回归为 `local-assets.test.ts`、`provider-assets.postgres.test.ts`、`local-assets-boundary.test.ts`。此前已存在的媒体预览和其他文件改动保留。

## 临时数据库

仅新建一次性 PostgreSQL 17，监听 `127.0.0.1:52478`。结束时隔离测试 schema 数为 0、其他客户端连接为 0；随后正常停止，端口无监听、PID 文件不存在。

目录：`D:/UserCache/Temp/helstera-assets-audit-_rwejw_8`。检查绝对目标、PID 和 reparse point 后执行递归清理，被自动审批拒绝，仅返回 `blocked by policy`。未更换机制重试，目录保留。没有操作其他 PostgreSQL 服务或旧测试目录。
