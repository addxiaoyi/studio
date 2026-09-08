# Helstera Design Language

> Glassmorphism · 留白克制 · 高级感

## 1. 核心原则

| 原则 | 描述 |
|------|------|
| **Quiet colors** | 90% 中性灰，唯一强调色仅在 CTA/标签使用 |
| **Generous whitespace** | section 间距 32-40（128-160px） |
| **Light typography** | weight 300-500 为主，display 用 500 即可 |
| **Layered glass** | 3 档玻璃面板，根据重要度选用 |
| **Editorial scale** | 大字号用 clamp，clutter 留白 |
| **A11y first** | 键盘焦点环、prefers-reduced-motion 全支持 |

## 2. Design Tokens

### 2.1 Colors (CSS Variables)

#### Light mode
| Token | Value | 用途 |
|-------|-------|------|
| `--background` | `oklch(0.985 0.003 260)` | 页面底色 |
| `--foreground` | `oklch(0.18 0.015 260)` | 主文字 |
| `--muted` | `oklch(0.96 0.005 260)` | 次背景 |
| `--muted-foreground` | `oklch(0.52 0.015 260)` | 次文字 |
| `--border` | `oklch(0.92 0.005 260)` | 默认边框 |
| `--primary` | `oklch(0.30 0.08 270)` | 主色（深靛蓝） |
| `--accent` | `oklch(0.82 0.14 130)` | 强调（青柠） |

#### Dark mode
| Token | Value | 用途 |
|-------|-------|------|
| `--background` | `oklch(0.14 0.012 260)` | 页面底色 |
| `--foreground` | `oklch(0.94 0.005 260)` | 主文字 |
| `--primary` | `oklch(0.78 0.10 130)` | 主色（青柠） |
| `--accent` | `oklch(0.75 0.12 130)` | 强调 |

### 2.2 Spacing

| 用途 | Token | Value |
|------|-------|-------|
| section 内边距 | `py-32 md:py-40` | 128px / 160px |
| 容器内 padding | `px-6` | 24px |
| 元素堆叠 | `gap-8 / gap-12` | 32px / 48px |
| 标题与副标题 | `mt-6` | 24px |
| 描述与 CTA | `mt-10 / mt-14` | 40px / 56px |
| 卡片内 padding | `p-7 / p-8` | 28px / 32px |
| 卡片内元素 | `mt-7 / mt-8` | 28px / 32px |
| 行内 icon + 文字 | `gap-2 / gap-3` | 8px / 12px |

### 2.3 Typography

#### Display 字号 (用 utility)
| Utility | 范围 | Weight | Tracking | Use |
|---------|------|--------|----------|-----|
| `display-xl` | 3-5.5rem | 500 | -0.04em | Hero h1 |
| `display-lg` | 2.5-4rem | 500 | -0.035em | Section h2 |
| `display-md` | 2-3rem | 500 | -0.03em | Card h3 |
| `display-sm` | 1.5-2rem | 500 | -0.02em | Block h3 |

#### Body
| Utility | Size | Leading | Use |
|---------|------|---------|-----|
| `eyebrow` | 0.75rem | 1.4 | eyebrow uppercase |
| `body-relaxed` | 1.0625rem | 1.7 | 描述正文 |
| `text-base` | 1rem | 1.5 | 默认 |
| `text-sm` | 0.875rem | 1.5 | 次要 |
| `text-xs` | 0.75rem | 1.5 | caption |

#### Hierarchy
- **H1**: display-xl (3-5.5rem), `text-wrap: balance`
- **H2**: display-lg (2.5-4rem)
- **H3**: display-md 或 font-medium text-base
- **Body**: text-base 或 body-relaxed, `text-wrap: pretty`
- **Caption**: eyebrow / text-xs

### 2.4 Glass Levels (3 档)

| 用途 | Utility | 特点 |
|------|---------|------|
| **模态/重要面板** | `glass-strong` | 0.72 透明 / 40px blur / 200% sat / 0.72 shadow |
| **标准卡片** | `glass` | 0.55 透明 / 24px blur / 180% sat / 0.12 shadow |
| **提示/轻量容器** | `glass-soft` | 0.40 透明 / 16px blur / 160% sat |

### 2.5 Shadow (5 档固定)

| 场景 | Utility | Value |
|------|---------|-------|
| 极轻抬升 | `shadow-soft` | 1px + 3px 双层 |
| 卡片 | `shadow-card` | 2px + 16px |
| 卡片 hover | `shadow-card-hover` | 4px + 28px |
| 浮层 | `shadow-float` | 8px + 48px |
| glow | `accent-glow` | 24px 强调色光晕 |

### 2.6 Radius

| 用途 | Class |
|------|-------|
| 按钮 | `rounded-full` |
| 玻璃面板 | `rounded-2xl` 或 `rounded-[1.5rem]` |
| 装饰大块 | `rounded-3xl` |
| 图片 | `rounded-2xl` |
| 设备框 | `rounded-3xl` |

### 2.7 Button System (3 档)

**Primary CTA** (黑色实底):
```tsx
<Link className="inline-flex items-center px-7 py-3 rounded-full text-sm font-medium
  bg-foreground text-background
  transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]">
  CTA
</Link>
```

**Secondary CTA** (玻璃描边):
```tsx
<Link className="inline-flex items-center px-7 py-3 rounded-full text-sm font-medium
  text-foreground glass-soft hover:glass
  transition-all duration-300">
  CTA
</Link>
```

**Tertiary / 文字按钮**:
```tsx
<Link className="text-sm text-muted-foreground hover:text-foreground transition-colors">
  了解更多 →
</Link>
```

### 2.8 Iconography

| 规则 | Value |
|------|-------|
| Stroke width | `1.5` (统一) |
| Size in body | `size-4` (16px) |
| Size in section title | `size-3.5` (14px) |
| Color | `text-muted-foreground/60-80` 或 `text-foreground/70` |
| 装饰 icon | `text-foreground/10` 或 极轻 |

### 2.9 Spacing rhythm

#### section pattern
```tsx
<section className="py-32 md:py-40">  {/* 128-160px */}
  <div className="max-w-6xl mx-auto px-6">  {/* 内容最大 1152px */}
    <div className="mb-24 md:mb-32">  {/* 标题与内容间距 96-128px */}
      <SectionHeader />
    </div>
    {/* 内容，gap-4 (16px) 用于卡片网格 */}
  </div>
</section>
```

## 3. 组件级规范

### 3.1 SectionHeader

```tsx
<SectionHeader
  eyebrow="可选 eyebrow"
  title="标题"
  subtitle="副标题"  // body-relaxed 自动应用
  align="center"   // 或 "left"
/>
```

### 3.2 Card (玻璃卡)

```tsx
<div className="glass rounded-[1.5rem] p-8">
  <h3>...</h3>
  <p>...</p>
</div>
```

### 3.3 Feature block (左文右图/反之)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
  <div className="max-w-md">  {/* 文字侧 max-width 限制 */}
    {/* eyebrow + display-sm + body-relaxed + metric */}
  </div>
  <div className="glass rounded-[1.5rem] p-4">  {/* 图片用玻璃框包裹 */}
    <Image />
  </div>
</div>
```

## 4. 交互态系统

### 4.1 Hover
- 卡片: `hover:-translate-y-1 transition-all duration-300`
- 按钮: `hover:scale-[1.02] active:scale-[0.99]`
- 列表项: `hover:bg-foreground/[0.04] transition-colors duration-200`

### 4.2 Focus (a11y)
- 玻璃按钮: `focus-visible:ring-2 focus-visible:ring-foreground/20`
- 重要按钮: `focus-visible:ring-2 focus-visible:ring-foreground/30`
- 全局规则: 2px outline + 4px 圆角

### 4.3 Active
- 卡片激活: `glass` + `border-foreground/20`
- 列表激活: `glass-soft border border-border/40`

## 5. 动效系统

### 5.1 过渡
- 玻璃 hover: `transition-all duration-300`
- 颜色变化: `transition-colors duration-200`
- 阴影变化: `transition-shadow duration-300`

### 5.2 入场
- Page: `y: 6 + filter: blur(4px) → 0` 300ms
- 组件: `y: 24 + opacity: 0 → 0 + 1` 600ms
- 卡片: `y: 28 + scale: 0.96 → 0 + 1` 500ms

### 5.3 prefers-reduced-motion
- 全局响应：所有动画降至 0.01ms
- 已支持 14 个动画关键帧降级

## 6. 禁止清单 (Anti-patterns)

| ❌ 不要 | ✅ 替代 |
|--------|---------|
| 渐变彩色背景 | 单一透明色 + 玻璃 |
| 彩色边框 | hairline 边框（透明度 < 40%） |
| 厚实阴影 | 柔和多层阴影（oklch 0/0.04） |
| 大字粗体 | 细 weight (300-500) + clamp() |
| 多个鲜艳 CTA | 黑色 1 + 玻璃 1 + 文字 1 |
| 单一字号 | display-xl → text-xs 多级 |
| 圆角混乱 | 统一 full/2xl/3xl |
| 间距混乱 | 用 4/8/12/16/24/32 节奏 |
| 高饱和 hover | 微弱 transform + 阴影变化 |
| 渐变文字 | 单色 + 透明度变化 |
| 多个不同阴影 | 5 档固定 shadow-* |
| `bg-muted` hover | `hover:bg-foreground/[0.04]` |
| `bg-card`/`bg-popover` | `glass`/`glass-soft`/`glass-strong` |
| `font-bold` | `font-medium`/`font-light` |
| `border-[0.5px]` | `border border-border/40` |

## 7. 可复用组件

| 组件 | 用途 | 文件 |
|------|------|------|
| `EmptyState` | 统一空态视觉 | `components/empty-state.tsx` |
| `EmptyStateAction` | 空态 CTA 按钮组 | 同上 |
| `Skeleton` | 加载占位 | `components/skeleton.tsx` |
| `SkeletonText` | 文本行占位 | 同上 |
| `SkeletonCard` | 卡片占位 | 同上 |
| `SectionHeader` | 章节标题 | `components/landing/section-header.tsx` |

## 8. 关键质量指标

| 指标 | 当前值 | 目标 |
|------|--------|------|
| Typecheck | ✅ 5/5 包通过 | 0 错误 |
| Build | ✅ 18 路由构建成功 | 全部成功 |
| 设计 token 覆盖 (glass) | 59 文件 | 持续 |
| 字体 token 覆盖 (display-*) | 15 文件 | 持续 |
| 焦点环覆盖 | 22 文件 | 持续 |
| `font-bold` 残留 | 0 | 0 |
| `hover:bg-muted` 残留 | 0 | 0 |
| `bg-popover` 残留 | 1 (shadcn dropdown) | 维持 |
| `loomic` 源码残留 | 0 | 0 |
| 总代码优化 | ~200+ 文件 | 持续 |

## 9. 国际化
- ✅ UI 文案全中文化
- ✅ 关键按钮使用习惯动词（开始试用、立即领取）
- ✅ 数字使用中文千位分隔
