## 核心要求
- 代码旨在为高效生产和高质量要求而不是MVP搭建DEMO完成，完成功能要考虑产品特性和整体交互，阅读以及撰写时思维需要有大局观，以第一性原理直击痛点。赠人玫瑰手留余香。
- **品牌名称**: 统一使用 **Helstera**（已全面替代 Loomic），前端项目路径别名 `@helstera/...`
- **技术栈索引**: 查看 `llm.txt` 作为 LangChain/LangGraph/deepagents 开发的索引文档。

## 项目架构

```
Loomic/                          # repo root (品牌名 Helstera)
├── apps/
│   ├── web/                     # Next.js 15 前端 (ssr + static export / PWA)
│   ├── server/                  # Fastify 5 后端 API
│   └── desktop/                 # Electron 桌面应用 (新增)
├── packages/
│   ├── shared/                  # 共享类型、Zod schemas
│   ├── ui/                      # UI 组件库 (shadcn base-nova)
│   └── config/                  # 共享配置
└── CLAUDE.md
```

## 开发命令

```bash
pnpm install
pnpm dev          # 启动全部服务 (web + server + worker)
pnpm dev:server   # 仅后端
pnpm dev:worker   # 仅 worker
pnpm dev:workers:2  # 2 个 worker 实例
pnpm build        # 构建全部
pnpm build:web    # 仅前端
pnpm typecheck    # 类型检查全部
pnpm lint         # Biome lint
```

## 桌面应用开发

```bash
cd apps/desktop
pnpm install
pnpm dev          # Electron + Vite 热重载
pnpm build        # 构建跨平台安装包
```

## 关键文件位置

| 功能 | 文件 |
|------|------|
| **品牌化入口** | `apps/web/src/app/layout.tsx`, `landing/*.tsx` |
| **定价页** | `apps/web/src/app/pricing/` |
| **画布核心** | `apps/web/src/app/canvas/page.tsx`, `components/canvas-editor.tsx` |
| **Agent 系统提示** | `apps/server/src/agent/prompts/helstera-main.ts` |
| **水印** | `apps/server/src/features/credits/watermark.ts` |
| **PWA** | `apps/web/public/manifest.json`, `apps/web/public/sw.js` |
| **桌面端** | `apps/desktop/electron/main.ts` |

## 代码风格

- TypeScript strict mode，遵循项目现有模式
- 日志使用 `console.info` / `console.warn` / `console.error` 区分级别
- 交互组件使用 Framer Motion 动画
- UI 组件基于 shadcn/ui + Base UI
