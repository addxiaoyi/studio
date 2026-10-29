# helstera 桌面端 · 交互与视觉设计评审规格

> 评审对象：`apps/web/src/app/globals.css`（1923 行）与桌面端反馈/导航/市场相关组件
> 评审方式：**只读代码**。所有数值均来自源码行号或脚本实算，未做真机截图验证的项标注「需真机确认」。
> 色彩对比度由 Node 脚本按 OKLCH→线性 sRGB→WCAG 2.x 公式实算（脚本逻辑：`oklch()` 三参数转线性 RGB 后取相对亮度），下文所有 `x.xx:1` 均为脚本输出，非估计值。

## 0. 评审范围

| 文件 | 行数 | 取证范围 |
| --- | --- | --- |
| `apps/web/src/app/globals.css` | 1923 | 全文检索 + 关键区块精读（1–160、240–260、300–430、436–520、570–610、610–940、940–1360、1860–1923） |
| `apps/web/src/components/desktop-toast.tsx` | 86 | 全文 |
| `apps/web/src/components/desktop-empty-state.tsx` | 35 | 全文 |
| `apps/web/src/components/desktop-connection-banner.tsx` | 91 | 全文 |
| `apps/web/src/components/desktop-workspace-sidebar.tsx` | 122 | 全文 |
| `apps/web/src/components/desktop-titlebar.tsx` | 578 | 180–310、525–578 + 全文 grep |
| `apps/web/src/components/desktop-mcp-panel.tsx` | 918 | 525–560、700–720、815–845、895–915 + 全文 grep |
| `apps/web/src/components/agent-marketplace-page.tsx` | 809 | 232–280 + 全文 grep |
| `apps/web/src/components/desktop-settings-page.tsx` | 287 | 88–147 + `setError` 全文 grep |
| `apps/web/src/components/desktop-download-list.tsx` | — | 125–145 |
| `apps/web/src/lib/desktop-copy.ts` | 1012 | 21–60、109–200、440–450、570–650 + 全文 grep |
| `apps/web/src/lib/i18n.ts` | — | 1–120 |

**先纠正题面的一处假设**：题面说「当前四个空态」。实测 `DesktopEmptyState` 有 **8 个调用点**（MCP 3 + 市场 4 + 下载 1），详见 §3。下面的规格按 8 个实际调用点给，不按 4 个。

---

## 1. 反馈层级：四层其实有六层，且有两层在抢同一个位置

### 1.1 现状（实测穷举）

| 层 | 实现 | 定位 / 层级 | 调用点数量 |
| --- | --- | --- | --- |
| L1 Toast | `desktop-toast.tsx` + `.desktop-toast-viewport`（globals.css:357） | `fixed; right:16; bottom:16; z-index:90` | 40+ 处 `toast.push`（市场 12、设置 10+、MCP 6、下载 3…） |
| L2 断线横幅 | `desktop-connection-banner.tsx` + `.desktop-connection-banner`（:369） | `fixed; top:0; left:50%; z-index:95`（标题栏 z-index 1000 之下，撤 `padding-top:46` 后实际被压在标题栏后面） | realtime socket 状态 + `navigator.onLine` |
| L3 Chrome 错误 | `.helstera-desktop-chrome-error`（:1012）+ `<output aria-live="polite">`（titlebar:525–529） | `fixed; top:52; right:14; z-index:1001` | `desktop-titlebar.tsx:216`、`:220` |
| L4 页内 inline | **9 个互不相同的 class**：`:53` `:177` `:195` `:237` `:414` `:487` `:515` `:550` `:570` | 文档流 | 登录 / 设置 / MCP / 市场 / 任务卡 / 历史 |
| L5 空态 | `desktop-empty-state.tsx` + `.desktop-empty-state`（:373） | 文档流 | 8 |
| L6 破坏性确认 | 浏览器 `confirm` / 页面内确认（如 `copy.mcp.removeConfirm`） | 阻塞 | MCP 移除等 |

### 1.2 问题

**P1-0（最高优先级）断线横幅在桌面端根本不可见 —— 它不是"重叠"，是被完全遮住**

证据链（全部来自源码，无推断成分）：

| 事实 | 出处 |
| --- | --- |
| 横幅 `position: fixed; top: 0; z-index: 95` | globals.css:369 |
| 横幅固定几何：`padding: 7px 14px`、`border: 1px` 且 `border-top: 0`、字号 12px（行高继承 1.5 = 18px）、图标 14px | globals.css:369、370 |
| → 横幅总高 = `7 + 18 + 7 + 1` = **33px** | 算式 |
| 标题栏 `position: fixed; z-index: 1000; inset: 0 0 auto; height: 46px; background: var(--background)`（`--background` 为不透明 `oklch(0.985 0.003 260)`） | globals.css:630–644 |
| 横幅渲染位置：`DesktopModule` 内、`DesktopToastProvider` 的直接子节点，**无任何祖先带 `transform`/`filter`/`contain`** | desktop-app-page.tsx:436–444 |
| 两者同处根堆叠上下文 → z-index 1000 > 95，标题栏在**上** | CSS 级联 |

**结论**：横幅占视口 `y ∈ [0, 33]`，标题栏不透明且覆盖 `y ∈ [0, 46]` → 横幅 **100% 落在标题栏背后，永远看不见**（33 < 46）。

旁证（作者意图与实现错位）：横幅写了 `border-radius: 0 0 8px 8px`（设计成"从顶部边缘垂下来"的挂片，:369），说明作者以为 `top: 0` 位于标题栏**下方**。`body { padding-top: 46px }`（:611）确实把**文档流**下推了 46px，但 `position: fixed` 元素相对视口定位，**不吃 body 的 padding**。意图与实现之间差的正是这一点。

后果：断线 / 重连中 / 已恢复 / 离线四种状态**全部静默**。用户看到的是"页面数据不动了"，没有任何解释。这是本轮反馈层里唯一一处"层级完全失效"的问题，比 §1 P1-2 的重叠严重一个量级。

**P1-1 同一事件被播报两次（有实证）**
`desktop-settings-page.tsx` 的每条失败路径都同时调 `setError(message)` 和 `toast.push({tone:"error"})`：

| 行号对 | 场景 |
| --- | --- |
| `:95` + `:96` | 读取素材目录失败 |
| `:104` + `:105` | 读取版本号失败 |
| `:110` + `:111` | 读取更新状态失败 |
| `:133` + `:134` | 选择目录失败 |
| `:149` + `:150` | 清除目录失败 |
| `:165` + `:166` | 检查更新失败 |
| `:174` + `:175` | 检查更新失败（catch 分支） |
| `:190` + `:191` | 打开下载页失败 |
| `:206` + `:207` | 其他 |

后果不是「稍微啰嗦」：inline 那条是 `role="alert"`（`desktop-settings-page.tsx:284`），toast 的那条落在 `role="status" aria-live="polite"` 的视口里（`desktop-toast.tsx:57`）——屏幕阅读器先被打断一次，两秒后再被打断一次，而且**两处措辞不同**（inline 用裸 `cause.message`，toast 用 `folderReadFailToast: "{reason}"` 模板）。用户在页面上同时看到两条描述同一件事的不同文案。

**P1-2 顶部两层的几何冲突（实算）**
720px 宽窗口下：
- 横幅内容：`WifiOff` 14px + gap 8 + 「连接已断开，正在重新连接…」12px×13 字 ≈ 156px + 左右 padding 28 + 边框 2 ≈ **206px**，`left:50%` 居中 → 占据 `x ∈ [257, 463]`。
- Chrome 错误：`right:14`，`max-width: min(360, 100vw-28) = 360` → 占据 `x ∈ [346, 706]`。
- **重叠区 `x ∈ [346, 463]`**，且 `z-index` 1001 > 95 → 断线横幅的文字被 chrome 错误压住。

**P1-3 inline 层自身有 9 套规格**
字号实测 4 种：12px（`:53` `:177` `:237` `:414` `:487` `:570`）、11px（`:195`）、12px+边框（`:515`）、12px+左侧 2px 竖线（`:534`）。只有 `:515` 有边框，其余是裸红字。用户在不同模块看到的「错误」长得不一样。

### 1.3 规格

**判定表（一份事件只允许命中一层主层 + 一层可选辅助层）**

| 事件 | 主层 | 辅助层 | 判定依据 | 生命周期 |
| --- | --- | --- | --- | --- |
| 用户刚做的一次可逆操作成功 | Toast `success` | — | 与操作位无强绑定，用户已转移视线 | 4s |
| 用户刚做的一次操作失败，**操作控件仍在视野内** | **Inline（就地）** | — | toast 会消失、且离操作位远，用户看不到"到底哪个字段错了" | 常驻到下次成功 |
| 后台/被动失败（轮询、订阅、同步），用户没在操作 | Toast `error` | — | 没有可附着的控件 | 6s，可关闭 |
| 持续性连接状态（断线 / 重连中 / 恢复 / 离线） | **横幅** | — | 状态而非事件，需要"看得见但不打断" | 状态存在即显示；恢复态 2000ms（`desktop-connection-banner.tsx:22` 保持） |
| 集合为空 | **空态** | — | 需要解释 + 唯一前进动作 | 常驻 |
| Shell 自身读不到窗口/历史状态 | **Toast `error`** | — | 不属于任何业务页面，行内无处可放 | 6s |
| 不可逆 / 破坏性 | 确认对话框 | — | 需要显式决定 | 阻塞 |

**题目要求的四个具体判定**

| 场景 | 落层 | 具体做法 |
| --- | --- | --- |
| **MCP 连接失败** | Inline | 在该 server 的 `<article>` 内用 `.mcp-panel__error`（globals.css:414）显示 `copy.mcp.connection.failed` + 原因；按钮文案留在 `add` 分支。**不 toast**。仅在"已连接后被后台断开"这种无操作场景下 toast 一次（key 去重） |
| **保存失败** | Inline | `.desktop-settings__error` / 表单旁 `role="alert"`。**删掉配套的 `toast.push(error)`**（即修 P1-1 的 9 处） |
| **安装被下架** | 卡片态变更（主） + Toast `error` 一次（辅） | 主：把该条目的卡片操作区换成 disabled 态 + `已下架` 文案（`.agent-marketplace__install:disabled`，globals.css:486 已有）；辅：`installFailToast` toast 一次，key 用 `install:<id>` 保证不重复 |
| **网络断开** | 横幅 | `desktop-connection-banner` 的 `offline` 分支（`desktop-connection-banner.tsx:71–78`）；**不 toast**，否则每次设备离线弹一条 |

**层归属的唯一化规则**：一个 `catch` 分支只允许调用 `setError(...)` **或** `toast.push(...)` 其中一个；`role="alert"` 在同一 DOM 时刻最多出现一次。

**横幅几何（修 P1-0，必改）**

```css
.desktop-connection-banner {
  position: fixed;
  top: var(--desktop-titlebar-height, 46px);   /* ← 关键：46px，不是 0 */
  left: 50%;
  z-index: var(--z-banner, 950);
  /* 其余保持不变 */
}
```

并新增 `--desktop-titlebar-height: 46px` 到 `html[data-helstera-desktop="true"]`（`globals.css:613–624`），把 `:610` 的 `body padding-top`、`:149` 的 `main padding-top`、`:630` 的标题栏 `height`、`:101` 的 `calc(100dvh - 46px)` 四处硬编码的 `46px` 收敛到这一个变量。

**层级阶梯（新增 token，消除 90/95/1000/1001 四档散落）**

```css
:root {
  --z-content: 1;
  --z-sticky: 10;
  --z-toast: 900;
  --z-banner: 950;
  --z-titlebar: 1000;
  --z-modal: 1100;
}
```

- `.desktop-toast-viewport`: `z-index: var(--z-toast)`（900，原 90）
- `.desktop-connection-banner`: `z-index: var(--z-banner)`（950，原 95）
- `.helstera-desktop-titlebar`: `z-index: var(--z-titlebar)`（1000，保持）
- `.helstera-desktop-switcher`: `z-index: var(--z-modal)`（1100，原用 `showModal()` 顶层，显式化）
- **L3 chrome 错误并入 L1**：`.helstera-desktop-chrome-error` 删除独立定位，改为通过 `useDesktopToast().push({tone:"error"})` 投递。若坚持保留独立层，垂直带必须下移：`top: calc(46px + 8px) = 54px`，并且横幅 `top: 46px`（不再 `top: 0`，现状 `top:0` 会被 46px 高的标题栏盖住上半部分 —— 需真机确认实际可见性）。

### 1.4 验收口径

1. **横幅可见性（P1-0）**：断开网络（或断 socket）后，`.desktop-connection-banner` 的 `getBoundingClientRect().top >= 46`，且 `document.elementFromPoint(横幅中心点)` 返回横幅自身或其子节点（不是 `.helstera-desktop-titlebar`）。当前代码下这条**必然失败**——先跑它，再修。
2. 在设置页制造一次"读取目录失败"：`document.querySelectorAll('[role="alert"]').length === 1`，且 toast 视口内 `textContent` 不包含同一事件文案。
3. 720×480 下同时触发断线横幅与一次 chrome 错误：两者的 `getBoundingClientRect()` 不相交（矩形交集面积 = 0）。
4. 9 个 inline 错误 class 收敛为 1 个 `.desktop-inline-error`（或保留 1 个 + 1 个 danger 变体），`grep -c "__error" globals.css` 由 9 降到 ≤2。
5. 每个 `catch` 分支只出现一次 `setError(` 或 `toast.push(`：`grep -A3 "catch" desktop-settings-page.tsx` 人工过一遍。

---

## 2. Toast 规格

### 2.1 现状（逐项实测）

| 项 | 现值 | 位置 |
| --- | --- | --- |
| 位置 | `fixed; right:16px; bottom:16px` | globals.css:357 |
| 宽度 | `min(420px, calc(100vw - 32px))` | globals.css:357 |
| 堆叠间距 | `gap: 8px` | globals.css:357 |
| 单条内距 | `padding: 10px 12px`，`gap: 9px` | globals.css:358 |
| 圆角 / 边框 | `8px` / `1px solid var(--border)` | globals.css:358 |
| 字号 | `13px`（无显式 line-height，继承 preflight `1.5` → 19.5px） | globals.css:358 |
| 图标 | `16×16` | globals.css:360 |
| 关闭按钮 | `22×22`，图标 `14×14` | globals.css:365、368 |
| 关闭按钮焦点环 | `2px solid var(--ring); offset 1px` | globals.css:367 |
| 默认时长 | `4000ms` | desktop-toast.tsx:25 |
| 去重窗口 | `5000ms`，key 默认 `${tone}:${message}` | desktop-toast.tsx:26、39–42 |
| 进场动画 | `160ms ease-out`，`prefers-reduced-motion: no-preference` 下启用 | globals.css:379–382 |
| 可访问性 | 视口 `role="status" aria-live="polite" aria-atomic="false"` | desktop-toast.tsx:57 |
| **最大堆叠** | **无上限**（`setToasts(curr => [...curr, toast])`） | desktop-toast.tsx:47 |
| **定时器清理** | 无（`setTimeout` 未存句柄、未 clear） | desktop-toast.tsx:49 |
| **hover/focus 暂停** | 无 | — |
| 文案长度上限 | 无（`overflow-wrap: anywhere` 可换行但不截断） | globals.css:364 |

### 2.2 问题

**P2-1 无堆叠上限 —— 480px 高窗口会被 toast 吃掉一半（实算）**
单条单行高 = `10 + 10`(padding) + `2`(边框) + `19.5`(行高) = **41.5px**。
- 3 条 = `41.5×3 + 8×2` = **140.5px**
- 5 条 = `41.5×5 + 8×4` = **239.5px**（480px 窗口的 50%）
- 8 条 = **388px**（81%）

而批量失败是现实场景：MCP 列表里 N 个 server 各自连接失败、市场里 N 个条目同步失败，`agent-marketplace-page.tsx` 单个函数内就有 12 处 `toast.push`。`desktop-toast-viewport` 没有 `max-height` 也没有 `overflow`，所以第 9 条会顶出屏幕上方，且**无法滚动**。

**P2-2 关闭按钮 22×22 低于 WCAG 2.2 AA 硬下限（24×24）**
`globals.css:365` 的 `width:22px; height:22px` 违反 SC 2.5.8 Target Size (Minimum)。这条不是口味问题，是达标问题。

**P2-3 键盘用户在 4 秒内会被"抽走"焦点前后文**
`desktop-toast.tsx:49` 的定时器不感知 hover/focus。用户 Tab 到关闭按钮的同一瞬间 toast 被移除 → 焦点掉回 `body`（WCAG 2.2.1 Timing Adjustable 的典型失败）。

**P2-4 error 去重会静默吞掉真实失败**
`desktop-toast.tsx:42` 对**所有 tone** 一律 `return`。5 秒内同一个错误发生第二次（例如用户连点两次"连接"）时，界面**完全无反馈**——用户以为按钮没响应。

**P2-5 深色模式下 toast 与页面几乎同面**
`.desktop-toast` 用 `background: var(--background)`；深色下 `--card` 与 `--background` 对比仅 **1.06:1**，`--border` 是 `oklch(1 0 0 / 0.08)`（近似 1.3:1），而 `box-shadow: 0 8px 24px rgb(0 0 0/16%)` **在深色底上等于隐形**。三层都失效 → toast 边界不可辨。（需真机确认视觉观感）

**P2-6 error toast 用 `polite` 播报**
`role="status"` 是 polite；错误信息应打断。当前与设置页 inline `role="alert"` 叠加后语义混乱（见 §1 P1-1）。

### 2.3 规格

| 项 | 规格值 | 依据 |
| --- | --- | --- |
| 位置 | `right: 16px; bottom: 16px`（保持） | 不压 Windows 窗口控制区；`bottom:16` 高于任务栏安全距离 |
| 宽度 | `width: min(360px, calc(100vw - var(--desktop-sidebar-width) - 32px))` | 现 420px 在 720 窗口占 58% 宽；改为绑定 `--desktop-sidebar-width`（折叠 74 / 展开 216），侧栏展开时 toast 不进入侧栏区 |
| 堆叠上限 | `--toast-max-visible: 3`；`@media (max-height: 600px)` → `2` | 480px 高时 2 条 = 91px（19%），3 条 = 140.5px（29%）可接受 |
| 溢出处理 | 超出时视口顶部显示 `还有 N 条`（可点开展开），而非直接丢弃 | 丢弃会丢信息，滚动在 fixed 层不易发现 |
| 视口兜底 | `max-height: min(50dvh, 320px); overflow-y: auto; overscroll-behavior: contain` | 防 8 条爆屏 |
| 时长 | `success`/`info` **4000ms**；`error` **6000ms**；`durationMs: 0` = 常驻 | error 需要更多阅读时间；6000ms 仍 ≤ 单条 2 行阅读阈值（约 4–5s） |
| 暂停 | `pointerenter` / `focusin` 暂停计时；`pointerleave` / `focusout` 后重置为 `min(剩余, 2000)` | 满足 2.2.1，且不会让"划过去看一眼"变成永久停留 |
| 去重 | 窗口 **5000ms**（保持）；**同 key 二次出现不丢弃，改为计数升级**：`message` 追加 ` ×2`、`×3` 并重置计时器 | error 不能再吞（P2-4） |
| 文案上限 | 中文 **40 全角字** / 英文 **90 字符**，超出用 `-webkit-line-clamp: 3` 截断，完整文本进 `title` + `aria-label` | 360 宽减去 24(padding)+16(icon)+9+24(dismiss)+9 = **278px** 可用 → 13px 中文约 21 字/行，3 行 ≈ 63 字，取 40 字为安全上限 |
| 关闭按钮 | **24×24**，图标 **16×16**，`border-radius: 4px`，焦点环 `2px solid var(--ring); offset: 1px`（保持 `:367` 模式） | SC 2.5.8 |
| 单条几何 | `padding: 10px 12px`、`gap: 9px`、`radius: 8px`（保持） | 与 `.mcp-panel__server`（radius 5）区分层级；8px 属于本产品的浮层圆角档 |
| 图标色 | `success → var(--success)`（浅 12.13:1 / 深 7.29:1）、`error → var(--destructive)`（浅 8.81:1 / 深 6.87:1）、`info → var(--info)`（浅 **3.07:1** / 深 7.53:1） | 三者中 `--info` 浅色仅 3.07:1，刚好过 3:1 图标线，**建议 info 改用 `--muted-foreground`（浅 8.82:1）**，因为 info 是"中性提示"不需要语义色 |
| 表面（深色） | `background: var(--popover)`；`border-color: var(--input-border)`（深：`oklch(1 0 0/0.14)`）；阴影 token 化：浅 `0 8px 24px rgb(0 0 0/16%)`、深 `0 10px 30px rgb(0 0 0/45%)` | 修 P2-5；`--popover`（深 0.20）比 `--background`（0.14）高两档 |
| 语义播报 | 视口保持 `aria-live="polite"` 作为兜底；**单条 error 加 `role="alert"`**，`success`/`info` 保持 `role="status"` | error 必须打断，且与 §1 的"一次 alert"规则兼容 |

### 2.4 我认为最该改的 3 处（本节的"2–3 处"）

| # | 位置 | 改什么 | 为什么（像素级/语义级依据） |
| --- | --- | --- | --- |
| ① | `desktop-toast.tsx:47` | 加 `MAX_VISIBLE`（3 / 2）与溢出折叠 | 单条 41.5px 实算，8 条 388px > 480 窗口 81%，且视口无 `max-height`/`overflow` → 直接顶出屏幕 |
| ② | `globals.css:365` | `22×22` → `24×24`，图标 14 → 16 | WCAG 2.2 SC 2.5.8 硬下限 24×24，当前不达标 |
| ③ | `desktop-toast.tsx:42` + `:49` | error 改计数升级不丢弃；定时器加 hover/focus 暂停 + 卸载清理 | 5s 内重试的真实失败被静默吞掉；键盘焦点在 4s 内被抽走（2.2.1） |

### 2.5 验收口径

1. 连续 push 8 条不同 key 的 toast：可见条数 = 3（或 2 @<600px 高），视口高度 ≤ `50dvh`，出现「还有 N 条」。
2. `prettyPrint` 或 DevTools 量 `.desktop-toast__dismiss` 的 `getBoundingClientRect()` = 24×24。
3. 同一 key 连续 push 两次（间隔 <5s）：DOM 内只有 1 条，文案含 `×2`，且计时器被重置（4s/6s 后消失）。
4. 鼠标移入 toast 后停留 10s：toast 仍在；移出后 ≤2s 消失。
5. Toast 内 Tab 到关闭按钮并保持焦点 10s：toast 不消失。
6. axe-core `color-contrast` 在 `.desktop-toast` 上 0 violation（浅/深两套主题）。

---

## 3. 空态规格

### 3.1 现状（实测）

**样式**（`.desktop-empty-state`，globals.css:373–378）

| 项 | 现值 |
| --- | --- |
| 容器 | `display:grid; justify-items:center; gap:8px; padding:40px 20px; text-align:center` |
| 图标盒 | `40×40`，`border:1px solid var(--border)`，`radius:10px` |
| 图标 svg | `18×18` |
| 标题 | `14px / 600 / var(--foreground)`（`<strong>`，**无 line-height、无 max-width**） |
| 描述 | `12px / 1.6 / var(--muted-foreground)`，`max-width:42ch` |
| 行动区 | `.desktop-empty-state__action { margin-top:4px }`（与 gap 8 叠加 = 视觉 12px） |
| 语义 | `role="status"`（desktop-empty-state.tsx:26） |

**8 个调用点**

| # | 文件:行 | 图标 | 标题（zh-CN） | 标点 |
| --- | --- | --- | --- | --- |
| 1 | `desktop-mcp-panel.tsx:824` | Wrench | 服务器未提供可调用工具。 | **有句号** |
| 2 | `desktop-mcp-panel.tsx:830` | SearchX | 没有符合筛选条件的工具。 | **有句号** |
| 3 | `desktop-mcp-panel.tsx:903` | Boxes | 还没有添加 MCP 服务。 | **有句号** |
| 4 | `agent-marketplace-page.tsx:250` | SearchX | 没有找到匹配的扩展 | 无 |
| 5 | `agent-marketplace-page.tsx:258` | PackageOpen | 还没有安装任何扩展 | 无 |
| 6 | `agent-marketplace-page.tsx:266` | PackageOpen | 登录后即可浏览扩展市场 | 无 |
| 7 | `agent-marketplace-page.tsx:272` | PackageOpen | 市场暂时没有可用扩展 | 无 |
| 8 | `desktop-download-list.tsx:131` | Download | 暂无下载记录 | 无 |

文案源：`desktop-copy.ts:122/124/127`（MCP，带句号）vs `:189/192/195/197`（市场）、`:444`（下载），**同一语义槽位标点不统一**。

**行动按钮三套实现**

| 调用点 | 实现 | 结果 |
| --- | --- | --- |
| `agent-marketplace-page.tsx:254`、`:262` | `EMPTY_STATE_ACTION_CLASS`（`:232-233`）：`rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:ring-2` | 有边框、内距 12/6、有焦点环 |
| `desktop-mcp-panel.tsx:832-843`、`:907-911` | `<button type="button" onClick=…>` **完全无 className** | Tailwind preflight 归零 `border` → 无边框、**无 padding** → 热区 ≈ 文本行高（13px×1.5 ≈ **19.5px**），低于 24×24；无焦点环（见 §5 全局 outline 失效） |
| `desktop-download-list.tsx:136-141` | 手写 Tailwind 串 | 与 marketplace 基本一致但重复定义 |

### 3.2 问题

- **P3-1** 8 个空态里 2 个的行动按钮没有样式类，实际渲染成一个"看起来不像按钮的裸文字"，且热区 19.5px 高（WCAG 2.2 SC 2.5.8 不达标）。
- **P3-2** 标题用 `<strong>`，不是 heading。用屏幕阅读器按标题跳转找"没有符合筛选条件的工具"会**找不到**——这正是空态存在的最重要场景（用户不知道是空还是坏）。
- **P3-3** `role="status"` 用在静态空态上：首次渲染即播报，且与 toast 的 live region 抢频道。
- **P3-4** 标题无 `max-width`：`noServersBody` 这类长描述被 42ch 保护，但标题不受限（英文 `No extensions available right now` 在窄窗会拉宽容器）。
- **P3-5** 语气不齐（同一产品、同一种"空"）：
  - 陈述式：`服务器未提供可调用工具。`（像报错）
  - 口语式：`连接已建立，但这个服务没有暴露任何工具，Agent 无法从这里调用东西。`（"东西"与同组 `它的工具` 口径不一）
  - 鼓励式：`还没有安装任何扩展` + `先去「发现」挑一个`（用 `「」`）
  - 行动指令式：`登录后即可浏览扩展市场`
  - 全库引号不统一：`desktop-copy.ts:193` 用 `「发现」`，`:47` 用 `“{name}”`。
- **P3-6** 图标比例不一致：空态 `18/40 = 45%`，市场卡 `20/42 = 48%`，市场页头 `21/44 = 48%`，登录卡 `21/46 = 46%`。

### 3.3 规格

| 项 | 规格值（含 token） | 依据 |
| --- | --- | --- |
| 图标盒 | **44×44**，`border:1px solid var(--border)`，`border-radius:10px`，`color: var(--muted-foreground)` | 与 `.agent-marketplace__heading-mark`（44×44，`globals.css:440`）对齐，同产品同量级"空"标记 |
| 图标 svg | **20×20**（20/44 = 45%） | 与市场卡 20/42、页头 21/44 收敛到 45–48% 区间 |
| 标题 | **14px / line-height 20px / font-weight 600 / `var(--foreground)` / `max-width: 42ch`**；语义 **`<h3>`**（组件签名加可选 `level`，默认 3） | 20px 显式行高替代继承的 21px；heading 语义修 P3-2 |
| 描述 | **12px / line-height 19.2px（1.6）/ `var(--muted-foreground)` / `max-width: 42ch`**（保持） | 42ch ≈ 336px @ 12px 中文，落在 320–360 的可读区间 |
| 间距节奏 | `gap: 8px`（保持）；图标→标题 8 / 标题→描述 8 / 描述→行动 **14px**（`.desktop-empty-state__action { margin-top: 6px }`，现 4px） | 行动区需要与说明文字拉开一档，13→14 是唯一"按钮该更远"的节奏 |
| 容器 | `padding: 40px 20px`（保持）；新增 `max-width: 560px; margin-inline: auto` | 防止在 1440 宽内容区被拉到 1440 |
| 行动按钮（唯一形态） | `display:inline-flex; min-height:32px; padding:0 12px; border:1px solid var(--border); border-radius:5px; font-size:12px;` `:hover{border-color:var(--foreground)}` `:focus-visible{outline:2px solid var(--ring); outline-offset:2px}` | 直接复用 `.agent-marketplace__install`（`:481`）的规格；热区 32 × ≥72 = 远超 24×24 |
| 主次 | 每个空态**最多 1 个按钮**，且必须是"前进动作"（`添加第一个服务`／`去浏览市场`／`清除搜索与筛选`／`重新读取版本`）；次要动作只能以描述里的行内链接出现（`var(--foreground)` + `text-decoration: underline; text-underline-offset: 2px`） | 现状 8 个空态里按钮数 0 或 1，已经符合；把它写成硬约束防止以后加第二个 |
| 语义 | 静态空态去掉 `role="status"`；仅当空态**由加载态切换而来**时保留（加 `aria-live="polite"`）；标题改 `h3` | 修 P3-3 |

**统一文案模板**

| 类型 | 标题模板（**不带标点**） | 描述模板（**带一个句号结尾**） | 行动按钮（动宾结构） |
| --- | --- | --- | --- |
| 从未创建 | `还没有{对象}` | `{对象}会出现在这里。{怎么开始一句话}。` | `添加第一个{对象}` / `去{位置}挑一个` |
| 筛选无结果 | `没有匹配的{对象}` | `当前{条件}下没有匹配项，清除后可以看到全部。` | `清除搜索与筛选` |
| 未登录 | `登录后即可{结果}` | `登录 {产品名} 账号后，这里会列出{对象}。` | `去登录` |
| 服务侧为空 | `暂时没有可用的{对象}` | `稍后刷新一次；如果一直为空，可能是{原因}。` | `重新读取` |

按模板重写 8 条（示例）：

| # | 新标题 | 新描述（保留原意） | 按钮 |
| --- | --- | --- | --- |
| 1 | 这个服务没有提供工具 | 连接已建立，但服务没有暴露任何工具，Agent 无法调用。 | —（无） |
| 2 | 没有匹配的工具 | 当前搜索词或工具筛选下没有匹配项，清除后可以看到全部已发现工具。 | 清除搜索与筛选 |
| 3 | 还没有添加 MCP 服务 | 添加一个本机 stdio 进程或远程 HTTP 端点，Agent 才能调用它的工具。 | 添加第一个服务 |
| 4 | 没有匹配的扩展 | 当前搜索和类型筛选下没有匹配项，清空筛选后可以看到市场里的全部扩展。 | 清空筛选 |
| 5 | 还没有安装任何扩展 | 已经装好的技能、连接工具和插件会出现在这里。先去「发现」挑一个。 | 去浏览市场 |
| 6 | 登录后即可浏览扩展市场 | 登录 Helstera 账号后，这里会列出可以安装的技能、连接工具和插件。 | 去登录 |
| 7 | 暂时没有可用的扩展 | 目录里还没有上架任何条目。稍后刷新一次；如果一直为空，可能是市场服务尚未启用。 | 重新读取 |
| 8 | 暂无下载记录 | 发布清单里还没有可下载的安装包。重新读取版本，或稍后再来看一次。 | 重新读取版本 |

> 注意 #4/#5 的 `clearFilters` 在不同模块被写成 `清除搜索与筛选`（`desktop-copy.ts:126`）与 `清空筛选`（`:191`）——**同一类动作两个动词**。规格：全库统一为 `清除筛选`（简洁，且"清除"比"清空"更适合"筛选条件"这一对象）。

### 3.4 验收口径

1. 8 个空态渲染出同一 DOM 结构：`<div.desktop-empty-state><span.icon(44×44)><h3><p><div.action?<button>`；`document.querySelectorAll('.desktop-empty-state h3').length === 8`。
2. 所有空态按钮 `getBoundingClientRect().height >= 24` 且 `>= 32`（目标值），且 `borderStyle !== 'none'`。
3. `desktop-copy.ts` 中所有 `*Title:` 值不含 `。` 与 `.`（`grep -E "(Title):.*[。.]\"" desktop-copy.ts` 返回空）。
4. `grep -c "DesktopEmptyState"` 的每个调用点，其 `action` 内按钮数量 ≤ 1。
5. axe-core：空态区域无 `heading-order` / `button-name` violation。

---

## 4. 窄窗 720×480

### 4.1 现状（关键变量与断点）

| 项 | 值 | 位置 |
| --- | --- | --- |
| 侧栏两态 | `--desktop-sidebar-collapsed-width: 74px`、`--desktop-sidebar-expanded-width: 216px` | globals.css:621–622 |
| 折叠态 padding | `10px 7px` → 项可用宽 **60px** | globals.css:135 |
| 折叠态项 | `min-height:48px`、`padding:5px 2px` → 热区 **60×48** | globals.css:139 |
| 折叠态文字 | `__label` **7px**、项 `span` **8px**、`max-width:64px` | globals.css:138、142 |
| 展开态项 | `min-height:36px` → 热区 **196×36** | globals.css:146 |
| 内容区 | `.desktop-feature { height: calc(100dvh - 46px); overflow-y:auto; padding: 24px clamp(18px,3vw,44px) 32px }`；≤900 → `18px 14px 24px` | globals.css:101、245 |
| 市场栅格 | 3 列（`repeat(3,minmax(0,1fr))`，gap 12）；≤760 → 2 列；≤520 → 1 列 | globals.css:455、576、592 |
| 市场卡 | `padding:14px`、`border:1px`、图标 42、标题 14px/nowrap+ellipsis | globals.css:456、457、465 |
| 卡行动区 | `display:flex; justify-content:space-between`，**无 `flex-wrap`**；install 按钮 `flex:0 0 auto` | globals.css:477、481 |
| 本地工作台 | `grid-template-columns: minmax(180px,230px) minmax(0,1fr)`；≤820 → `minmax(135px, 32vw) minmax(0,1fr)` | globals.css:304、603 |
| 工作台纵向 | 默认 4 行；≤820 → `42px minmax(210px,1fr) minmax(170px,30vh) 24px` | globals.css:326、600 |
| MCP 表单 | 2 列；≤820 → 1 列 | globals.css:416、606 |

### 4.2 问题（全部为实算，非目测）

**P4-1 480px 高时本地工作台纵向必然溢出 54px**
- 可用高 = `480 − 46`(标题栏) = **434px**
- `.desktop-feature` 纵向 padding（≤900）= `18 + 24` = 42 → 内容盒 **392px**
- `.local-workbench` 最小行高合计 = `42 + 210 + 170 + 24` = **446px**
- **溢出 `446 − 392 = 54px`** → 底栏（含状态条/输出区）被裁或触发外层滚动

**P4-2 `32vw` 跟着视口走，不跟容器走**
侧栏展开（216）时 720 窗口的内容区 = `720 − 216 = 504`，`.desktop-feature` 内距 28 → **476px**；但 `.local-workbench__body` 第一列取 `minmax(135px, 32vw)` = `32 × 720 / 100 = 230px` → 编辑器只剩 **246px**（11px 等宽约 38 列），代码不可读。同一份 CSS 在侧栏收起时给编辑器 388px（约 60 列，正常）——**同一个窗口尺寸，两种侧栏状态两个可用性结局**，这不是内容问题，是 `vw` 选错参照系。

**P4-3 侧栏展开 + 2 列市场卡时行动行溢出**
- 内容 504 − feature 内距 28 − 市场内距 56 = **420px** → 2 列 → 每卡 `(420−12)/2 = 204px`
- 卡内可用 = `204 − 28`(padding) `− 2`(边框) = **174px**
- 卡行动区需要：`install` 按钮（11px×2 字 + padding 20 + border 2 ≈ **44px**）+ `gap 10` + 1 个链接（icon 13 + gap 5 + 4 字 44 ≈ **62px**）= **116px** ✓；但 `card-actions > div` 里链接是 **2 个**（`:478` gap 13）→ `62 + 13 + 62 = 137` + `116 = 253px` **> 174px**，且 `.agent-marketplace__card-actions` 无 `flex-wrap` → 横向被裁。

**P4-4 顶部两层抢位（根因见 §1 P1-0）**：横幅因 `top: 0` + `z-index: 95` 被 46px 高的不透明标题栏**完全遮挡**（横幅 33px），所以它不是"和 chrome 错误重叠"，而是根本看不见。修完 `top: 46px` 之后才会退化成真正的重叠问题：720 宽下横幅 `x ∈ [257, 463]`、chrome 错误 `x ∈ [346, 706]`，重叠 `x ∈ [346, 463]`，z-index 1001 > 950 仍会压住横幅。**两个问题要一起修**。

**P4-5 折叠态 7px / 8px 文字**
`__label` 7px、项 `span` 8px。这两档字号在任何桌面平台都不是"小字"，是"装饰性"。且折叠态还有 `title` 属性（`desktop-workspace-sidebar.tsx:105` 等）提供同名提示 → 文字与提示重复，纯属噪声。

**P4-6 全局隐藏滚动条**
`* { scrollbar-width: none }`（globals.css:1911–1917）——`.desktop-feature` 是 `overflow-y:auto`，480 高时一定有溢出（P4-1），但用户**看不到任何"还能往下滚"的线索**。

### 4.3 规格

**侧栏**

| 项 | 规格值 | 依据 |
| --- | --- | --- |
| 折叠态宽度 | **74px**（保持） | 74 − 14(padding) = 60 内宽，容 17px 图标 + 5px 上下余量 |
| 折叠态文字 | **隐藏**（`span { display:none }`、`__label` 不渲染），保留 `title` + `aria-label` | 7/8px 不可读；74px 内 11px 中文只能放 4 字，不如不给 |
| 折叠态热区 | **60×48**（保持，≥44×44） | 现状已达标，写进规格防止回退 |
| 展开态项高 | `min-height: 36px` → **40px**（`line-height:20px` + 上下 10） | 36 < 44；40 是"列表密度 vs 触控"的折中，同时保证 ≥24×24 硬线 |
| 展开态宽度 | **216px**（保持）——60(折叠) + 156 文字区，12px 中文可放 13 字 | `desktop-workspace-sidebar.tsx:12` 最长标签「本地开发」4 字，216 富余 |
| 最小窗口 | **640×480**；窗口 `< 640` 时强制折叠（折叠按钮 `disabled`） | 640 − 74 − 28(feature padding) = **538px** 内容区，≥ 320 最小可读宽 1.68 倍余量 |

**内容区最小可读宽度**

| 组件 | 最小宽度 | 算式 |
| --- | --- | --- |
| 全局内容区 | **320px** | 11px 等宽约 50 列 + 最小内距 |
| 代码编辑器（`.local-workbench__editor`） | **360px** | 11px 等宽 ≈ 55 列，可读代码下限 |
| MCP 表单字段（1 列，≤820 后） | **240px** | `padding 8+10` + 12px 等宽 18 字符的凭据/URL |
| 市场卡片 | **232px** | 卡内行动行 174 + padding 28 + 边框 2 = 204 为硬下限，232 留 14% 余量 |

**市场卡片栅格三档（都按"折叠侧栏 74" + `--desktop-sidebar-width` 参与计算）**

| 窗口宽 | 侧栏 | 可用内容 | 建议列数 | 每卡宽 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **720** | 74（折叠） | 618 | **2** | 275 | ✓ 与现 ≤760 → 2 列一致，保持 |
| **720** | 216（展开） | 476 | **2** | 204 | ✗ 卡内溢出（P4-3）→ 需要 §4.3 的修复 |
| **900** | 74 | 798 | **3** | 250 | ✓ ≥232 硬下限 |
| **900** | 216 | 656 | **2** | 322 | ✓ |
| **1200** | 74 | 1070（受 `.agent-marketplace max-width:1180` 限制后 1124） | **3** | 366 | ✓ |
| **1200** | 216 | 928 | **3** | 301 | ✓ |

**规格结论（可落地）**：把栅格从"窗口断点"改为"可用宽度驱动"，可以一次性消掉 P4-3 与上表所有 ✗：

```css
.agent-marketplace__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 12px;
}
/* 删除 globals.css:576 与 :592 两处 .agent-marketplace__list 的列数覆盖 */
```

配套两条：
```css
.agent-marketplace__card-actions { flex-wrap: wrap; row-gap: 8px; }
.agent-marketplace__card-actions > div { flex-wrap: wrap; row-gap: 8px; }
```

**最先塌的组件（按优先级，全部为实算）**

| 排序 | 组件 | 触发条件 | 塌法 | 修法 |
| --- | --- | --- | --- | --- |
| 1 | `.local-workbench`（纵向） | 720×480，任意侧栏态 | 内容盒 392px < 需要 446px，**差 54px** | 加 `@media (max-height: 560px) { .local-workbench { grid-template-rows: 42px minmax(150px,1fr) minmax(110px,26vh) 24px } }` → 合计 326 ≤ 392 |
| 2 | `.local-workbench__body`（横向） | 侧栏展开 + 720 宽 | 编辑器 246px < 360 下限 | `minmax(135px, 28%)` 替换 `32vw`（28% × 476 = 133 → 编辑器 343）或用 container query `minmax(135px, 28cqw)` |
| 3 | `.agent-marketplace__card-actions` | 侧栏展开 + ≤760 宽 | 需 253px > 可用 174px，无 wrap → 横向裁切 | 见上方 `flex-wrap` + `auto-fill` 栅格 |
| 4 | `.desktop-connection-banner` | **always** | `top:0` + 高 33px 被 46px 不透明标题栏完全覆盖（z 95 < 1000）→ 状态永远不可见 | `top: var(--desktop-titlebar-height)`（§1）；修完后再处理与 chrome 错误的横向重叠 `x∈[346,463]` |
| 5 | 滚动线索 | 任何溢出场景 | 全局 `scrollbar-width:none` → 无滚动指示 | 仅对真实滚动容器给细滚动条（见 §6 D） |
| 6 | 侧栏折叠态文字 | 折叠态 | 7/8px | 隐藏 |

### 4.4 验收口径

1. 720×480 下逐模块截图确认无横向滚动条（`document.documentElement.scrollWidth === clientWidth`）。
2. `.local-workbench` 在 720×480 时 `scrollHeight <= clientHeight`（或明确允许外层滚动，且底部状态条可见）。
3. 720 宽 + 侧栏展开时，`.local-workbench__editor` 的 `clientWidth >= 360`（或按 28% 方案 ≥343，取其一为准并写入验收）。
4. 720 宽 + 侧栏展开时，每张市场卡 `scrollWidth === clientWidth`（无内容溢出）。
5. 断线横幅与 chrome 错误同时在 DOM 时，`getBoundingClientRect()` 交集为 0。
6. 三档宽度（720/900/1200）× 两种侧栏态 = 6 个组合，市场列数落在 §4.3 表格值。

---

## 5. 键盘与焦点

### 5.1 现状

**全局焦点环实际上被清空了**

`globals.css:1904–1909`（文件末尾，**未包裹在任何 `@layer` 里**）：

```css
:focus { outline: none; }
:focus-visible {
  outline: 2px solid oklch(var(--foreground) / 0.4);
  outline-offset: 2px;
  border-radius: 4px;
}
```

两个问题叠加：

1. `--foreground` 的定义是**完整颜色函数** `oklch(0.18 0.015 260)`（`globals.css:1131`）。`oklch(var(--foreground) / 0.4)` 展开后是 `oklch(oklch(0.18 0.015 260) / 0.4)`——`oklch()` 第一个参数不接受颜色函数，这是**非法值**，在计算值阶段失效（invalid at computed-value time → 当作 `unset`，`outline-style` 回落到初始值 `none`）。
2. 该规则是**无层（unlayered）**样式，级联上优先于 `@layer base` 里的 `:where(button, a, input, select, textarea, [role="button"], [tabindex]):focus-visible { outline: 2px solid var(--ring) }`（`globals.css:1272–1276`）。所以 base 层那条本来能用的焦点环被这条非法声明**覆盖掉**。

净效果：**除下面这张表里显式声明过的元素外，全站键盘焦点不可见**。

| 有显式 `:focus-visible` 环（可用） | 位置 |
| --- | --- |
| `.desktop-canvas-empty-hint__action` | :125 |
| `.mcp-panel button / summary / a` | :343 |
| `.mcp-panel__tool-filter input / select` | :353–354 |
| `.desktop-toast__dismiss` | :367 |
| `.agent-marketplace__filters button / card button / card a` | :451 |
| 标题栏 `__controls button` / `__history button` / `__sidebar-toggle` / `__quick-open` | :872–878 |
| `select:not([data-unstyled-select])` | :1305 |

| **没有**可用焦点环（靠全局那条，而它是坏的） |
| --- |
| **`.desktop-workspace-sidebar__item`**（`grep` 全文件**零命中**） |
| **`.desktop-workspace-sidebar__settings`**（同上） |
| **空态行动按钮**（`desktop-mcp-panel.tsx:832`、`:907` 无 class，见 §3） |
| `.local-workbench__tree-item`、`__actions button`、`__bottom-tabs button`、`__pane-title button` |
| `.desktop-canvas-recovery button` |
| `.mcp-panel__market article button`（`:408` 定义了 `min-height:34` 但无焦点环；**注意**：该按钮被 `.mcp-panel button:focus-visible`（:343）覆盖，实际有环——归到有环一列，此处纠正） |

**副作用：焦点改变圆角**
`border-radius: 4px` 是合法声明。任何元素获得键盘焦点时，自身圆角被改成 4px：`.desktop-toast`(8→4)、标题栏按钮(6→4)、`.desktop-login-panel`(14→4)、`.agent-marketplace__card`(7→4)。**键盘用户看到的是"聚焦时组件变形"**。

**roving tabindex（侧栏）— 实现是对的**

- `activeIndex` + `rovingIndex`，`Math.min(activeIndex, itemCount-1)` 处理折叠越界（`desktop-workspace-sidebar.tsx:23–27`）✓
- `collectItems()` 每次按键重算，过滤 `disabled`/`hidden`/`aria-hidden`（`:47–53`）✓
- `ArrowDown/ArrowUp/Home/End` 接管 + `preventDefault`（`:55–87`）✓
- `focus` 事件同步索引（`:89–92`）✓
- `scrollIntoView({ block: "nearest" })`（`:86`）✓
- **缺**：焦点环（全局坏掉）；折叠态文字不可读（见 §4）

**quick-open（`Ctrl/⌘+K`）**

| 步骤 | 现状 | 判定 |
| --- | --- | --- |
| 打开 | `<dialog>` + `showModal()`（`desktop-titlebar.tsx:261`），退化路径 `setAttribute("open")`（`:262`） | ✓ 原生焦点包含 |
| 初始焦点 | `searchRef.current?.focus()`（`:263`） | ✓ |
| 关闭 | 清理函数里 `dialog.close()` + `returnTarget.focus()`（`:268–275`），覆盖 Escape/点选/编程关闭三条路径 | ✓ 设计正确 |
| 触发源记忆 | `quickOpenReturnFocusRef` + `quickOpenTriggerRef`（`:187–189`、`:266–267`） | ✓ |
| 结果列表键盘导航 | **完全没有**：全文件 `grep` 无 `ArrowDown`/`ArrowUp`/`aria-activedescendant` | ✗ Ctrl+K 只能 Tab 或鼠标 |
| 结果项语义 | `<ul aria-label="匹配的工作区">` + 普通 `<button>`（`:556–573`） | 可接受但非 listbox 模式 |
| 结果项焦点环 | `:focus-visible { outline: none; background: var(--desktop-chrome-hover) }`（`globals.css:983–987`） | ✗ 焦点指示 = `color-mix(fg 6%)` on bg = **1.06:1**（实算），远低于 1.4.11 要求 3:1 |
| 图标 | 结果项 `svg 17px`（`:989–992`） | 与标题栏 nav 15px 不同档（非缺陷，记录） |

### 5.2 问题

- **P5-1（最高优先级）** 全局焦点环被一条非法 `oklch()` 声明 + 无层覆盖清空 → 侧栏导航（桌面端主要导航）与空态按钮键盘不可见。
- **P5-2** 焦点导致 `border-radius` 变 4px，组件在聚焦时视觉变形。
- **P5-3** quick-open 结果列表无方向键；这是 `Ctrl+K` 类面板的**默认预期**（用户按完 Ctrl+K 就伸手去按 ↓）。
- **P5-4** switcher 结果项主动 `outline: none`，替代指示 1.06:1。
- **P5-5** 展开态侧栏项 36px 高，低于 44px 触控建议（24px 硬线仍满足）。

### 5.3 规格

**全局焦点环（必改，一处修全站）**

```css
/* 删除 globals.css:1904 的 :focus { outline: none; } —— 连带删除 1905-1909 的非法声明 */
:where(button, a, input, select, textarea, summary, [role="button"], [tabindex]):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  /* 不要写 border-radius —— 焦点态不得修改元素自身几何 */
}
```

| 参数 | 规格值 | 实测依据 |
| --- | --- | --- |
| 宽度 | **2px** | 2px 是 1.4.11 在 3:1 对比下的最低可见档；1px 在高 DPI 下抖动 |
| 颜色 | `var(--ring)` | 浅色 `oklch(0.30 0.08 270)` / 背景 = **13.24:1** ✓；深色 `oklch(0.78 0.10 130)` / 背景 = **10.24:1** ✓（要求 ≥3:1） |
| 偏移 | `outline-offset: 2px`（贴边容器 1px：`.desktop-toast__dismiss`、标题栏按钮） | 2px 让环不盖住元素自身的 1px 边框；贴边项 1px 防裁切 |
| 形状 | **不设 `border-radius`** | 修 P5-2 |
| 禁用 | 仅允许在**同时**提供 ≥3:1 替代指示时 `outline: none` | switcher 现状不满足 → 必须改 |

**switcher 结果项**

```css
.helstera-desktop-switcher__results button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;            /* 列表项贴边，内缩避免被 ul 的 overflow-y:auto 裁掉 */
  background: var(--desktop-chrome-hover);
}
```

**roving tabindex（沿用现有实现，补规格与验收）**

| 项 | 规格 |
| --- | --- |
| 模式 | 单焦点漫游：容器内**恰有 1 个** `tabindex="0"`，其余 `-1`（现状 ✓） |
| 键位 | `↓`/`↑` 逐项、`Home`/`End` 首尾（现状 ✓）；`Enter`/`Space` 触发原生 button（现状 ✓ 未接管） |
| 折叠越界 | `activeIndex` 收敛到最后一个可见项（现状 ✓ `:27`） |
| 焦点环 | 用 §5.3 全局规格（**修完后自动生效**，无需给侧栏单独写规则） |
| 滚动 | `scrollIntoView({ block: "nearest" })`（现状 ✓） |
| 折叠态热区 | **60×48**（≥44×44 ✓） |
| 展开态热区 | **196×40**（36 → 40） |
| 折叠态文字 | 隐藏（§4） |

**quick-open 焦点顺序（规格 + 验收口径）**

| # | 步骤 | 规格 |
| --- | --- | --- |
| 1 | `Ctrl/⌘+K` 打开 | 焦点进入 search input；`dialog.open === true` |
| 2 | `↓` / `↑` | 在结果间移动；**新增**，用 `aria-activedescendant` + `role="listbox"/"option"`，或 roving tabindex（与侧栏同模式，二选一，建议 roving 以复用现有实现） |
| 3 | `Home` / `End` | 结果首尾 |
| 4 | `Enter` | 激活当前高亮项并关闭 |
| 5 | `Tab` | 在 dialog 内循环，不逃逸（`showModal()` 已保证） |
| 6 | `Escape` | 关闭，焦点回到**触发按钮**（`quickOpenTriggerRef`）；若触发元素已卸载，回退到 `body` 并**不得**保留在 dialog 内 |
| 7 | 关闭后断言 | `dialog.open === false` 且 `document.activeElement` 不在 dialog 子树内 |

### 5.4 验收口径

1. **自动化**：对所有可聚焦元素依次 `focus()`，断言 `getComputedStyle(el).outlineStyle !== "none"` 且 `outlineColor` 与相邻背景对比 ≥3:1（浅/深两主题）。
2. **肉眼/截图**：Tab 到侧栏任意项，焦点环可见；聚焦前后 `getComputedStyle(el).borderRadius` 相同（防 P5-2 回归）。
3. **axe-core**：`no-focusable-content`、`color-contrast`、`focus-order-semantics` 0 violation。
4. `Ctrl+K` 后连按 `↓↓↓`：`document.activeElement` 依次变化 3 次；`Enter` 后导航发生且焦点回到触发按钮。
5. 侧栏连续 `Tab`：焦点只在侧栏内移动 1 次（其余为 `-1`），再 `Tab` 离开侧栏。
6. 折叠/展开切换后 `Tab` 一次：焦点仍在侧栏内（不落到 `body`）。

---

## 6. 一致性

### 6.1 硬编码颜色（22 处，绕过语义 token）

`grep -n "#[0-9a-fA-F]\{6\}" globals.css` 实测 22 处。与反馈层/桌面端相关的关键项及其**实算对比度**：

| 行 | 值 | 用途 | 对比度实测 | 判定 |
| --- | --- | --- | --- | --- |
| :1012、:1023 | `#b42318` | `.helstera-desktop-chrome-error` 边框/文字 | 浅 **6.30:1** ✓ / 深 **3.03:1** ✗ | 深色不达 4.5:1 |
| :425 | `#21845b` | MCP `is-connected` | 浅 **4.45:1** / 深 **4.28:1** | 两套主题都不达 4.5:1 |
| :432 | `#a75b2b` | `.mcp-panel__tool small` | 浅 4.82:1 ✓ / 深 **3.96:1** ✗ | 深色不达 |
| :490 | `#21845b` | `.agent-marketplace__notice` | 同上 | 同上 |
| :440、:461、:462、:463、:468 | `#347660` `#3e795b` `#3e6d86` `#946d3d` | 市场页头/图标/已安装标 | `#347660` 深色 **3.70:1** | 图标需 3:1，勉强；文字（10px）不达 |
| :684 | `#16803c` | 登录成功 | 未单算（与 `--success` 同档） | 建议直接换 token |
| :863、:868 | `#c42b35` | Windows 关闭按钮 | — | 平台色，可保留，但建议命名 `--window-close` |
| :73、:181、:182、:284、:285、:300 | `#2b9a58` `#20a56b` `#d39531` `#0f9f6e` `#c2413b` `#d59b36` | 各种状态点 | — | 同一语义（成功/警告/失败）6 个不同色值 |

**替换映射表（可直接执行）**

| 现值 | 换成 | 换后对比度 |
| --- | --- | --- |
| `#21845b` | `var(--success)` | 浅 **12.13:1** / 深 **7.29:1** |
| `#b42318` | `var(--destructive)` | 浅 **8.81:1** / 深 **6.87:1** |
| `#a75b2b` | `var(--warning)`（或新增 `--warning-text`） | `--warning` 是亮黄底料，作文字需 `--warning-foreground`：浅 8.60:1 / 深 9.88:1 |
| `#16803c` | `var(--success)` | 同上 |
| `#2b9a58`/`#20a56b`/`#0f9f6e` | `var(--success)` | 同上 |
| `#d39531`/`#d59b36` | `var(--warning)` | — |
| `#c2413b` | `var(--destructive)` | 同上 |
| `#347660`/`#3e795b` | `var(--success)` | 同上 |
| `#3e6d86` | `var(--info)` | 浅 **3.07:1** / 深 7.53:1（图标 3:1 刚好，文字需更深一档 → 建议新增 `--info-text`） |
| `#946d3d` | `var(--warning-foreground)` | 同上 |

### 6.2 `--destructive-foreground` 未定义（5 处引用，0 处定义）

- 引用：`globals.css:372`（`var(--destructive-foreground, #fff)`）、`canvas-editor.tsx:1106`、`delete-project-dialog.tsx:48`、`session-selector.tsx:197`、`ui/badge.tsx:15`（后 4 处是 Tailwind 类 `text-destructive-foreground`）。
- 定义：`grep -n "destructive-foreground" globals.css` 只有上面那 1 行**使用**；`@theme inline` 只映射了 `--color-destructive`（`:1089`），**没有** `--color-destructive-foreground`。
- 后果：深色模式 `--destructive` 是**亮红** `oklch(0.70 0.18 22)`，回退到 `#fff` 时对比 **2.90:1**（实算）——删除项目对话框的危险按钮在深色下不达标。
- 规格：新增

```css
:root { --destructive-foreground: oklch(0.99 0 0); }       /* 浅色：白字压在深红 0.42 上 */
.dark { --destructive-foreground: oklch(0.14 0.04 260); } /* 深色：深字压在亮红 0.70 上 */
@theme inline { --color-destructive-foreground: var(--destructive-foreground); }
```

> **需确认**：`globals.css:3` 的 `@import "shadcn/tailwind.css"` 是否已提供该 token。本地 `node_modules` 未解析到 `shadcn` 包（`require.resolve` 报 `MODULE_NOT_FOUND`），因此**无法确认该 import 是否补齐**。请在有完整依赖的环境跑一次：`grep -r "destructive-foreground" node_modules/shadcn/`。

### 6.3 中英文混排 / 标点（具体位置）

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| A | `desktop-titlebar.tsx:216` `setChromeError("无法读取窗口状态。")`；`:220` `"无法读取页面历史。"` | **硬编码中文**，未走 `desktop-copy.ts`。而 `desktop-copy.ts:5–7` 的注释明确说四模块已迁 i18n。英文 shell 会出中文 | 两条进 `desktopCopy.chrome.*`，en-US: `Could not read window state.` / `Could not read navigation history.` |
| B | `desktop-titlebar.tsx:534` `aria-label="快速跳转"`；`:546` `placeholder="搜索页面和工作区"` + `aria-label="搜索页面和工作区"`；`:568` `"没有匹配的功能"` | 同上，全部硬编码 | 进 copy 表（`chrome.quickOpenLabel` / `chrome.searchPlaceholder` / `chrome.noMatch`） |
| C | `desktop-copy.ts:122/124/127`（MCP 空态标题**带句号**）vs `:189/192/195/197`（市场）与 `:444`（下载，**不带**） | 同一语义槽位标点不统一 | 标题一律**不带**标点；描述一律**以句号结尾**（后者现状已一致） |
| D | `desktop-copy.ts:46` `installFailToast: "{name} 安装失败：{reason}"` + `reason` 可能自带句号 | 出现 `安装失败：无法读取…。` 双标点 | 传入前 `stripTrailingPunctuation(reason)`；en-US 用 `Failed to install {name}: {reason}`（半角冒号 + 空格） |
| E | `desktop-copy.ts:126` `clearFilters: "清除搜索与筛选"` vs `:191` `clearFilters: "清空筛选"` | 同一动作两个动词、两种宾语 | 统一 `清除筛选` |
| F | `i18n.ts:111` `saving: "保存中..."`（三个半角点）vs `desktop-connection-banner.tsx:11` `"连接已断开，正在重新连接…"`（U+2026）vs `i18n.ts:86` `"生成中…"` | 省略号三种写法 | 统一 **U+2026 单字符 `…`**，且不加句号 |
| G | `desktop-copy.ts:193` 用 `「发现」`，`:47` `移除 MCP 服务“{name}”？` 用 `“”` | 引号体系混用 | 中文统一 `「」`（与产品 UI 现有 `「发现」` 一致），或全用 `“”`——二选一并写入规范 |
| H | `desktop-copy.ts:24/25/26` `connect:"连接"` `disconnect:"断开"` `remove:"移除"`（**光杆动词**）vs `:57` `add:"添加服务"`（**动宾**） | 同一工具栏按钮组结构不齐：`连接 / 断开 / 移除 / 添加服务` | 工具栏内统一**光杆动词**（空间敏感）：`连接`/`断开`/`移除`/`添加`；表单提交按钮统一**动宾**：`添加服务`。即拆成 `actions.add`（光杆）与 `form.submit`（动宾）两个 key |
| I | `desktop-copy.ts:123` `"Agent 无法从这里调用东西。"` vs `:128` `"Agent 才能调用它的工具。"` | 同组文案口语/书面混杂（"东西"） | 统一书面："Agent 无法从这里调用它的工具。" |
| J | 全部中文文案的**中英混排空格** | 抽查 `:123` `本机 stdio 进程`、`:128`、`:190` `当前搜索和类型筛选` 均已加空格 ✓ | 现状良好，写入规范："中文与拉丁字母/数字之间保留 1 个半角空格" |

### 6.4 其它一致性

| 项 | 现状 | 规格 |
| --- | --- | --- |
| live region 语义 | 空态 `role="status"`（静态）、chrome 错误 `<output aria-live="polite">`（错误）、settings inline `role="alert"` + 同时 toast | 错误 = `role="alert"`；状态/成功 = `role="status"`；静态空态不用 live region |
| 滚动条 | `* { scrollbar-width: none; -ms-overflow-style: none }`（`:1911–1917`）+ `::-webkit-scrollbar { display:none }`（`:1919–1923`） | 仅对 `.desktop-feature`、`.local-workbench__explorer`、`.local-workbench__output`、`.mcp-panel`、`.agent-marketplace` 给 `scrollbar-width: thin; scrollbar-color: var(--input-border) transparent`（约 6–8px），其余保持隐藏 |
| 内距节奏 | `.desktop-feature` 24/18–44/32；≤900 18/14/24；`.agent-marketplace` 30/28/52；≤760 22/16/40；`.desktop-command-center` 48/24–76/64 | 归一为 4 的倍数：`--space-page-x: clamp(16px, 3vw, 40px)`、`--space-page-y: 24px` |
| 圆角档 | 4/5/6/7/8/10/12/14 全在用 | 收敛为 3 档：`--radius-sm: 4px`（控件）、`--radius-md: 8px`（浮层/卡片）、`--radius-lg: 12px`（面板） |
| 字号档 | 7/8/9/10/11/12/13/14/15/16/18/19/20/21/22/23/26/27/28/30/36/42/44 | 删除 7/8/9px 三档（本次评审最小到 10px）；正文/标签/标题 3 档：12 / 14 / 18 |

### 6.5 验收口径

1. `grep -c "#[0-9a-fA-F]\{6\}" globals.css` 从 22 降到 ≤3（保留 `#c42b35` 关闭色等平台色，且必须命名成 token）。
2. 深色主题下所有语义文本对比度实测 ≥4.5:1、图标/边框 ≥3:1（脚本跑一遍全 token 组合）。
3. `--destructive-foreground` 有定义且有 `@theme` 映射。
4. `desktop-titlebar.tsx` 内不再出现中文字符串字面量：`grep -nP "[\x{4e00}-\x{9fa5}]" desktop-titlebar.tsx` 只应命中注释。
5. 所有 `*Title:` 值无尾标点；所有 `*Body:`/`*Description:` 以句号结尾。
6. 省略号统一 U+2026：`grep -rn '\.\.\.' --include=*.ts` 只允许命中代码里的 rest/spread。

---

## 7. 全局验收清单（合并版）

| # | 验收项 | 方法 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 一次失败只有一次 alert | 制造设置页失败 | `document.querySelectorAll('[role="alert"]').length === 1` |
| 2 | Toast 堆叠上限 | push 8 条 | 可见 ≤3（≥600 高）/ ≤2（<600 高） |
| 3 | Toast 关闭按钮尺寸 | 量 rect | ≥24×24 |
| 4 | Toast 深色边界 | 深色主题截图 | 能明确分辨浮层与页面（需真机确认） |
| 5 | 空态结构统一 | 8 个空态 DOM | 均含 `h3` + `p`，按钮 ≤1 且 ≥32 高 |
| 6 | 空态标点统一 | grep copy | 标题无标点 |
| 7 | 720×480 无横向溢出 | `scrollWidth === clientWidth` | 每个模块均成立 |
| 8 | 工作台 480 高不裁切 | 量 `scrollHeight` vs `clientHeight` | 无裁切 |
| 9 | **断线横幅可见** | 断网后量 rect + `elementFromPoint` | `top >= 46` 且命中横幅自身 |
| 9b | 顶部两层不重叠 | 矩形交集 | = 0 |
| 10 | 全局焦点环可见 | 逐元素 focus | `outlineStyle !== 'none'` 且 ≥3:1 |
| 11 | 焦点不改几何 | focus 前后量 radius | 相同 |
| 12 | quick-open 方向键 | `↓↓↓` + Enter | 焦点依次移动并激活 |
| 13 | 硬编码色收敛 | grep | ≤3 处且已 token 化 |
| 14 | 深色对比度 | 脚本全量 | 文本 ≥4.5:1 |
| 15 | titlebar 无中文硬编码 | grep 汉字 | 仅注释命中 |

---

## 8. 需真机确认 / 我可能错在哪

**需真机确认（无法只靠读代码判定）**

1. `.desktop-toast` 在深色主题下的实际可辨性（P2-5）：代码层面三层都失效，但 `oklch(0.14)` 与 `oklch(0.18)` 在真实显示器上的差异需目视。
2. **横幅遮挡（§1 P1-0）**：我按 CSS 规则推出"33px 的横幅落在 46px 不透明标题栏背后"，置信度高（同为 fixed、同根堆叠上下文、z-index 95 < 1000、标题栏背景不透明），但**没有真机截图**。若 Electron 对标题栏做了额外处理（例如 `-webkit-app-region: drag` 区域的实际绘制方式、或某个未被我 grep 到的祖先带了 `transform`/`filter`），结论可能翻。**一条命令验证**：断网后在 DevTools Console 跑 `const b=document.querySelector('.desktop-connection-banner'); [b?.getBoundingClientRect().top, document.elementFromPoint(innerWidth/2, 15)?.className]` —— 若第二项返回 `helstera-desktop-titlebar…`，则确认遮挡。
3. 折叠态侧栏 7px/8px 文字在 Windows 缩放 125%/150% 下的实际渲染（可能因缩放变得稍可读，但不改变「应改为隐藏」的结论）。
4. `@import "shadcn/tailwind.css"`（`globals.css:3`）是否补齐 `--destructive-foreground`（§6.2）。
5. `<dialog>` 在 Electron 的 Chromium 版本下 `::backdrop` 与 `showModal()` 行为是否与浏览器一致。
6. 市场卡行动区到底有几个链接：我在 `globals.css:478` 只看到 `> div` 的 `gap:13`，实际数量取决于 `agent-marketplace-page.tsx` 卡片渲染分支（`:258` 之后未逐行精读）。P4-3 的 `253px` 是按 2 个链接估算的**上界**；若实际只有 1 个（116px），174px 卡内仍不溢出，则该问题的触发面比我描述的窄。**这一条我需要自我打折**。
7. 320px 内容区最小宽是按 11px 等宽 50 列推的工程经验值，非实测。

**我可能错在哪（自查）**

1. **非法 CSS 的判定**：我断言 `oklch(var(--foreground) / 0.4)` 是非法值并导致 `outline` 失效。依据是 CSS 语法（`oklch()` 首参须为数字/百分比）。但我没有在浏览器里跑过——如果某浏览器把嵌套的 `oklch()` 当作合法 `color` 处理（理论上不应该），则 §5 P5-1 的结论要降级为"焦点环是 40% 透明的 `--foreground`，在浅色下 18.01:1 × 0.4 α ≈ 视觉偏淡但可见"。**验证方法**：DevTools 选中任意无自定义焦点环的按钮，`getComputedStyle(el).outlineStyle` 与 `outlineColor`。
2. **`--destructive-foreground` 缺失**：只在 `apps/web/src` 内 grep 过，`@import` 的第三方包未解析到。可能误报。
3. **空态"四个"**：题面说四个，我数到八个。可能题面只指某一页；但按调用点数就是 8，我按 8 出规格，若只需改 4 个可裁剪。
4. **对比度公式**：我用的是 OKLCH → 线性 sRGB → WCAG 相对亮度。OKLab/OKLCH → sRGB 的矩阵是公认近似（比 CS 标准色差小，但非逐位精确）。若产品用的是 `culori`/`colorjs.io` 之类库，个别值可能在小数位差 0.05–0.1。结论级判断（达不达 4.5 / 3.0）不受影响，因为我给的临界值都留了余量（最接近的是 `#21845b` 4.45 与 `#a75b2b` 3.96）。
5. **46px 被扣了两次**：`html[data-helstera-desktop="true"] body { padding-top: 46px }`（`:611`）与 `html[data-helstera-desktop="true"] .workspace-shell > main { padding-top: 46px }`（`:149`）**同时存在**。若 `main` 确实在 `body` 内，则文档流顶部让位 `46 + 46 = 92px`，比 46px 的标题栏多出 **46px 死区**。这直接影响 §4 的 720×480 纵向预算（可用高可能只有 `480 − 92 = 388px` 而不是 434px，工作台溢出从 54px 变成 **100px**）。但如果桌面端走的是 `desktop-app-page.tsx` 这条不经过 `.workspace-shell` 的渲染路径，则 `:149` 不生效、只扣 46px。**需真机量**：`getComputedStyle(document.body).paddingTop` 与 `getComputedStyle(document.querySelector('main')).paddingTop` 的实际值，以及 `document.querySelector('main').getBoundingClientRect().top`。
6. **`border-radius` 焦点副作用**：`border-radius: 4px` 在 `:focus-visible` 里对**所有**元素生效（含非 button），我只是从修复必要性列举了 4 个组件，实际影响面可能更大（例如输入框、卡片）。

---

*评审者：用户体验设计（只读评审）。本文件是本次任务唯一写入的文件，未改动任何实现代码。*
