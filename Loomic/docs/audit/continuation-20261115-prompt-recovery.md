# 2026-11-15 提示词恢复、私有资产与后台排空

本轮继续完善当前工作树，没有生产部署、费用操作或真实资产删除。r3 替代本地 r2 候选，但不是生产发布完成证明。

## 提示词库完整使用流程

- 查询与分类切换立即取消旧请求；即使旧请求忽略取消后返回，也不能覆盖新结果或错误状态。
- 接入已有 API 分页，可读取首批 100 条之后的内容。下一页失败保留已显示内容，重试同一个 offset，连续点击不会跳页。
- API 内容、分类与分页结构验证后才渲染；错误响应不再冒充空列表。
- 剪贴板不可用时显示重试及手动复制提示，展开完整文字；成功状态有可访问的提示并清理计时器。
- 选择的提示词先写入浏览器会话存储再导航，返回地址规范化为同源路径，拒绝外部地址、协议链接及带认证信息的地址。保留画布 id、会话参数和片段。
- 存储被拒绝时保留当前页面/草稿并提示；首页和聊天输入框恢复失败不会崩溃。超过 8,000 字的提示词不静默截断或消费。
- 附件上传期间 `/prompts` 和 `/提示词` 只提示等待，既不加入待发送队列，也不在上传完成后意外发给模型。

新增 `prompt-library` 数据边界、`usePromptLibrary` 请求状态、单独卡片和 `prompt-selection` 交接函数；没有引入新的 UI 框架或动画系统。

## 验证

- Web 全套在首轮代码后为 848/848 通过。随后补了上传期间命令不可误发送的 1 项回归，最终提示词/输入框定向集为 31/31 通过；不能把这两次执行简单相加。
- Web 类型检查通过；最终生产构建 68/68 页面成功。
- 使用实际构建产物的 Chromium 回归通过：503 重试、第二页、真实剪贴板、320px 无横向溢出、拒绝外部返回链接、回到真实 Home 输入框并填入完整提示词、无 pageerror。API 使用明确的本地测试路由，不证明生产登录或提示词数据库可用。
- 新增/重写的 9 个提示词与浏览器测试文件通过 Biome；没有宣称大型既有 ChatInput/Home 文件及全仓 lint 清零。
- CI 添加提示词回归、私有资产 PostgreSQL/目录边界回归、后台排空故障测试；CI 配置测试 4/4 通过，189 个引用的测试路径均存在。没有推送，远端 CI 未运行。

浏览器证据：`.creative-test-results/prompt-browser-final-20261115.log`、`prompt-browser.json`、`prompt-browser/.../prompt-mobile.png`。单元证据：`web-prompts-full-20261115.json`、`prompt-flow-final-20261115.log`。

## 并行修复与补验

- 供应商签名读取现在与普通私有素材读取遵守相同删除/到期和成员权限；三种文件入口阻止 junction/symlink 逃逸存储根目录。24/24 相关用例通过，包括真实 PostgreSQL。见 `continuation-20261115-private-assets.md`。
- Goal/Step/Queue 的未解决持久化或释放失败会阻止 drained 回执；停止先等其他活动任务及各阶段清理完成，再汇总错误。43/43 定向回归通过；最后合并的运行时/资产子集 40/40 通过。见 `continuation-20261115-drain-errors.md`。
- Desktop 原先 9 项跳过均经真实 FFmpeg 和 MCP 子进程补验通过，去重合并为 210 项通过。官方 Electron 33.4.11 文件已恢复并逐文件核验，但正常 Chromium 模式启动前 `STATUS_BREAKPOINT`；真实 AgentGoal 为 18 通过、1 失败，renderer 健康检查亦失败，不能称桌面 UI 已验收。见 `continuation-20261115-desktop-runtime.md`。

## r3 候选

`.codex-release/production-closure-20261115-r3.zip`：166,471,021 字节、4,334 条目。

SHA-256：`d68599f776b74c987be5ce427090a2c4c569021faa961f1b21f8068bbd1208ef`。

完整 manifest 与动态运行时校验通过；本轮六个关键 Server 文件再次与工作树逐字节核对一致。`.codex-release/LATEST.json` 指向 r3，明确 `deployed: false`。动态运行时依然来自之前核验的本地构建缓存，不改称本轮 vendor 重建。

## 未完成边界

生产图库 502 尚未取得服务器日志与有效认证，不能把本地修复当作线上根因已解决。真实 Electron 启动故障、剩余 OneTake 语音/外部环境测试以及全仓 lint 仍需继续。

本轮私有资产和 Electron 测试的临时 PostgreSQL 均已停止，52478 与 61650 无监听；临时静态服务器 3441 已关闭。自动审批分别拒绝删除新集群目录，仅返回 `blocked by policy`，未换机制重试；目录保留：`D:/UserCache/Temp/helstera-assets-audit-_rwejw_8`、`D:/UserCache/Temp/helstera-electron-pg-eeu4gowp`。未操作其他数据库服务。
