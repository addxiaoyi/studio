# 桌面应用当前状态核验

2026-11-23，Asia/Shanghai。当前公开 Windows、macOS Intel/ARM 和 Linux 安装包及更新清单均为 0.2.30；四个平台的安装文件 HEAD 均返回 200，更新清单版本与发布清单一致。

Windows 本机已安装 0.2.18、0.2.23 和 0.2.30。0.2.30 位于 `M:/loomic-builds/desktop-update-acceptance/Helstera/Helstera.exe`，其 `app.asar` SHA-256 为 `f8cdba0a7728684fc584e6817980e63634dde4088d85f7ba4bee9c45835b5bee`，与原发布验收载荷一致。原发布提交 `51e0148b` 到当前分支的桌面主进程、界面源码及打包配置没有变化；网站与服务端的后续更新不等于桌面安装包重新发布。

## 本轮实际通过

- 在独立 profile 和空白测试工作区启动已安装的 Windows 0.2.30，7 项生命周期检查通过：断网恢复页、断开显示器后的窗口位置回收、重新连接与 preload、连接超时、渲染进程崩溃恢复、第二次启动恢复原窗口、重启后窗口位置保持。
- 原生存储检查通过：扫描速度保存、目录匹配选择重启恢复、确认前不修改文件、素材重新关联、两个工程引用核对、确认后合并重复内容、原路径及素材 ID 保留、合并后实际播放。约 16.8 MB 数据在 8 MiB/s 设置下读取耗时 2375 ms；测试没有云端请求。
- 应用加载真实 `https://studio.0st.top/desktop-app/`，桌面导航与登录入口正常渲染，无页面脚本错误；原生 bridge 返回 0.2.30，网页未暴露 Node `require` 或 `process`。本机离线快照库可以打开。
- 原发布 CI [42821637498](https://github.com/addxiaoyi/studio/actions/runs/42821637498) 及当前分支四平台候选 CI [45200548112](https://github.com/addxiaoyi/studio/actions/runs/45200548112) 均为 success。本轮没有在新的 macOS/Linux 真机重新安装或运行，只核对其下载、更新清单及既有 CI。

## 本机入口修复

开始菜单 `Helstera.lnk` 原先指向 `M:/测试/Helstera/Helstera.exe`（0.2.18），现指向上述已验收的 0.2.30。原快捷方式备份到 `M:/loomic-builds/launch-20261123/Helstera-before-shortcut-fix.lnk`。

当前用户 `helstera://` 协议原先指向 11 月 4 日临时候选目录，现同样指向 0.2.30。只修改应用自身协议的启动命令，原值保存在 `desktop-protocol-fix.json`。旧安装目录和用户数据均保留，没有覆盖日常工作区。

## 仍需区分的边界

- Windows 0.2.30 的 Authenticode 状态实测为 `NotSigned`。macOS 发布记录仍为未签名 DMG、手动更新；签名和公证尚未完成，不能称为无提示的公众分发体验。
- 隔离测试模式刻意禁用系统浏览器登录，未执行新的「浏览器授权 → 回到桌面 → 读取原项目」完整登录。生产桌面登录入口能加载，不等于这次已经验证实际登录回跳。
- 真正的支付回调到账、供应商现金账单核对及 11 月 24–25 日 B2 完整恢复仍按网站上线验收记录处理。

本机收据：`M:/loomic-builds/launch-20261123/desktop-installed-check.json`、`desktop-public-check.json`、`desktop-lifecycle-check/report.json`、`desktop-storage-check/report.json`、`desktop-live-start/report.json`、`desktop-shortcut-fix.json`、`desktop-protocol-fix.json`。测试应用已退出，未执行付费生成或充值。
