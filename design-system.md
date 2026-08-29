# GPT Image Playground — 设计规范系统

> 提取自 [github.com/CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground)（v0.7.3）。
> 技术底座：React 19 + Vite + TypeScript + Tailwind CSS 3 + Zustand。
> 本文件是项目现有 UI 的设计规范整理稿，可作为新增功能的样式参考与实现指南。

---

## 1. 设计总览

| 维度     | 定位                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 风格     | 简洁、轻盈的毛玻璃（Glassmorphism） + 柔和圆角 + 弱阴影                                                        |
| 语言     | 中文 UI（`lang="zh-CN"`），代码注释使用中文                                                                    |
| 主题     | 双主题：浅色 / 深色（`darkMode: 'media'`，跟随系统 `prefers-color-scheme`）                                    |
| 主色     | 蓝色系（`blue-500 #3b82f6` 为品牌主色）                                                                        |
| 色彩体系 | shadcn/ui 风格语义色板（background/foreground/muted/primary/sidebar）以 **HSL CSS 变量** 承载，Tailwind 中引用 |
| 适配     | 移动端优先的响应式 + iOS 安全区（safe-area）支持 + PWA                                                         |
| 选字策略 | 全局 `user-select: none`，仅在输入/可选择区域（`data-selectable-text`）开放选字                                |

---

## 2. 设计令牌（Design Tokens）

### 2.1 颜色（Colors）

定义位置：`src/index.css` `:root` 与 `@media (prefers-color-scheme: dark)`；`tailwind.config.js` 的 `theme.extend.colors`。

Tailwind 色板映射（`tailwind.config.js`）：

```js
colors: {
  background:  'hsl(var(--background) / <alpha-value>)',
  foreground:  'hsl(var(--foreground) / <alpha-value>)',
  border:      'hsl(var(--border) / <alpha-value>)',
  input:       'hsl(var(--input) / <alpha-value>)',
  muted:       { DEFAULT: 'hsl(var(--muted)/...)', foreground: 'hsl(var(--muted-foreground)/...)' },
  primary:     { DEFAULT: 'hsl(var(--primary)/...)', foreground: 'hsl(var(--primary-foreground)/...)' },
  sidebar:     { DEFAULT: 'hsl(var(--sidebar)/...)', foreground: 'hsl(var(--sidebar-foreground)/...)' },
  gray:        colors.zinc,   // 灰色使用 zinc 色阶
}
```

**语义令牌原始值（HSL）：**

| 令牌                   | 浅色模式                           | 深色模式                           | 说明                      |
| ---------------------- | ---------------------------------- | ---------------------------------- | ------------------------- |
| `--background`         | `0 0% 100%`（白）                  | `240 10% 4%`（近黑）               | 页面背景                  |
| `--foreground`         | `240 10% 10%`                      | `0 0% 98%`                         | 主文本色                  |
| `--muted`              | `240 5% 96%`                       | `240 4% 16%`                       | 弱化背景（卡片/侧栏底色） |
| `--muted-foreground`   | `240 4% 46%`                       | `240 5% 65%`                       | 弱化文本色                |
| `--border`             | `240 6% 90%`                       | `240 4% 22%`                       | 边框色                    |
| `--input`              | `240 6% 90%`                       | `240 4% 22%`                       | 输入框边框                |
| `--primary`            | `221 83% 53%`（≈#2563eb blue-600） | `217 91% 60%`（≈#3b82f6 blue-500） | 品牌主色（按钮/选中态）   |
| `--primary-foreground` | `0 0% 100%`                        | `0 0% 100%`                        | 主色上的文本              |
| `--sidebar`            | `240 5% 96%`                       | `240 5% 12%`                       | 侧栏背景                  |
| `--sidebar-foreground` | `240 10% 10%`                      | `0 0% 98%`                         | 侧栏文本                  |

> 注意：虽然定义了 `primary`/`background` 等语义令牌，但**实际组件中大量直接使用 Tailwind 标准色**（`blue-500`、`gray-*`、`zinc`），令牌层与组件层存在并行混用。

**功能色（组件层实际使用）：**

| 用途      | 浅色                            | 深色                | 语义                   |
| --------- | ------------------------------- | ------------------- | ---------------------- |
| 主操作    | `bg-blue-500 hover:bg-blue-600` | 同左                | 提交/确认/选中         |
| 成功      | `green-500/600`                 | `green-400/500`     | 下载成功、完成         |
| 危险      | `red-500 hover:red-600`         | `red-400/500`       | 删除/失败/停止         |
| 警告      | `yellow-400/500`                | `yellow-300/400`    | 收藏、重连中、部分失败 |
| 信息/辅助 | `gray-400→gray-600`             | `gray-500→gray-300` | 次要图标、说明文字     |
| 强调文字  | `blue-500/600`                  | `blue-300/400`      | 链接、选中项           |

**文字层级（Tailwind 类）：**

- 标题：`text-gray-800 dark:text-gray-100`，加粗（`font-bold/font-semibold`）
- 正文：`text-gray-700 dark:text-gray-300`
- 次要说明：`text-gray-400 dark:text-gray-500`
- 占位符：`text-gray-400 dark:text-gray-500`

### 2.2 字体（Typography）

引入方式（`src/index.css` 顶部 CDN）：

- 界面字体：**HarmonyOS Sans SC**（经 `@lobehub/webfont-harmony-sans-sc`）+ 另一路中文无衬线字体；
- 等宽字体：**Maple Mono**（经字体 CDN 引入）。

```css
--font-ui-sans: 'HarmonyOS Sans SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
--font-mono: 'Maple Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
```

| 字体家族 | Tailwind 类         | 使用场景                                        |
| -------- | ------------------- | ----------------------------------------------- |
| 界面字体 | `font-sans`（默认） | 全部 UI                                         |
| 等宽字体 | `font-mono`         | 尺寸/分辨率标签、耗时、代码块、原始响应、版本号 |

字号约定（组件实际使用）：

- 大标题：`text-lg / text-xl` + `font-bold`（如弹窗标题）
- 标题/卡片标题：`text-sm/text-[15px]` + `font-semibold/font-medium`
- 正文：`text-sm`（14px）为主，消息正文 `text-[15px]`
- 次要标签：`text-xs`（12px）
- 极细标签/徽章：`text-[10px] / text-[11px]`
- 移动端 inputs/textarea/select 强制 `font-size: 16px`（防 iOS 缩放）

### 2.3 圆角（Border Radius）

| 值                       | 使用                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `rounded-md` / `rounded` | 小图标按钮、代码片段、输入内部元素                           |
| `rounded-lg`             | 图标按钮（header/卡片操作）、输入框（部分）                  |
| `rounded-xl`             | **最常见**：按钮、输入框、下拉菜单、卡片、复选框、标签       |
| `rounded-2xl`            | 输入栏主容器（移动端）、设置卡片、菜单弹层                   |
| `rounded-3xl`            | 弹窗面板（ConfirmDialog/DetailModal/SettingsModal）          |
| `rounded-full`           | Toast、胶囊标签、开关、拖拽条、圆形图标容器、Lightbox 计数器 |

### 2.4 阴影（Shadows）

| 值                                        | 使用                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| `shadow-sm`                               | 按钮、输入框、卡片默认态、segmented 控件             |
| `shadow-md`                               | 选中卡片、Lightbox 主按钮                            |
| `shadow-lg`                               | 卡片 hover、工具提示（context menu）                 |
| `shadow-xl`                               | 下拉菜单、拖拽预览                                   |
| `shadow-2xl`                              | 设置面板/遮罩工具栏                                  |
| `shadow-[0_8px_30px_rgb(0,0,0,0.12)]`     | 输入栏容器、下拉/弹出层（浮动表面标准阴影）          |
| `shadow-[0_8px_40px_rgb(0,0,0,0.12/0.4)]` | 大弹窗（Confirm/Detail）                             |
| 深色覆盖                                  | `dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)]` 等更重阴影 |

### 2.5 浮动表面通用配方（Glass 卡片/弹层）

几乎所有浮层（下拉、菜单、输入栏卡片、拖拽预览）共用以下配方：

```
bg-white/95 (dark:bg-gray-900/95) backdrop-blur-xl
border-gray-200/60 (dark:border-white/[0.08])
ring-1 ring-black/5 (dark:ring-white/10)
shadow-[0_8px_30px_rgb(0,0,0,0.12)] (dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)])
```

- 弹窗面板再叠加 `bg-white/90 dark:bg-gray-900/90` + `backdrop-blur-xl` + `border-white/50` + `rounded-3xl`。
- 桌面卡片实底：`bg-white dark:bg-gray-900` + `border-gray-200 dark:border-white/[0.08]`。

### 2.6 边框（Border）

- 常规：`border-gray-200 dark:border-white/[0.08]`（极低透明度白边用于深色模式，贯穿全站）
- 强调/选中：`border-blue-500`（任务卡运行中 `border-blue-400 generating`、选中 `ring-2 ring-blue-500/50`）
- 危险：`border-red-500/30` 等
- 深色模式 hover 高亮：`dark:hover:border-white/[0.18]`

### 2.7 间距与布局

- 页面容器：`max-w-7xl mx-auto` + `safe-area-x`
- 栅格：任务网格 `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- 页面留白：主体 `pb-48`（为底部输入栏让位）；搜索栏 `mt-6 mb-4`
- 断点：`sm`(640) 为移动/桌面分界；`md`(768) 用于详情弹窗布局；`lg`(1024) 用于任务网格与侧栏
- 头部固定：`fixed top-0 z-40`，滚动时自动隐藏/显示（`translate-y`）

### 2.8 Z-index 层级约定

| 层                            | 值                                  |
| ----------------------------- | ----------------------------------- |
| Header                        | `z-40`                              |
| 搜索栏浮层 / 选择框           | `z-30`                              |
| 下拉菜单（Select 内）         | `z-50`                              |
| 确认对话框 / 托盘             | `z-[60]`                            |
| 设置弹窗                      | `z-[70]`                            |
| Lightbox 根                   | `z-[100]`（+ `data-lightbox-root`） |
| 确认对话框面板                | `z-[110]`                           |
| Toast / Tooltip / 拖拽预览    | `z-[120]` / `z-[110]` / `z-[110]`   |
| 拖拽上传浮层 / 遮罩画笔工具条 | `z-[140]` / `z-[100]`               |

---

## 3. 主题与暗色模式

- 切换机制：`darkMode: 'media'`，随系统 `prefers-color-scheme`，无手动切换按钮。
- 全站类名均为「浅色 + `dark:` 覆盖」双写模式。
- 关键习惯：
  - 灰色文本：`text-gray-* dark:text-gray-*`（深色下略提亮）
  - 边框：`border-gray-200 dark:border-white/[0.08]`
  - 表面：`bg-white dark:bg-gray-900`（卡片）；浮层 `bg-white/95 dark:bg-gray-900/95`
  - hover 底：`hover:bg-gray-100 dark:hover:bg-white/[0.04]` 或 `dark:hover:bg-white/[0.06]`
  - 蒙层：`bg-black/20 dark:bg-black/40` + `backdrop-blur-md`
  - 彩色弱底：`bg-blue-50 dark:bg-blue-500/10`，文字 `text-blue-600 dark:text-blue-400`

---

## 4. 组件规范

### 4.1 按钮（Button）

**主要按钮（Primary）**

```
bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed
rounded-xl px-* py-2/2.5 text-sm font-medium shadow-sm transition-all
```

- 提交按钮还带 `active:scale-[0.98]`（按压微缩）。
- 危险主按钮：`bg-red-500 hover:bg-red-600 text-white`；警告：`bg-orange-500 hover:bg-orange-600`。

**次要/描边按钮（Secondary）**

```
border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-400
hover:bg-gray-50 dark:hover:bg-white/[0.06] rounded-xl px-4 py-2 text-sm font-medium
```

**弱背景按钮（Ghost，最常用于图标操作）**

```
p-2 / p-2.5 rounded-lg / rounded-xl text-gray-400
hover:bg-gray-100 dark:hover:bg-white/[0.04] hover:text-gray-600 (或对应语义色)
transition-colors
```

**图标操作按钮（任务卡/详情）**：`p-1.5 rounded-md text-gray-400 hover:text-<语义色> hover:bg-<语义色>-50 dark:hover:bg-<语义色>-950/30`，语义色约定：重试=蓝、复用=蓝、收藏=黄、编辑输出=绿、删除=红。

**按钮 tone 选择器（ConfirmDialog `getActionButtonClass`）**

- `primary` → `bg-blue-500 text-white hover:bg-blue-600`
- `danger` → `bg-red-500 text-white hover:bg-red-600`
- `warning` → `bg-orange-500 text-white hover:bg-orange-600`
- `secondary` → 描边按钮
- 按钮统一 `disabled:cursor-not-allowed disabled:opacity-60`

### 4.2 输入框（Input / Textarea）

```
w-full px-3/4 py-2/2.5 rounded-xl border border-gray-200 dark:border-white/[0.08]
bg-white dark:bg-gray-900 text-sm
focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400
transition
```

- 提示词输入区为 `contentEditable`，样式：`rounded-2xl border-gray-200/60 bg-white/50 dark:bg-white/[0.03] focus:ring-1 focus:ring-blue-300/40 shadow-sm`。
- 设置内输入框：`bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06]`。
- 数字输入：隐藏原生 spin 按钮（`-webkit-inner-spin-button`、`-moz-appearance:textfield`）。

### 4.3 下拉选择（Select，自定义组件）

- 触发器：由调用方传 `className`（`rounded-xl border ...`），内含 `flex items-center justify-between` + 右侧 `ChevronDownIcon`（展开时 `rotate-180`）。
- 菜单：`absolute z-50 w-full rounded-xl border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px...] ring-1 backdrop-blur-xl`，**自动上/下翻**（`animate-dropdown-down/up`），高度自适应视口与滚动容器（`DEFAULT_DROPDOWN_MAX_HEIGHT`）。
- 选项行：`flex items-center gap-2 px-3 py-2 text-xs transition-colors`；选中项 `bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium`；hover `hover:bg-gray-50 dark:hover:bg-white/[0.06]`。
- 特殊变体：`variant:'action'`（蓝字+加号）、`variant:'danger'`（红字）、`draggable`（拖拽排序 + 拖放位置指示线 `h-[2px] bg-blue-500`）、行内操作按钮。
- 支持触屏长按提示、触摸拖拽预览（Portal 浮层）。

### 4.4 复选框（Checkbox）

- 规格：`w-4 h-4 rounded-[4px] border bg-white` + 自定义对勾 SVG（`peer-checked:opacity-100`）。
- 主色调：`checked:bg-blue-500 checked:border-blue-500`，`focus:ring-2 focus:ring-blue-500/20`。
- danger 色调：`checked:bg-red-500/85` 边框红系。
- 标签：`text-[13px] font-medium text-gray-700 dark:text-gray-300`。

### 4.5 开关（Toggle Switch）

```
relative inline-flex h-4 w-7 items-center rounded-full transition-colors
on: bg-blue-500 | off: bg-gray-300 dark:bg-gray-600
滑块: inline-block h-3 w-3 rounded-full bg-white shadow transition-transform
      on: translate-x-[14px] | off: translate-x-[2px]
```

### 4.6 标签 / 徽章（Badge / Tag）

**参数信息标签**（任务卡）：`flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs text-gray-600 dark:text-gray-300`；强调色标签：

- 局部重绘 → `bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400`
- 透明背景 → `bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`
- 差异高亮 → `bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300`

**图片角标**（覆盖在图上）：`bg-black/50 text-white text-[10px]/xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono`（耗时、分辨率标签）。

**胶囊（Chip）**：收藏、NEW 角标等使用 `rounded-full` + `bg-red-500 text-white`。

**输入框 @图片 胶囊（mention-tag）**

```
inline-flex items-center h-[1.625em] px-[7px] rounded-[6px]
bg-[#eff6ff] text-[#2563eb] border border-[#dbeafe] font-semibold text-sm
选中态: bg-[#2563eb] text-white border-[#1d4ed8]
深色: bg-rgba(59,130,246,.12) text-[#93c5fd]
```

### 4.7 弹窗（Modal）

统一结构：

1. 全屏遮罩：`fixed inset-0 z-* flex items-center justify-center p-4`
2. 蒙层：`absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in`
3. 面板：`relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px...] ring-1 animate-modal-in`

| 弹窗            | 尺寸 / 布局                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| 确认对话框      | `max-w-sm w-full p-6`，底部双按钮 `flex gap-2`，每按钮 `flex-1 py-2 rounded-xl` |
| 详情弹窗        | `max-w-4xl max-h-[90vh] flex flex-col md:flex-row`，左侧图片区 + 右侧信息面板   |
| 设置弹窗        | `max-w-3xl h-[85vh] sm:h-[600px] flex flex-col`，左侧导航 + 右侧滚动内容区      |
| 帮助弹窗        | `max-w-2xl`，`flex-1 overflow-y-auto overscroll-contain`                        |
| 收藏夹选择/管理 | 约 `max-w-md`，标题 + 列表 + 底部操作                                           |

- 弹窗通用：Esc 关闭（`useCloseOnEscape`）、背景滚动锁定（`usePreventBackgroundScroll`）、点击蒙层关闭。
- 设置弹窗左侧导航项：`flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl`，选中 `bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium`。

### 4.8 确认对话框（ConfirmDialog）

- 标题：`text-base font-bold text-gray-800 dark:text-gray-100`，可带 info/copy 图标（`text-blue-500`）。
- 消息：`text-sm text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-line`；支持内联 `` `code` `` 与 `**strong**` 渲染。
- 按钮 tone 自动推断：标题含「删除/清空」自动转 danger。
- 支持：复选框（`checkbox`）、确认冷却（`minConfirmDelayMs`）、异步 await（`awaitAction`）、自定义按钮组。
- 动画：`animate-confirm-in`（自下方 `scale(0.92) translateY(16px)` 弹入）。

### 4.9 Toast

- 定位：`fixed bottom-24 left-1/2 z-[120]`（底部居中，避开输入栏）。
- 容器：`flex items-center gap-2.5 px-5 py-3.5 rounded-full bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border ... shadow-[0_8px_30px...] ring-1 text-sm font-medium`。
- 类型图标：成功（绿圆底 + 对勾）、错误（红圆底 + X）、信息（蓝圆底 + i）。
- 动画：`toast-enter`（自底部上浮，`cubic-bezier(0.16,1,0.3,1)`）。

### 4.10 Tooltip

- `ViewportTooltip` 组件：`rounded-lg bg-gray-800 px-3 py-2 text-xs text-white shadow-lg` + 指向箭头（`border-gray-800`），Portal 到 body，自动 top/bottom 翻转、视口内 clamp、被遮挡时隐藏。
- 另有 `ButtonTooltip`/`ViewportTooltip` 变体供按钮悬停提示；触发方式为 `useTooltip()` hook 的 `handlers`（mouse enter/leave + touch）。

### 4.11 卡片

**任务卡片（TaskCard）**

```
relative bg-white dark:bg-gray-900 rounded-xl border overflow-hidden
border-gray-200 dark:border-white/[0.08]
hover:shadow-lg dark:hover:bg-gray-800/80
运行中: border-blue-400 generating
选中:   border-blue-500 shadow-md ring-2 ring-blue-500/50
```

- 布局：左 160px 图片区（`w-40`）+ 右侧信息区 `p-3`。
- 图片区状态：生成中（蓝 spinner +「生成中...」）、重连中（黄旋转图标）、失败（红 i 图标 +「失败」）、已完成（缩略图 + 角标）。
- 信息区：提示词 `text-sm text-gray-700 line-clamp-3`、参数横向滚动标签条（`hide-scrollbar mask-edge-r`）、操作按钮组。
- 移动端支持侧滑多选（底图 `bg-blue-500` / 已选 `bg-gray-500` + 勾/叉图标）。

**收藏夹概览卡片**：封面色块（`bg-yellow-50 dark:bg-[#2a2211] text-yellow-500`）+ 名称 + 任务数 + 操作按钮（默认/下载/删除）。

### 4.12 Lightbox（大图预览）

- 全屏黑底：`fixed inset-0 z-[100] bg-black/90`。
- 图片：`animate-zoom-in`；支持捏合缩放（1–10x）、双击放大、左右滑动切换、键盘左右键。
- 悬浮控件：顶部图片信息胶囊、底部左右切换圆钮（`bg-black/30 hover:bg-black/50`）、底部主操作条（`rounded-xl px-5 py-2.5 text-sm font-medium`，主按钮 `bg-blue-500 hover:bg-blue-600 active:scale-95`）。
- 计数/提示：`bg-black/50 text-white text-xs rounded-full`。

### 4.13 头部（Header）

- 结构：`fixed top-0 left-0 right-0 z-40 safe-area-top bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]`，滚动隐藏（`-translate-y-full`）。
- 品牌标题：`text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100`。
- 模式切换（画廊/Agent）：segregated 控件 `rounded-xl border ... bg-gray-100/70 p-1`，选中项 `bg-white dark:bg-white/10 shadow-sm font-medium`。
- 图标按钮：`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900`，图标 `w-5 h-5 text-gray-600 dark:text-gray-400`，均带 Tooltip。
- NEW 角标：`absolute px-1 py-0.5 rounded-[4px] bg-red-500 text-white text-[9px] font-black`。

### 4.14 输入栏（InputBar）

- 主容器：浮动玻璃卡片 `bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl rounded-2xl sm:rounded-3xl p-3 sm:p-4 ring-1 shadow-[0_8px_30px...]`。
- 顶部移动端拖拽条：`w-10 h-1 rounded-full bg-gray-300 dark:bg-white/[0.06]`。
- 提交按钮：桌面端为方形图标钮 `p-2.5 rounded-xl shadow-sm`（`bg-blue-500 hover:bg-blue-600`，停止态 `bg-red-500`，无配置 `bg-gray-300`）；移动端为通栏按钮 `w-full py-2.5 rounded-xl text-sm font-medium` + 文案「生成图像 / 停止生成 / 遮罩编辑」。
- 参考图缩略：`w-[52px] h-[52px] rounded-xl`，序号角标 + 删除小圆钮（`bg-red-500 rounded-full`）。
- 添加图按钮：`w-[52px] h-[52px] rounded-xl border-dashed`，hover 变红提示。
- 参数面板：`grid gap-2 text-xs`，每项 `label flex flex-col gap-0.5`（标签 `text-gray-400 dark:text-gray-500 ml-1`）+ 控件。

### 4.15 搜索栏（SearchBar）

- 结构：`mt-6 mb-4 flex gap-3`，左侧工具按钮 + 右侧搜索框。
- 搜索框：`pl-10 pr-4 py-2.5 rounded-xl border ... focus:ring-2 focus:ring-blue-500/30`，前置放大镜 SVG。
- 工具按钮：`p-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900`，收藏激活态 `border-yellow-400 bg-yellow-50 text-yellow-500`。

### 4.16 设置面板（SettingsModal）

- 面板：`max-w-3xl rounded-3xl flex h-[85vh] sm:h-[600px] flex-col overflow-hidden`，标题栏 + 左导航（桌面竖排/移动横排）+ `flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6` 内容。
- 设置区块卡片：`rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm`；危险区块：`border-red-100/50 bg-red-50/30 dark:border-red-500/10 dark:bg-red-500/5`。
- 行式设置项：`flex items-center justify-between`（左标签 `text-sm text-gray-600 dark:text-gray-300` + 右控件），下附说明 `text-xs text-gray-500`。

### 4.17 遮罩编辑器（MaskEditorModal）

- 画笔颜色：`#fff`（画布内 `fillStyle/strokeStyle`）。
- 工具栏：浮动条 `bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md rounded-2xl shadow-2xl border`，工具切换（画笔/橡皮）用 segmented 样式（选中 `bg-white shadow-sm text-blue-500`）。
- 画笔大小滑块：垂直滑动条，thumb `bg-blue-500 rounded-full shadow-md`。
- 深色模式使用 iOS 风格深灰（`#323338`、`#232325`、`#8a8a8e`、`#e0e0e0`）进行高对比。

### 4.18 Agent 工作区（AgentWorkspace）

- 布局：左侧对话侧栏（`lg:` 断点可折叠）+ 中央消息流 + 底部复用输入栏。
- 侧栏：对话项 `rounded px-2 py-1`，激活 `font-semibold`；搜索框 `rounded-xl border bg-gray-100/80 focus:border-blue-400 focus:bg-white`。
- 消息：用户/Agent 标识 `text-blue-600 dark:text-blue-400 font-semibold`；正文 `text-[15px] leading-relaxed text-gray-800 dark:text-gray-100`。
- 图片卡片：`rounded-xl bg-gray-50/50 dark:bg-white/[0.02] border-dashed`（占位）；`@图片` 引用胶囊 `bg-blue-100/50 text-blue-700 rounded-md px-1.5 py-0.5 text-xs`。
- 每轮操作按钮沿用图标按钮规范（复制/重新生成=蓝、收藏=黄、下载=绿、删除=红）。

---

## 5. 动效规范（Motion）

定义于 `src/index.css`。全部缓动优先 `cubic-bezier(0.16, 1, 0.3, 1)`（退出快、弹性收尾的「舒适」曲线）。

| 动画类                        | 时长/曲线                          | 应用                                                        |
| ----------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `animate-overlay-in`          | 0.2s ease-out                      | 弹窗遮罩淡入                                                |
| `animate-modal-in`            | 0.25s `cubic-bezier(0.16,1,0.3,1)` | 弹窗面板 `scale(0.95)+translateY(10px)` 弹入                |
| `animate-slide-down-in`       | 0.25s                              | 设置面板自上滑入                                            |
| `animate-confirm-in`          | 0.2s                               | 确认框 `scale(0.92)+translateY(16px)`                       |
| `animate-fade-in`             | 0.2s ease-out                      | Lightbox 淡入                                               |
| `animate-zoom-in`             | 0.25s                              | Lightbox 图片 `scale(0.9→1)`                                |
| `animate-dropdown-down/up`    | 0.15s                              | 下拉菜单展开（`scaleY(0.9)`，`transform-origin` 顶部/底部） |
| `toast-enter`                 | 0.3s                               | Toast 自下上浮（`translate(-50%,16px→0)`）                  |
| `pulse-border`                | 无限                               | 运行中卡片边框脉冲                                          |
| `agent-web-search-text-sweep` | 2.5s linear                        | Agent 联网搜索文本流光（文字渐隐扫描）                      |
| `.collapse-section`           | 0.25s ease-out                     | 移动端折叠区域（`grid-template-rows 0fr/1fr`）              |

交互态动效习惯：`transition-colors`（图标/文本色）、`transition-all duration-200`（按钮/卡片）、`transition-transform duration-200`（chevron 旋转、active:scale）、`active:scale-95/98`（按压反馈）。

无障碍：`@media (prefers-reduced-motion: reduce)` 下禁用扫描动画并退化为静态色（见 `.agent-web-search-running-text`）。

---

## 6. 响应式与移动端规范

- 断点：`sm:640`、`md:768`、`lg:1024`。
- 核心响应规则：
  - 任务网格 `1 → 2(sm) → 3(lg)`
  - 模式切换分段控件：桌面 header 内（`hidden sm:flex`），移动端独立第二行
  - 输入栏：桌面参数 6 列 + 方形按钮；移动端 2 列 + 通栏按钮 + 折叠拖拽条
  - 设置弹窗：桌面左导航竖排，移动顶导航横排（`flex sm:flex-col`）
  - 详情弹窗：桌面左右分栏（`md:flex-row`），移动上下堆叠
- 安全区：`--safe-area-*` 变量 + `.safe-area-x`（`max(1rem, var(--safe-area-left/right))`）、`.safe-area-top`（`var(--safe-area-top)`，小屏 `max(0.5rem, …)`）。
- 移动端：禁用下拉刷新（`overscroll-behavior-y: contain`，仅 agent 模式小屏）、`viewport-fit=cover`、`user-scalable=no`。
- 输入控件移动端字号强制 16px。
- `body { -webkit-user-select: none }` 防误选，输入类与 `[data-selectable-text]` 恢复选字。

---

## 7. 交互与无障碍细节

- 键盘：弹窗 Esc 关闭；Lightbox 方向键切换；Ctrl/⌘+点击多选任务；Ctrl/⌘+滚轮选区滚动提示。
- 触屏：任务卡水平侧滑多选（40px 阈值）；输入栏长按/触屏拖拽；Select 长按查看值、触摸拖拽排序（含滚动容器边缘自动滚动）。
- 桌面：空白拖拽框选（`bg-blue-500/20 border-blue-500/50` 选区框）+ 拖拽自动滚动 + 边缘滚动提示 Toast。
- 焦点：输入框 `focus:ring-2 focus:ring-blue-500/30`；按钮均有 `aria-label`。
- 图片：`img { -webkit-user-drag:none }` 防拖拽；`.saveable-image` 恢复保存手势。
- 滚动条：全局 `::-webkit-scrollbar { width:8px }`，thumb 圆角 `#cbd5e1`（深色 `#3f3f46`）；`.custom-scrollbar`/`.hide-scrollbar` 工具类。
- 溢出裁剪：`.mask-edge-r` 右侧渐变遮罩（横向标签条）；`.ios-rounded-scroll-fix` 修复 iOS 圆角滚动溢出。
- 长文本省略：`.truncate`、`line-clamp-3`、`break-words`、`overflow-wrap:anywhere`。

---

## 8. Markdown 渲染规范

`.markdown-renderer`（配合 streamdown）：

- 段落/列表间距 `0.65rem`；标题 `font-weight:700; line-height:1.35`，h1/h2/h3 字号 `1.35/1.2/1.08em`。
- 引用块：`border-left:3px solid rgba(59,130,246,0.45)` + 左 padding `0.85rem`，文字灰。
- 链接：`#2563eb`（深色 `#60a5fa`）带下划线。
- 行内代码：`bg rgba(113,113,122,0.12)` 圆角 `0.35rem`，等宽字体。
- 表格：`border:1px solid #e4e4e7`，th 弱灰底；深色模式对应半透明白。
- 图片：`max-width:100%; border-radius:0.75rem`。

---

## 9. 实现约定摘要（给开发者）

1. **新增任何浮层**：套用「浮动表面通用配方」（§2.5）+ 对应入场动画（§5）。
2. **按钮**：先判断语义（主/次/图标），复用 §4.1 类名模板。
3. **颜色**：默认走 `blue-500` 体系；深色永远补 `dark:` 覆盖。
4. **圆角**：按钮/输入/卡片 `rounded-xl`；弹窗 `rounded-3xl`；胶囊 `rounded-full`。
5. **图标**：统一手写内联 SVG，`fill="none" stroke="currentColor" strokeWidth={2}` + `strokeLinecap/Linejoin=round`，尺寸 `w-4/5 h-4/5`，颜色继承 `currentColor`。
6. **触屏与桌面**：为移动端补充侧滑/长按/折叠交互；用 `sm:` 断点切桌面布局。
7. **文本选字**：除可编辑/可选择内容外保持 `user-select:none`。
8. **Z-index**：遵循 §2.8 层级表，避免随意拔高。

---

## 10. 附：设计令牌速查表（Copy-Paste 参考）

```
背景色:  bg-white dark:bg-gray-900
浮层:    bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl
文字:    text-gray-700 dark:text-gray-300   次要 text-gray-400 dark:text-gray-500
主按钮:  bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-sm
描边:    border border-gray-200 dark:border-white/[0.08]
主选中:  bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400
边框默认: border-gray-200 dark:border-white/[0.08]
圆角:    rounded-xl (控件) / rounded-3xl (弹窗) / rounded-full (胶囊)
阴影:    shadow-[0_8px_30px_rgb(0,0,0,0.12)] (浮层)
蒙层:    bg-black/20 dark:bg-black/40 backdrop-blur-md
图标:    w-5 h-5 text-gray-600 dark:text-gray-400 hover:text-gray-800
Hover底: hover:bg-gray-100 dark:hover:bg-white/[0.04]
焦点:    focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400
等宽:    font-mono
```
