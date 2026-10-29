# helstera 桌面端架构独立评审

- 评审对象：Electron 壳（`apps/desktop/electron/*`）+ 远端 Web 桌面路由（`apps/web/src/app/desktop-app/*`、`apps/web/src/components/desktop-*.tsx`、`agent-marketplace-page.tsx`）+ 服务端 `agent-marketplace` 接口。
- 本轮改动：toast/connection-banner/empty-state、`lib/realtime-status.ts`、`lib/desktop-copy.ts` 四组件迁入、侧栏 roving tabindex、标题栏 quick-open 焦点归还与 `routerRef`、全屏 IPC 三件套、installed 列表 `available` 字段。
- 方法：只读代码 + 交叉验证（渲染侧 ↔ preload ↔ main ↔ 路由装配 ↔ 测试断言），不修改任何实现。所有结论标注证据行；无法静态确认的标注【推断·需真机验证】。
- 基线采信：三端 `tsc --noEmit` 为 0、web 416 / server 602 / desktop 117 用例通过（本轮未复跑，仅作为既有事实背景）。

---

## 0. 结论摘要

1. **壳与页面的责任划分已经裂成 3 种装配形状**：`DesktopModule`（4 个 mode）、裸 `DesktopToastProvider`（4 个 mode）、以及完全不经过壳的 3 条 Web 路由。同一批组件在两种宿主里行为不同，且差异不可见。
2. **最严重的架构问题不是新代码写错，而是「降级路径太安静」**：`useDesktopToast` 在缺少 Provider 时返回 `NOOP_API`（`desktop-toast.tsx:79-86`），而 `/download`、`/desktop`、`/(workspace)/marketplace` 三条路由确实没有 Provider —— 至少 **24 处 `toast.push` 在生产环境静默失效**，测试却自建 Provider 把它们全部标绿。
3. **IPC 契约没有单一来源**：`preload.ts` 自己维护的 `declare global Window.electronAPI` 已经漂移，**漏掉 6 个已暴露成员**，其中就包括本轮新增的全部 3 个全屏 API；渲染侧另外各自手写第三、第四份类型。两侧的回归测试各测自己的字符串常量，没有任何测试校验它们相等。
4. **`realtime-status` 是「只发不收」的模块级单例**：卸载不发 `disconnected`（`use-websocket.ts:142` 的守卫），而 `DesktopConnectionBanner` 挂载时会读快照（`desktop-connection-banner.tsx:49`），于是「进入一个根本没有 socket 的 mode」会永久显示"正在重新连接…"。
5. **「Web 与内核异步」的系统性风险目前只靠注释兜底**：`desktop-titlebar.tsx:42` 的注释写着"older than 0.2.19"，但 `getAppVersion()` 只被用来在设置页展示版本号（`desktop-settings-page.tsx:102`），没有任何代码做版本闸门或桥能力协商。

总评：**功能是通的，但边界是「偶然而非设计」形成的**。本轮交付质量本身不差（`isInstallAvailable` 的 `!== false` 向前兼容、`resolveDesktopLocale` 的显式来源、`warnMissing` 的回退策略都属于正确做法）；问题集中在装配层缺少约束，导致同类缺陷可以静默复发。

---

## 1. 边界与耦合

### 1.1 壳到页面：8 个 mode，3 种装配形状

`DesktopAppPage` 的分支在 `desktop-app-page.tsx:193-200`：

| 分支 | 行 | 装配形状 | Toast | 连接横幅 | `<main>` 外壳 |
|---|---|---|---|---|---|
| canvas | 193 | `DesktopModule` | ✅ | ✅ | 壳提供 |
| projects | 194 | `DesktopModule` | ✅ | ✅ | 壳提供 |
| assets | 195 | `DesktopModule` | ✅ | ✅ | 壳提供 |
| marketplace | 196 | `DesktopModule` | ✅ | ✅ | 壳提供 |
| settings | 197 | 裸 Provider | ✅ | ❌ | 页面自备 |
| mcp | 198 | 裸 Provider | ✅ | ❌ | 页面自备（`desktop-app-page.tsx:433`） |
| development | 199 | 裸 Provider | ✅ | ❌ | 页面自备（同上） |
| **home（默认兜底）** | 200 | 裸 Provider | ✅ | ❌ | 页面自备（`:376`） |

三个结构性问题：

- **`DesktopModule` 承担了 3 件不相干的事**：Provider、横幅、`<main>` 外壳（`desktop-app-page.tsx:436-445`）。因此任何不走它的分支必须**自己重新实现外壳**（`:376`、`:433`）。这是"责任划分不清"的根源——壳的能力不是通过容器继承的，而是靠每个分支自觉复制。
- **`mode` 类型含 `"home"` 却没有对应分支**（`:107` vs `:193-200`）：`mode === "home"` 落到默认 return。副作用是任何**未知 mode 静默变成首页**，而不是 404/报错。加 mode 时忘记加分支，线上表现为"页面打不开但没报错"。
- **连接横幅只在 4/8 mode 存在**（仅 `:439`），而这 4 个里真正拥有 WebSocket 的只有 canvas（唯一调用点 `app/canvas/page.tsx:195`）。projects/assets/marketplace 挂了一个永远收不到事件的横幅，见 §3.2 的后果。

### 1.2 隐性 no-op 坑：Toast Provider 缺三处（本轮最该修的一条）

降级选择本身是合理的（宁可无 toast 也别崩），但它是**静默**的：

```
desktop-toast.tsx:79-84  useDesktopToast() → api ?? NOOP_API
desktop-toast.tsx:86     const NOOP_API = { push: () => {}, dismiss: () => {} }
```

而三个 `useDesktopToast` 消费组件被**不带 Provider 的 Web 路由**直接渲染：

| 消费组件（`useDesktopToast` 行） | 被这条路由渲染 | 该路由有 Provider 吗 |
|---|---|---|
| `agent-marketplace-page.tsx:282` | `app/(workspace)/marketplace/page.tsx:1-5` | ❌ 整文件只有 5 行，无 Provider |
| `desktop-mcp-panel.tsx:228` | `app/desktop/page.tsx:10` | ❌ 无 Provider |
| `desktop-download-list.tsx:61` | `app/download/page.tsx:5` | ❌ 无 Provider |

受影响调用点（`grep toast\.` 实测）：

- `agent-marketplace-page.tsx` 15 处（`:413,432,436,446,458,474,478,518,529,561,567,601,613,632,636`）
- `desktop-mcp-panel.tsx` 6 处（`:323,332,362,379,432,455`）
- `desktop-download-list.tsx` 3 处（`:101,103,182`）

合计 **24 处**。后果分级：`desktop-download-list.tsx:182` 是用户主动点击的复制/下载确认，`desktop-settings-page`/下载页的失败提示（`:101`）同样是错误可见性——**失败对用户完全不可见**。

**测试为什么没拦住**：两条集成测试都替生产环境补了一个 Provider。

- `test/desktop-download-feedback.test.tsx:45-48`：`render(<DesktopToastProvider><DesktopDownloadList/>…`
- `test/desktop-mcp-panel.test.tsx:442-445`：同样的包裹

测试断言的是"在 Provider 内 toast 会出现"，而生产页面根本没有 Provider。**测试验证了一个生产不存在的宿主**。

### 1.3 同类位置（同名坑的完整清单）

| # | 位置 | 症状 |
|---|---|---|
| 1 | `desktop-toast.tsx:79-86` × 3 条 Web 路由 | toast 静默 no-op（见 §1.2） |
| 2 | `desktop-app-page.tsx:439` | 横幅只在 `DesktopModule` 内；4 个 mode 无横幅（漏挂） |
| 3 | `desktop-app-page.tsx:200` | 未知 mode 静默降级为 home |
| 4 | `app/layout.tsx:136` vs `(workspace)/layout.tsx:79` | **桌面 chrome 被拆到两个 layout**：标题栏在根 layout（全站生效），桌面侧栏只在 `(workspace)` 内；但侧栏的跳转目标是 `/desktop-app/canvas/`（`desktop-workspace-sidebar.tsx:105`）、`/desktop`（`:41`）、`/settings/`（`:117`）三个不同路由族，跳到 desktop-app 后侧栏消失 |
| 5 | `desktop-workspace-sidebar.tsx:112` | `aria-current` 只在 `pathname === "/desktop"` 成立，用户在 `/desktop-app/*` 时**没有任何项被标为当前页** |
| 6 | `desktop-app-page.tsx:44-97` + `:175-185` | `lib/desktop-copy.ts` 号称单一来源，但桌面壳最大页面仍保留**私有字典 2 份**（`DESKTOP_COPY` 与登录内联三元） |

---

## 2. IPC 契约

### 2.1 命名：一个特性用了三套约定

| 层 | 全屏相关通道 | 同特性既有兄弟 | 证据 |
|---|---|---|---|
| invoke（动作） | `window-fullscreen`（连字符） | `window-minimize` / `window-maximize` / `window-close` / `window-state` | `preload.ts:49`、`window-controls.ts:82` |
| invoke（查询） | `desktop.fullscreen-state`（点号） | `desktop.navigation-state` / `desktop.update-state` | `preload.ts:50`、`window-controls.ts:88` |
| 事件下行 | `desktop:fullscreen-changed`（冒号） | `desktop:navigation-state` / `desktop:login-state` / `window-state-changed` | `preload.ts:56`、`window-controls.ts:134` |

单条特性横跨三种分隔符。仓库整体已存在**三套**历史约定（`window-*`/`desktop.*`/`desktop:*`），所以这不是本轮引入的新债，但**本轮把三套约定同时用在了同一个特性上**，让"该照哪个抄"彻底失去参照。`desktop:fullscreen-changed` 与 `desktop:navigation-state` 也不对称（前者 `-changed` 后缀，后者没有）。

### 2.2 返回值与错误处理：桥上有两套错误语义

| 语义 | 例子 | 证据 |
|---|---|---|
| 结构化信封 `{ok, message?}` | `startBrowserLogin` / `openBrowserPairing` / `connectEmbeddedAssistant` | `main.ts:496-501`、`main.ts:511-514` |
| 直接 `throw`（渲染侧只拿到 Electron 包装后的串） | 全部 `window-*` / `desktop.*` 窗口控制 | `window-controls.ts:47-56` |

同一座桥上两种错误约定，渲染侧必须写两套 catch。实际后果：

- **动作类返回值是「回读值」而非「确认值」**：`window-fullscreen` 先 `setFullScreen(...)` 再立刻 `isFullScreen()` 回读（`window-controls.ts:83-86`），`window-maximize` 同样（`:76-81`）。渲染侧把这个回读当作真值直接 `setIsFullScreen(state.isFullScreen)`（`desktop-titlebar.tsx:374-375`）。若底层窗口状态切换是异步的，回读会得到旧值，按钮图标先闪一下再被事件纠正。【推断·需真机验证：Electron `isFullScreen()` 在 Windows 上 `setFullScreen` 之后是否同步生效】——注意单元测试把同步性**硬编码进了假窗口**（`window-controls.test.ts:24` 的 `setFullScreen` 直接赋布尔），所以测试永远无法证伪这个假设。
- **`closeWindow` 名实不符**：macOS 上 handler 执行的是 `hide()` 而不是 `close()`（`window-controls.ts:91-95`），渲染侧类型是 `() => Promise<void>`（`desktop-titlebar.tsx:49`），调用方无法知道"没退出"。
- **失败原因在边界上被丢弃**：4 个动作统一映射成硬编码中文（`desktop-titlebar.tsx:359-366`），`getFullscreenState` 的失败更是被**完全吞掉**（`desktop-titlebar.tsx:230` `.catch(() => {})`），而同层的 `getWindowState` 失败会 `setChromeError`（`:216`）。同一批调用三种处置。

### 2.3 类型声明不是单一来源（本轮新 API 正好落在缺口里）

`preload.ts` 在文件尾维护 `declare global { interface Window { electronAPI?: {...} } }`（`preload.ts:216-292`）。把**实际暴露的 58 个键**与**声明的 52 个键**做差集，结果是：

**暴露但未声明（声明缺失，6 个）**：
`windowFullscreen`、`getFullscreenState`、`onFullscreenState`、`onFocusAgentInput`、`selectAssetFolder`、`writeAssetToLocal`

**声明但未暴露**：0 个。

也就是说：**本轮新增的全部 3 个全屏 API 一个都没进类型声明**，而 `tsc --noEmit = 0` 依然成立——因为 `apps/desktop` 里没有任何代码引用这些成员，声明漂移不可见。同时 `apps/web` 看不到这个声明（跨包），于是渲染侧各自手写：

| 手写副本 | 行 | 缺什么 |
|---|---|---|
| `desktop-app-page.tsx:25-32` | `DesktopApi` 6 个成员 | 无窗口控制 |
| `desktop-titlebar.tsx:35-54` | `DesktopWindowApi` | 全屏三项标成 optional（与本轮交付不符） |
| `desktop/page.tsx:16-22` | `DesktopLoginApi` 3 个成员 | 其余全缺 |
| `test/desktop-titlebar.test.tsx:40-43` | 测试里第四份 | 与实现无任何关联 |

**一份真实契约、四份手写副本、零个自动校验**。这是 Q2 里我认为最需要修的结构性问题：它不是"探测层次对不对"的问题，而是"探测的对象没有权威定义"。

### 2.4 能力探测放在渲染侧：层次基本正确，但探测方式选错了

`typeof api?.windowFullscreen === "function"`（`desktop-titlebar.tsx:497`）放在渲染侧是**对的**——内核版本未知，只有渲染侧在运行时知道桥长什么样，主进程没法替它决定 UI。这条不该改层次。

问题在**探测语义**：

- 存在性探测无法区分「未实现」与「实现了但坏了」。`getFullscreenState` 存在但通道改名时，渲染侧会挂载按钮、然后静默吞错（`:230`），用户看到的是一个能点但状态不更新的按钮。
- 存在性探测无法表达**可选订阅**：`onFullscreenState?.()`（`:224`）之后 `stopFullscreenUpdates` 可能是 `undefined`，清理函数只能写 `?.()`（`:237`）——这是靠可选链兜住的隐性分支，不是契约。
- 代码里已经有一个**更好的信号但没用**：`getAppVersion()` 存在且可用（`preload.ts:106` / `main.ts:489`），目前只在设置页展示（`desktop-settings-page.tsx:102`）。而 `desktop-titlebar.tsx:42` 的注释已经在做版本判断（"older than 0.2.19"）——**人能看懂的那条判断，机器没有执行**。

### 2.5 授权逻辑重复（安全相关）

主窗口白名单校验存在两份实现，逻辑与错误串完全相同：

- `main.ts:186-193`（`requireMainWindow(event)`，被业务通道使用）
- `window-controls.ts:47-56`（`requireMainWindow(event, options)`，被窗口通道使用）

两份都判定 `sender !== mainWindow || isDestroyed()`。今后任一侧加固（例如增加 origin 校验、增加 `webContents` id 比对），另一侧会静默保留旧策略。信任边界上的复制粘贴，比业务逻辑的复制粘贴更危险。

---

## 3. 状态管理

### 3.1 双源并存，且只有一个方向

`realtime-status.ts` 的模块级单例（`:13-15`）与 `use-websocket` 的 React state（`use-websocket.ts:51`）并存：

```
realtime-status.ts:13-14   const listeners = new Set(); let current = "disconnected";
realtime-status.ts:19      if (status === current) return;   // 同值不发
use-websocket.ts:92-93     setConnected(true);  publishRealtimeStatus("connected");
use-websocket.ts:144-145   setConnected(false); publishRealtimeStatus("disconnected");
```

两源在正常的 open/close 路径上是同步的，不算双源不一致。真正的问题是**总线缺少 owner 概念**：

- **卸载不发状态**：effect 清理只 `close()` 并置空（`use-websocket.ts:210-215`），而 `onclose` 里有守卫 `if (wsRef.current !== ws) return;`（`:142`），卸载路径被这个守卫吞掉，因此 `current` 停在 `"connected"`。
- **`hasConnectedOnce` 永不复位**：只在测试里被重置（`realtime-status.ts:15,36,48-52`）。

两者组合出的可复现路径（静态可推）：

1. 进 canvas，socket 连上 → `current = "connected"`，`hasConnectedOnce = true`。
2. socket 掉线（如重启服务端）→ `current = "disconnected"`，横幅显示"连接已断开，正在重新连接…"（`desktop-connection-banner.tsx:87-89`）。
3. 用户切到 projects/assets/marketplace —— 这些 mode **有横幅但没有 socket**（§1.1）。
4. 横幅重新挂载，读快照 `getRealtimeStatus() === "disconnected" && sawConnected === true` → **立刻显示"正在重新连接…"**（`desktop-connection-banner.tsx:49`）。
5. 这些 mode 永远不会有 socket，横幅**永久错误陈述**。

也就是说：**横幅在向用户承诺一个不存在的重连**。这正是"双源 + 单例 + 无 owner"的典型后果——总线只知道"最后一个人说了什么"，不知道"现在有没有人"。

补一句正面评价：`publishRealtimeStatus` 的 `try/catch` 包裹订阅者（`realtime-status.ts:22-27`）和横幅的"冷启动不闪"设计（`:44`、`:35`）都是正确的取舍。

### 3.2 多窗口 / 多标签

- **多 BrowserWindow**：每个 renderer 独立模块实例，`current` 天然隔离，互不干扰。跨窗口一致性本来也不成立（窗口 A 的 socket 挂了不会影响 B），这符合预期。
- **同窗口多 socket**：`use-websocket` 没有单例约束，两个组件各调一次就会建两条连接。而连接标识走 `sessionStorage`（`use-websocket.ts:36-44`），**同一个 tab 内所有 hook 实例共享同一个 `connectionId`**；代码注释本身说明了服务端会用新连接替换同 id 的旧连接（`:138-141`）。因此同 tab 双挂载会互相踢下线并触发指数退避 reconnect 风暴（`:152-163`）。目前全仓只有 `app/canvas/page.tsx:195` 一个调用点，属于**潜在**风险而非现存 bug；但这个约束只存在于"我以为只有一个调用点"的隐性假设里。
- **多标签页（浏览器/PWA 打开 `studio.0st.top`）**：模块级状态各自独立，反而是最安全的一种；真正跨标签共享的 `sessionStorage.ws_connection_id` 在浏览器里是 per-tab 的，也不会串。

结论：风险不在"多窗口单例污染"，在"没有机制阻止同窗口双挂载"。

---

## 4. 可演进性：Web 与内核异步

### 4.1 现状机制

- 打包版**无条件**加载远端 Web：`desktopWebsiteUrl()` 在 packaged 时直接返回生产站点（`main.ts:207-210`），`loadURL(desktopHome)`（`main.ts:3287`）。没有版本协商、没有兼容闸门。
- 唯一的兼容手段是**渲染侧的成员存在性探测**（`desktop-titlebar.tsx:497`）。
- 唯一的"版本知识"是一句注释（`desktop-titlebar.tsx:42`），以及设置页展示用的 `getAppVersion()`（`desktop-settings-page.tsx:102`）。

这个组合意味着：**老内核 + 新 Web 是唯一的常态，而且永远不会有新内核 + 老 Web**（Web 只会更新）。所以系统必须只在"能力缺失"方向设计降级——现在的做法方向正确，但缺三个支点：*能力清单*、*最低内核版本闸门*、*双向契约测试*。

### 4.2 约束清单（新增 IPC 时必须满足）

| # | 约束 | 理由 / 现状反例 |
|---|---|---|
| 1 | **新增桥方法一律 optional，渲染侧必须探测后使用** | 老内核加载新 Web 是常态（`main.ts:207-210`） |
| 2 | **探测契约要显式化**：`electronAPI.capabilities: Record<string, number>` 或 `bridgeVersion: number`，不要用函数存在性推断 | 存在性无法区分"未实现"与"实现了但坏了"（`desktop-titlebar.tsx:230` 吞错） |
| 3 | **两端类型单一来源**：`electronAPI` 的类型必须从 preload 导出到 `packages/shared`，禁止渲染侧手写副本 | 现状 4 份副本、声明漏 6 项（§2.3） |
| 4 | **通道命名必须在新增前归类**：invoke 动作 `window-*`、invoke 查询 `desktop.*`、下行事件 `desktop:*`（含统一后缀规则） | 单特性横跨三套（§2.1） |
| 5 | **错误语义统一**：要么全部结构化 `{ok,message}`，要么全部 reject，且渲染侧不得无差别 `catch(()=>{})` | 桥上两套语义（§2.2） |
| 6 | **「动作」不得返回「回读值」冒充确认值**；状态唯一真源是事件流（`enter/leave-full-screen`） | `window-controls.ts:83-86` + 假窗口测试固化同步假设 |
| 7 | **服务端新增字段必须可选**，客户端判定用"显式 false 才算否"，缺失视为兼容 | 正面样板：`agent-marketplace-page.tsx:219-221` |
| 8 | **服务端注释与 SQL 语义必须一致**：`available` 的语义不能依赖 JOIN 类型 | `agent-marketplace.ts:80-82` 声称"record outlive catalog entry"，但查询是 INNER JOIN（`:153`）且外键 `on delete cascade`（migration `:5`）——硬删会让记录**整行消失**而不是 `available:false` |
| 9 | **设置页/诊断入口必须能报出 `appVersion` 与能力清单**，便于线上定位"是内核旧还是 Web 新" | 目前只有展示用版本号（`desktop-settings-page.tsx:102`） |
| 10 | **授权辅助函数单点化**（`requireMainWindow` 只留一份） | 两份副本 `main.ts:186-193` / `window-controls.ts:47-56` |

第 8 条的准确表述：`available` 目前只覆盖 `status ∈ {draft,hidden}` 的软下线；`sold delete` 场景下客户端 `isInstallAvailable` 拿不到 `false`，因为那一行已经不返回了。要么改成 `left join` 并把 `item_status` 为 null 视为 `available:false`，要么把注释改成"仅覆盖软下线"。

---

## 5. 测试策略

### 5.1 现有分布

- Web：`apps/web/test/` 106 文件，其中桌面相关 19 个（18 个 `desktop-*.test.tsx` + `agent-marketplace-page.test.tsx`），全部 jsdom 组件级。
- Desktop：13 个文件（`apps/desktop/package.json:13` 显式枚举），`window-controls.test.ts` 用假 ipc/window 覆盖主进程 handler，含全屏三通道（`:80-81,148-190`）。
- E2E：`apps/web/e2e/`（9 个 spec）+ `playwright.config.ts`，三浏览器 project，**testDir 只有 `./e2e`，没有任何 Electron project**。

### 5.2 缺口（按"会不会掩盖真 bug"排序）

| # | 缺口 | 证据 |
|---|---|---|
| 1 | **preload 完全没有测试**。桥的两侧各测自己的字符串常量，没人校验它们相等 | `apps/desktop` 13 个测试文件无一引用 `preload`；`window-controls.test.ts:80-81` 与 `preload.ts:49-50` 的通道名无任何联系 |
| 2 | **测试自建生产不存在的宿主**（Provider） | `desktop-download-feedback.test.tsx:45-48`、`desktop-mcp-panel.test.tsx:442-445` vs `download/page.tsx`、`desktop/page.tsx` 无 Provider |
| 3 | **路由装配层零测试**：`desktop-app-page.tsx` 8 个 mode 的组装方式、哪些 mode 有 Provider/横幅，没有任何用例 | `desktop-app-page.tsx:193-200` 无对应测试 |
| 4 | **假窗口把"同步回读"假设写死**，导致 `isFullScreen` 时序问题不可能被测出 | `window-controls.test.ts:24` |
| 5 | **无 Electron 端到端**：窗口按钮、全屏、preload 桥、`data-helstera-desktop` 标记、`will-navigate` 外链拦截，全部只有单元级替身 | `playwright.config.ts` projects 只有 chromium/firefox/mobile-safari |
| 6 | **locale 缺键不可断言**：`warnMissing` 只 `console.warn` 且 `warnedKeys` 未导出（`desktop-copy.ts:923,929-934`），英文缺键在 zh-CN 测试里永远不会暴露 | `desktop-copy.test.tsx` 10 个用例不覆盖"零缺键"断言 |
| 7 | **测试清单是显式 allowlist**：`apps/desktop/package.json:13` 逐个列文件，新增 `preload.test.ts` 不会被执行（当前 13/13 齐全，属结构性隐患） | `package.json:13` |

### 5.3 补强建议（按成本从低到高）

| 成本 | 建议 | 类型 | 覆盖的缺口 |
|---|---|---|---|
| ★（分钟级） | **契约测试**：一个不依赖 Electron 的 Node 测试，`import` preload 的通道常量表并与 `window-controls.ts:82/88/134` 的字符串比对；或把通道名抽到 `packages/shared/ipc-channels.ts` 后两边引用，测试断言常量完整性 | 契约测试 | 1 |
| ★ | **装配测试**：`render(<DesktopAppPage mode="settings"/>)` 断言 toast 真的渲染出 DOM（而不是被 no-op 吃掉）；同时断言 3 条 Web 路由页面**不含**需要 Provider 的消费者，或显式为其挂 Provider | 组件测试 | 2、3 |
| ★ | **导出缺键清单**：让 `mergeDesktopCopy` 返回 `{copy, missingKeys}`，加一条 "en-US 缺键数为 0" 的断言 | 单元测试 | 6 |
| ★★ | **`apps/desktop/package.json:13` 改为 `vitest run`**（配 config include），删掉显式枚举 | 配置 | 7 |
| ★★ | **主进程假设外置**：`window-controls.test.ts` 的假窗口不要"瞬间生效"，改为可控延迟，断言"动作返回值可能陈旧、事件才是真源"；或在渲染侧只用事件驱动 `isFullScreen` | 单元测试 | 4 |
| ★★★ | **Electron e2e（最少 3 条）**：① `desktop-app/` 能带 `data-helstera-desktop` 渲染（`preload.ts:3-11`）；② 点全屏按钮后 `isFullScreen()` 真为 true 且按钮 `aria-pressed` 同步（同时验证 §2.2 的时序假设）；③ `will-navigate` 到外站被交给系统浏览器而非窗口内跳转（`main.ts:3177-3185`）。用 Playwright `_electron` 或现有 smoke 脚本 `apps/desktop/package.json:14` 的 `smoke` 通道扩展 | Electron e2e | 5、4 |
| ★★★★ | 服务端 `available` 契约测试：`hidden` → false、`deleted` → 期望 false（会暴露 INNER JOIN + cascade 的语义漏洞） | 服务端契约测试 | 约束 8 |

取舍意见：**只有"跨进程/跨版本边界"值得上 Electron e2e**（preload↔main 的通道、窗口状态、导航策略）。渲染侧的交互继续留在 jsdom——上 Electron 的边际收益低于维护成本。而 1、2、3 三条便宜到没有任何理由不做：它们全都能在本轮改动范围内直接拦住已经存在的静默失效。

---

## 6. 风险清单（按严重度）

| 级别 | 风险 | 证据 | 影响 |
|---|---|---|---|
| **P0** | 3 条 Web 路由无 Toast Provider，24 处 `toast.push` 静默 no-op；测试自建 Provider 掩盖 | `download/page.tsx:5`、`desktop/page.tsx:10`、`(workspace)/marketplace/page.tsx:1-5`、`desktop-toast.tsx:79-86`、`desktop-download-feedback.test.tsx:45-48` | 下载失败、安装失败、卸载失败对用户完全不可见；无报错、无日志 |
| **P0** | 连接横幅在无 socket 的 mode 永久显示"正在重新连接…" | `desktop-app-page.tsx:439` + `desktop-connection-banner.tsx:49` + `realtime-status.ts:14` + `use-websocket.ts:142,210-215` | 向用户陈述不存在的恢复动作，误导排障方向 |
| **P1** | IPC 类型无单一来源，preload 声明漏 6 项（含本轮 3 个新 API），`tsc` 无法发现 | `preload.ts:216-292` vs `:23-171`；渲染侧 3 份 + 测试 1 份手写副本 | 桥的演进完全靠人肉同步；下一轮新增 API 会重复漂移 |
| **P1** | preload 零测试，两侧通道名无契约校验 | `apps/desktop` 13 个测试文件均不引用 preload | 通道重命名可让两侧测试同时全绿而线上全哑 |
| **P1** | 桌面 chrome 跨两个 layout，侧栏跳转跨三个路由族；`/desktop-app/*` 下侧栏消失、无 `aria-current` | `layout.tsx:136`、`(workspace)/layout.tsx:79`、`desktop-workspace-sidebar.tsx:41,105,112,117` | 导航模型不闭合；键盘/读屏用户在桌面模块里失去定位 |
| **P2** | 动作通道返回"回读值"冒充确认值；假窗口测试把同步假设写死 | `window-controls.ts:76-86`、`window-controls.test.ts:24`、`desktop-titlebar.tsx:374-375` | 全屏/最大化图标可能短暂或持续与真实状态不符【需真机验证】 |
| **P2** | 单特性三套通道命名 + 桥上两套错误语义 | `preload.ts:49,50,56`；`main.ts:496-514` vs `window-controls.ts:47-56` | 新人无从参照；错误信息在边界丢失（`desktop-titlebar.tsx:230`） |
| **P2** | `requireMainWindow` 两份实现 | `main.ts:186-193`、`window-controls.ts:47-56` | 信任边界加固可能只落一半 |
| **P2** | 本地化"单一来源"未到底：`desktop-app-page.tsx` 仍有两份私有字典 | `desktop-app-page.tsx:44-97`、`:175-185` | 桌面壳最大页面继续双轨；`desktop-copy.ts` 的缺键保护覆盖不到它 |
| **P3** | `mode` 未知值静默渲染 home | `desktop-app-page.tsx:200` | 新增 mode 忘写分支 = 静默错误页 |
| **P3** | `available` 语义只覆盖软下线，注释过度承诺 | `agent-marketplace.ts:80-82,153,160`、migration `:5` | 硬删场景客户端拿不到 `false`，排障时文档误导 |
| **P3** | 英文缺键只在运行时 `console.warn` | `desktop-copy.ts:923,929-934` | 英文界面静默回退中文，无 CI 拦截 |
| **P3** | `use-websocket` 无单例约束 + 共享 `sessionStorage` connectionId | `use-websocket.ts:36-44,138-142` | 同 tab 双挂载会互踢（当前仅 1 调用点，潜在） |
| **P3** | toast 定时器/去重表无清理 | `desktop-toast.tsx:31,42,49` | 长会话累积；卸载后 `setState` |

---

## 7. 建议重构（按性价比排序）

### #1 把 Provider 从"每个分支自觉挂"变成"路由不可绕过"（成本 ★，收益最大）

- 涉及：新增 `apps/web/src/app/desktop-app/layout.tsx`（挂 `DesktopToastProvider` + `DesktopConnectionBanner`）；`desktop-app-page.tsx:193-200` 去掉 4 处重复 Provider；`desktop-toast.tsx:81-84` 由 `NOOP_API` 改为**开发期抛错**（或在 context 里放 `installed:false` 并让调用点 `if (import.meta.env.DEV) throw`）。
- 顺带把 `/download`、`/desktop`、`/(workspace)/marketplace` 三条路由包上 Provider，或让这三个组件接受"无 Provider 时不渲染 toast 入口"。
- 理由：一次性消灭 24 处静默失效 + 让第 9 个 mode 天然正确。这是本轮唯一的"结构性失败"。
- 影响面：`apps/web/src/app/desktop-app/*`（新增 1 文件）、`desktop-app-page.tsx`、3 条 Web 路由页。

### #2 `electronAPI` 类型与通道名收进 `packages/shared`（成本 ★★，收益高）

- 涉及：新增 `packages/shared/src/ipc.ts`（`IpcChannel` 常量 + `ElectronBridge` 类型 + `bridgeVersion`）；`apps/desktop/electron/preload.ts:23-171,216-292` 改为引用；`apps/web/src/components/{desktop-titlebar,desktop-app-page,desktop-settings-page,agent-marketplace-page}.tsx` 删掉各自的私有接口，改为 `import type { ElectronBridge }`；补一条契约测试。
- 理由：这是 P1 里唯一"越晚做越贵"的一项——每新增一个 IPC，手写副本就多一份。
- 影响面：跨 3 个 workspace 包，但改动是替换类型声明，无运行时行为变化，风险低。

### #3 用事件做全屏状态唯一真源，动作只返回"已受理"（成本 ★，收益中）

- 涉及：`apps/web/src/components/desktop-titlebar.tsx:224-230,374-375` 只保留 `onFullscreenState` 驱动 `isFullScreen`，动作不再 `setIsFullScreen`；`apps/desktop/electron/window-controls.ts:82-90` 注释明确"返回值为瞬时快照，不作为确认"。
- 理由：把【推断·需真机验证】的时序风险从"靠运气"变成"结构上不可能错"。同时顺带修掉 `.catch(()=>{})`（`desktop-titlebar.tsx:230`）。

### #4 给 `realtime-status` 加引用计数（成本 ★★，收益中高）

- 涉及：`apps/web/src/lib/realtime-status.ts` 改为 `publishRealtimeStatus(ownerId, status)` + `unpublish(ownerId)`，`current` 由活跃 owner 集合推导（无 owner → `"idle"` 而非 `"disconnected"`）；`use-websocket.ts:93,145` 传实例 id，`:210-215` 卸载时 `unpublish`；`desktop-connection-banner.tsx:49` 按 `idle/connected/disconnected` 三态渲染，`idle` 时不显示"正在重连"。
- 理由：直接消灭"横幅承诺不存在的重连"，并为将来第二个 socket 消费者做好铺垫（现在是单例最后写入者获胜）。

### #5 桌面 chrome 归位（成本 ★★，收益中）

- 涉及：`apps/web/src/app/desktop-app/layout.tsx` 内挂 `DesktopWorkspaceSidebar`；`apps/web/src/app/(workspace)/layout.tsx:79` 移除；`desktop-workspace-sidebar.tsx:41,105,112,117` 统一到 `/desktop-app/*` 一个路由族并修正 `aria-current`。
- 理由：导航模型不闭合是长期债务，越后面改成本越高（每多一条路由就多一处要迁）。

### #6 服务端 `available` 语义对齐（成本 ★，收益低但便宜）

- 涉及：`apps/server/src/http/agent-marketplace.ts:153`（`join` → `left join`）、`:158-161`（`itemStatus` 为 null 时 `available:false`），或改 `:80-82` 的注释为"仅覆盖软下线"；补一条契约测试。
- 理由：注释与 SQL 不一致会误导下一次改动。二选一即可，不必两者都做。

---

## 附：本轮改动的正面做法（建议保留为团队约定）

- `agent-marketplace-page.tsx:219-221` `available !== false` —— 服务端新增字段的向前兼容判定标准答案。
- `desktop-copy.ts:936-959` 缺键递归回退 + `:929-934` 一次性告警 —— 宁可回中文也不把内部键名渲染给用户。
- `desktop-copy.ts:985-999` 语言来源用显式 prop > `<html lang>`，明确拒绝跟 `navigator.language` —— 理由（`:989-990`）写清楚了，避免下一个人"顺手优化"。
- `realtime-status.ts:22-27` 订阅者异常隔离。
- `desktop-connection-banner.tsx:35,43-44` 冷启动不闪"已断开"。
- `desktop-titlebar.tsx:190-194` `routerRef` 修复：注释把"为什么不能依赖 `router` 依赖项"（会重读窗口状态、吞掉用户刚切的最大化/全屏）说清楚了，属于高质量提交信息。
- `desktop-titlebar.tsx:264-275` 焦点归还放在 effect 清理函数里，覆盖 Escape/点选/编程关闭三条路径 —— 这个取舍是对的。
