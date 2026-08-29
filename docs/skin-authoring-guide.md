# 皮肤（Skin）生成规范

> 适用范围：本规范指导如何**新增一套可切换的视觉皮肤**，支持从「只换配色」到「换字体 + 圆角 + 阴影 + 组件描边风格」的完整范围。
> 当前仓库示例：`src/theme/styles/skins/handdrawn.css`（手绘风格，全套重塑）；`src/theme/styles/skins/_template.css`（最小骨架）。

---

## 1. 架构与原理（必须先读）

皮肤系统由两层组成，**皮肤文件只做"覆盖"，不改任何 JS / JSX**：

### 1.1 运行时机制（唯一真理来源）

- `src/theme/appearance.ts` 的 `applyAppearance()` 在切换皮肤时向 `<html>` 写入 `data-skin="<id>"` 与 `dark` class，**仅此一处**会写外观状态。
- `src/theme/styles/skins.css` 是皮肤样式入口，在 `src/main.tsx` 中**最后**被导入（晚于 `index.css` 与 `design-system/styles.css`），因此皮肤规则的优先级高于默认与遗留样式。
- `src/theme/registry.ts` 的 `SKIN_REGISTRY` 是皮肤元数据的**单一来源**。新增皮肤只需在此加一项，顶栏配色切换器与设置页预设列表会**自动**出现该皮肤，无需改动任何组件。

### 1.2 作用域约定

- 每套皮肤一个文件：`src/theme/styles/skins/<id>.css`
- 浅色作用域：`:root[data-skin='<id>']`
- 深色作用域：`:root[data-skin='<id>'].dark`
- 直接覆盖组件样式的规则也一律以 `:root[data-skin='<id>'] <选择器>` 前缀限定。

> ⚠️ 重要：`src/design-system/styles.css` 与 `src/index.css` 中存在大量 `:root[data-color-scheme="..."]` 块，它们是**历史遗留**，运行时并不被 `applyAppearance` 激活（不会写 `data-color-scheme`）。**新皮肤一律走 `data-skin` 机制，不要往 `data-color-scheme` 块里加内容。**

### 1.3 两套 Token 桥

为了让"非设计系统组件"（顶栏、画廊、侧边栏、策略树等用 Tailwind 工具类的旧组件）也能跟着换肤，皮肤文件需同时覆盖两层变量：

1. **设计系统 Token**：`--ds-color-*` / `--ds-radius-*` / `--ds-shadow-*` / `--ds-font-*`，被 `.ds-*` 组件消费。
2. **shadcn 兼容桥**：`--background / --foreground / --muted / --muted-foreground / --border / --input / --primary / --primary-foreground / --sidebar / --sidebar-foreground`，被 Tailwind 工具类（`bg-background`、`text-foreground`、`border-border` 等）消费。
3. **品牌色板桥**：`--skin-blue-50 … --skin-blue-950`。`src/index.css` 中 `.doupao-side-panel .bg-blue-*` 等会映射到这些变量，覆盖它们可让旧组件的蓝色工具类跟随主色（参考手绘皮肤把 `blue-*` 全部染成蜡笔橙）。

---

## 2. 新增皮肤三步流程（SOP）

```text
1. 复制模板
   cp src/theme/styles/skins/_template.css src/theme/styles/skins/<id>.css

2. 在 src/theme/styles/skins.css 追加一行 @import
   @import './skins/<id>.css';

3. 在 src/theme/registry.ts 的 SKIN_REGISTRY 增加一项
   <id>: {
     label: '名称',
     description: '一句话风格说明',
     swatch: 'hsl(...)'     // 紧凑色板圆点主色
     preview: 'linear-gradient(...)'  // 设置页预设卡片渐变
     order: 90,             // 显示顺序，数值越大越靠后
   },
```

完成以上三步后，`npx tsc -b` 与 `npm run build` 应通过，`<id>` 自动进入顶栏切换器与设置页。皮肤 ID 由 `keyof typeof SKIN_REGISTRY` 自动推导，**无需手写联合类型**。

---

## 3. 可覆盖 Token 速查表

所有 Token 在 `src/design-system/styles.css` 的 `:root` 与 `.dark` 块中有完整默认值。皮肤只需覆盖你想改的项。

### 3.1 字体（"真正的皮肤"必备）
| Token | 作用 | 说明 |
| --- | --- | --- |
| `--font-ui-sans` | **全局中英文主体字体** | `tailwind.config.js` 中 `font-sans` 即引用它，覆盖后全站生效 |
| `--font-mono` | 等宽字体（代码块等） | |
| `--ds-font-sans` | 设计系统组件字体（镜映 `--font-ui-sans`） | 与 `--font-ui-sans` 同步覆盖 |
| `--ds-font-size-xs/sm/md/lg/xl/2xl` | 字号阶梯 | `md` 为基准正文 |
| `--ds-line-height-tight/normal/relaxed` | 行高阶梯 | 手绘皮肤调大以获得书写感 |
| `--ds-font-weight-regular/medium/semibold/bold` | 字重阶梯 | |

> 字体必须离线可用：优先使用系统字体栈；确需自定义字体时，将裁剪后的 WOFF2 随应用打包，并用 `@font-face` + `font-display: swap` 加载。皮肤 CSS 禁止远程 `@import url(...)`，避免离线失败、供应链变化和首次渲染阻塞。

### 3.2 圆角
| Token | 默认 | 用途 |
| --- | --- | --- |
| `--ds-radius-sm / md / lg / xl / 2xl / full` | `0.375→1.5rem / 9999px` | 各类组件圆角；手绘皮肤改为 8 值抖动边框（`255px 15px 225px 15px / 15px 225px 15px 255px`） |
| 自定义 `--ds-radius-sketch*` | — | 可在皮肤内新增专属圆角 Token 供组件覆盖使用 |

### 3.3 阴影
| Token | 默认 | 用途 |
| --- | --- | --- |
| `--ds-shadow-sm / md / lg` | 模糊投影 | 手绘皮肤去掉模糊、改为硬边偏移（马克笔/蜡笔落影） |
| `--ds-shadow-focus` | 焦点环 | 聚焦描边 |

### 3.4 颜色（语义 Token）
| 分组 | Token |
| --- | --- |
| 中性/表面 | `--ds-color-canvas` `--ds-color-surface` `--ds-color-surface-subtle` `--ds-color-surface-raised` |
| 文字 | `--ds-color-text` `--ds-color-text-muted` `--ds-color-text-subtle` `--ds-color-text-inverse` |
| 描边 | `--ds-color-border` `--ds-color-border-strong` |
| 主色 | `--ds-color-primary` `--ds-color-primary-hover` `--ds-color-primary-subtle` `--ds-color-primary-gradient`（线性渐变，主按钮背景）`--ds-color-focus` |
| 语义状态 | `--ds-color-success[-hover/-subtle]` `--ds-color-warning[-subtle]` `--ds-color-danger[-hover/-subtle]` `--ds-color-info[-subtle]` |
| 选择态 | `--ds-color-selection-surface` `--ds-color-selection-border` `--ds-color-selection-text` |
| 遮罩 | `--ds-color-scrim` |

### 3.5 shadcn 兼容桥（旧组件用）
`--background --foreground --muted --muted-foreground --border --input --primary --primary-foreground --sidebar --sidebar-foreground`
深色块需同步覆盖对应的 `--background/--foreground/--border/--input/--primary/--sidebar` 等。

### 3.6 品牌色板桥
`--skin-blue-50 … --skin-blue-950`（按主色 H/S 推导明度阶梯）。侧边栏等旧组件的 `bg-blue-*` 工具类经 `index.css` 映射到这套变量。

---

## 4. "真正的皮肤"配方（不止换配色）

要做到字体 + 圆角 + 阴影 + 组件描边风格整体改变，在标准 Token 覆盖之外，还需在皮肤文件里**直接写组件覆盖规则**（前缀 `:root[data-skin='<id>']`）。以下为经过验证的可用选择器清单：

### 4.1 卡片/浮层类（统一描边 + 圆角 + 硬阴影）
```css
:root[data-skin='<id>'] .ds-card,
:root[data-skin='<id>'] .ds-surface,
:root[data-skin='<id>'] .ds-panel,
:root[data-skin='<id>'] .ds-dialog,
:root[data-skin='<id>'] .ds-popover,
:root[data-skin='<id>'] .ds-menu,
:root[data-skin='<id>'] .ds-toast,
:root[data-skin='<id>'] .ds-tooltip__content,
:root[data-skin='<id>'] .ds-table-container,
:root[data-skin='<id>'] .ds-code-block,
:root[data-skin='<id>'] .ds-fieldset {
  border-radius: var(--ds-radius-sketch);   /* 自定义圆角 */
  border: 2px solid hsl(var(--ds-color-ink)); /* 自定义描边色（可新增 --ds-color-ink） */
  box-shadow: 3px 4px 0 hsl(var(--ds-color-ink) / 0.16); /* 硬边阴影 */
}
:root[data-skin='<id>'] .ds-surface--raised {
  box-shadow: 4px 5px 0 hsl(var(--ds-color-ink) / 0.18);
}
```

### 4.2 控件类（按钮/输入/选择/芯片）
```css
:root[data-skin='<id>'] .ds-button,
:root[data-skin='<id>'] .ds-icon-button,
:root[data-skin='<id>'] .ds-input,
:root[data-skin='<id>'] .ds-textarea,
:root[data-skin='<id>'] .ds-select__control,
:root[data-skin='<id>'] .ds-search,
:root[data-skin='<id>'] .ds-segmented,
:root[data-skin='<id>'] .ds-chip,
:root[data-skin='<id>'] .ds-badge,
:root[data-skin='<id>'] .ds-stepper {
  border-radius: var(--ds-radius-sketch-sm);
  border: 2px solid hsl(var(--ds-color-ink) / 0.85);
}
/* 主按钮填充主色 + 描边 */
:root[data-skin='<id>'] .ds-button--primary {
  background: hsl(var(--ds-color-primary));
  color: hsl(var(--ds-color-text-inverse));
  border-color: hsl(var(--ds-color-ink));
  box-shadow: 2px 3px 0 hsl(var(--ds-color-ink) / 0.22);
}
```

### 4.3 细节修饰（可选）
```css
/* 聚焦：墨色描边 */
:root[data-skin='<id>'] .ds-input:focus-visible,
:root[data-skin='<id>'] .ds-textarea:focus-visible,
:root[data-skin='<id>'] .ds-select__control:focus-visible {
  border-color: hsl(var(--ds-color-ink));
  outline: 2px solid hsl(var(--ds-color-focus));
  outline-offset: 2px;
}
/* 分割线虚线 */
:root[data-skin='<id>'] .ds-divider--horizontal {
  border-top-style: dashed;
  border-top-color: hsl(var(--ds-color-ink) / 0.45);
}
/* 标签页下划线色 */
:root[data-skin='<id>'] .ds-tabs__item::after { background: hsl(var(--ds-color-ink)); }
/* 选中缩略图描边 */
:root[data-skin='<id>'] .ds-thumbnail--selected {
  box-shadow: 0 0 0 2px hsl(var(--ds-color-surface)), 0 0 0 4px hsl(var(--ds-color-ink));
}
/* Markdown 引用块墨线 */
:root[data-skin='<id>'] .markdown-renderer :where(blockquote) {
  border-left: 3px solid hsl(var(--ds-color-ink));
  color: hsl(var(--ds-color-text-muted));
}
/* 纸张/纹理背景（作用于 body） */
:root[data-skin='<id>'] body {
  background-color: hsl(var(--ds-color-canvas));
  background-image: radial-gradient(hsl(var(--ds-color-ink) / 0.05) 1px, transparent 1px);
  background-size: 22px 22px;
}
```

### 4.4 历史工具类兼容桥（仅迁移期）

`.ds-*` 组件会消费 Token，但 App 主框架（头部 / 侧栏 / 画廊 / 策略树 / composer 等）大量使用**写死的 Tailwind 中性与蓝色工具类**（`bg-white`、`bg-gray-*`、`text-gray-*`、`border-gray-*`、`bg-blue-*`、`ring-blue-*` 以及对应的 `dark:*` 变体）。这些**不消费任何 Token**——如果只覆盖 §3 的 Token，会出现"卡片换了、大背景没换"的割裂感（这也是早期几套皮肤被反馈"不协调"的根因）。

当前兼容方式（完整实现见 `src/theme/styles/skins.css` 的全局重映射段，已覆盖现有四套自定义皮肤）：在皮肤作用域内把既有高频工具类重定向到**本皮肤**的 Token。它是迁移桥，不是新增皮肤时继续复制扩张的目标架构：

```css
/* 仅作用域于新皮肤，不影响 default 等其它皮肤 */
:is(:root[data-skin='<id>']) :is(.bg-white, .bg-gray-50, .bg-gray-100) {
  background-color: var(--ds-color-surface);
}
:is(:root[data-skin='<id>']) :is(.text-gray-900, .text-gray-700, .text-gray-600) {
  color: var(--ds-color-text);
}
:is(:root[data-skin='<id>']) :is(.bg-blue-500, .bg-blue-600) {
  background-color: var(--ds-color-primary);
}
/* 深色变体：作用域加 .dark，且类名用 \: 转义（dark: → .dark\:bg-gray-900） */
:is(:root[data-skin='<id>'].dark) :is(.dark\:bg-gray-900, .dark\:bg-gray-950) {
  background-color: var(--ds-color-scrim);
}
```

要点：
- 选择器特异性（`:root + [data-skin] + 类` ≈ 0,3,0）高于 Tailwind 单类工具类，**无需 `!important`**。
- `dark:` 变体编译为 `.dark\:bg-gray-900`，选择器里需用 `\:` 转义 `:`；作用域前缀加 `.dark`。
- Ring 颜色覆盖写 `--tw-ring-color`（不要写 `box-shadow`）。
- `hover:` / `focus:` 变体同理用 `\:` 转义，并加 `:hover` / `:focus` 伪类。
- 该映射只用于尚未迁移的旧组件；新代码必须直接消费 `--ds-color-*` 或 `.ds-*` 组件，不再扩充每套皮肤的工具类选择器清单。
- 玻璃皮肤的常用工具类只允许映射为半透明背景，禁止给 `.bg-white`、卡片列表或通配选择器批量添加 `backdrop-filter`。模糊只用于明确命名的关键浮层和固定导航。
- 旧组件若遗漏透明度或伪类变体，应在迁移该组件时改用语义 Token；只有无法立即迁移的发布阻断项才补兼容选择器，并记录后续删除点。
- **圆角也要跟随皮肤**：提示词输入框、卡片等用 `rounded-2xl / rounded-xl / rounded-lg / rounded-md`，默认圆角与像素（直角）或复古（小圆角）皮肤冲突。在重映射段加：` .rounded-2xl { border-radius: var(--ds-radius-xl) }` 等（不要动 `.rounded-full`，避免头像变方，除非该皮肤有意如此）。
- **图标色类也要覆盖**：图标用 `currentColor` 着色，颜色由 `text-*` 决定。除 `text-gray-*` / `text-blue-*` 外，常见还有 `text-slate-*` / `text-zinc-*` / `text-neutral-*`，必须把它们一并映射到 `--ds-color-text / -muted / -subtle`（深色 `dark:text-*` 变体同理），否则这些图标不会跟随皮肤（详见 §4.5）。

> 经验：换肤后若某块界面"没变"，先用开发者工具看它的真实类名，多半是漏了 `/opacity` 或 `focus-within:` / `hover:` / `dark:` 这类**带修饰符的变体类**。
- 该段应**只作用域于你要做"真皮肤"的新皮肤**（用 `:is(:root[data-skin='<id>'], ...)` 列举），避免改动默认及其它既有皮肤外观。

> 提示：皮肤里可**新增私有 Token**（如手绘皮肤的 `--ds-color-ink`、`--ds-radius-sketch`、`--ds-radius-sketch-sm`），它们只在当前皮肤作用域内有效，不影响其他皮肤。

### 4.5 图标跟随皮肤（硬性要求，见 §6.8）

图标默认 `currentColor` 着色，颜色由父级 `text-*` 决定。现有旧组件由 §4.4 的映射让图标常用着色类跟随皮肤；新组件应直接使用语义文字类或 Token：

```css
/* 图标灰阶 → 皮肤文字层级（浅色），按明暗档位映射到 -text / -muted / -subtle */
:is(:root[data-skin='<id>']) :is(.text-gray-700, .text-gray-500, .text-gray-400,
    .text-slate-700, .text-slate-500, .text-slate-400,
    .text-zinc-700, .text-zinc-500, .text-zinc-400,
    .text-neutral-700, .text-neutral-500, .text-neutral-400) {
  color: var(--ds-color-text);
}
/* 品牌色图标 → 主色 */
:is(:root[data-skin='<id>']) :is(.text-blue-500, .text-blue-600) { color: var(--ds-color-primary); }
/* 深色镜像同理：dark:text-slate-900 等也重定向为亮文字，避免深底深字 */
```

- 图标灰阶类（`slate / zinc / neutral` 与 `gray`）**都要覆盖**，否则部分图标仍是默认灰、不跟随皮肤。
- 若某皮肤需要**独特图标造型**（如手绘涂鸦线、像素方块），在皮肤作用域内用专属类或图标组件覆盖，不要改动 `src/design-system/icons.tsx` 图标库源码。
- 语义图标（成功 / 警告 / 危险 / 信息 / 品牌点）应绑定 `--ds-color-success/-warning/-danger/-info/-primary`，而非固定 `#xxx`。

---

## 5. 完整骨架（最小可运行皮肤）

```css
/* src/theme/styles/skins/<id>.css */
/* 可选：使用随应用打包的 WOFF2；也可以直接使用系统字体栈。 */
/* @font-face { font-family: 'YourFont'; src: url('../../../assets/fonts/your-font.woff2') format('woff2'); font-display: swap; } */

:root[data-skin='<id>'] {
  /* 3.5 shadcn 兼容桥（浅色） */
  --background: 0 0% 100%;
  --foreground: 0 0% 10%;
  --muted: 0 0% 95%;
  --muted-foreground: 0 0% 40%;
  --border: 0 0% 88%;
  --input: 0 0% 88%;
  --primary: 220 80% 50%;
  --primary-foreground: 0 0% 100%;
  --sidebar: 0 0% 97%;
  --sidebar-foreground: 0 0% 10%;

  /* 品牌色板桥 */
  --skin-blue-500: 220 80% 50%;
  /* … -50 … -950 按主色 H/S 推导明度阶梯 */

  /* 3.4 设计系统颜色 Token */
  --ds-color-canvas: 0 0% 100%;
  --ds-color-surface: 0 0% 99%;
  --ds-color-surface-subtle: 0 0% 95%;
  --ds-color-surface-raised: 0 0% 100%;
  --ds-color-text: 0 0% 10%;
  --ds-color-text-muted: 0 0% 40%;
  --ds-color-text-subtle: 0 0% 52%;
  --ds-color-text-inverse: 0 0% 100%;
  --ds-color-border: 0 0% 88%;
  --ds-color-border-strong: 0 0% 74%;
  --ds-color-primary: 220 80% 50%;
  --ds-color-primary-hover: 220 80% 42%;
  --ds-color-primary-subtle: 220 80% 95%;
  --ds-color-primary-gradient: linear-gradient(180deg, hsl(220 80% 56%) 0%, hsl(220 80% 46%) 100%);
  --ds-color-focus: 220 80% 50%;
  --ds-color-success: 142 71% 45%;  --ds-color-success-subtle: 142 45% 95%;
  --ds-color-warning: 36 100% 50%;  --ds-color-warning-subtle: 38 60% 95%;
  --ds-color-danger: 1 100% 59%;    --ds-color-danger-hover: 1 100% 64%;  --ds-color-danger-subtle: 1 60% 96%;
  --ds-color-info: 199 95% 62%;     --ds-color-info-subtle: 199 60% 95%;
  --ds-color-selection-surface: 220 80% 95%;
  --ds-color-selection-border: 220 55% 80%;
  --ds-color-selection-text: 0 0% 10%;
  --ds-color-scrim: 220 12% 8%;

  /* 3.1 字体（"真皮肤"才需要） */
  /* --font-ui-sans: 'YourFont', sans-serif; */
  /* --ds-font-sans: var(--font-ui-sans); */

  /* 3.2 / 3.3 圆角与阴影（"真皮肤"才需要） */
  /* --ds-radius-md: 14px; --ds-shadow-md: 3px 4px 0 rgba(0,0,0,.16); */
}

:root[data-skin='<id>'].dark {
  /* 浅色块的深色镜像：background/foreground/border/input/primary/sidebar
     以及所有 --ds-color-*、--skin-blue-*（仅深色用到的几个即可） */
  --background: 0 0% 8%;
  --foreground: 0 0% 95%;
  --border: 0 0% 21%;
  --input: 0 0% 21%;
  --primary: 220 80% 60%;
  --sidebar: 0 0% 12%;
  --sidebar-foreground: 0 0% 95%;
  --skin-blue-500: 220 80% 60%;
  --ds-color-canvas: 0 0% 8%;
  --ds-color-surface: 0 0% 12%;
  --ds-color-surface-subtle: 0 0% 15%;
  --ds-color-surface-raised: 0 0% 14%;
  --ds-color-text: 0 0% 95%;
  --ds-color-text-muted: 0 0% 68%;
  --ds-color-text-subtle: 0 0% 56%;
  --ds-color-text-inverse: 0 0% 12%;
  --ds-color-border: 0 0% 21%;
  --ds-color-border-strong: 0 0% 34%;
  --ds-color-primary: 220 80% 60%;
  --ds-color-primary-hover: 220 80% 66%;
  --ds-color-primary-subtle: 220 80% 20%;
  --ds-color-primary-gradient: linear-gradient(180deg, hsl(220 80% 64%) 0%, hsl(220 80% 54%) 100%);
  --ds-color-focus: 220 80% 60%;
  --ds-color-success: 142 73% 47%;  --ds-color-success-subtle: 142 40% 22%;
  --ds-color-warning: 54 100% 52%;  --ds-color-warning-subtle: 54 50% 22%;
  --ds-color-danger: 1 100% 60%;    --ds-color-danger-hover: 1 100% 66%;  --ds-color-danger-subtle: 1 50% 24%;
  --ds-color-info: 199 100% 68%;    --ds-color-info-subtle: 199 55% 22%;
  --ds-color-selection-surface: 220 80% 20%;
  --ds-color-selection-border: 220 60% 42%;
  --ds-color-selection-text: 0 0% 93%;
}
```

> 完整范例见 `src/theme/styles/skins/_template.css`（标准配色骨架）与 `src/theme/styles/skins/handdrawn.css`（全套风格重塑，含离线字体栈、私有 Token、组件描边规则）。

---

## 6. 硬性约束与常见坑

1. **禁止覆盖布局 Token**：`--ds-space-*`、`--ds-control-*`、`--ds-content-*`、`--ds-z-*`、`--safe-area-*`、`--app-header-offset`、`--app-docked-*`、`--workspace-tabbar-*`、`--word-library-*`、`--agent-sidebar-*`。皮肤只改视觉，不动尺寸与布局。
2. **必须同时写浅色与深色块**：若只写 `:root[data-skin='<id>']` 而漏掉 `.dark`，深色模式下这些 Token 会回退到默认皮肤，出现"浅色正常、深色错乱"。
3. **作用域前缀不能省**：组件覆盖规则必须以 `:root[data-skin='<id>']` 为前缀，否则会变成全局样式污染其他皮肤。
4. **不要动 `data-color-scheme` 遗留块**：那是历史实现，运行时不激活。
5. **shadcn 桥与品牌色板桥要一起覆盖**：只覆盖 `--ds-color-*` 会导致旧组件（顶栏、侧边栏、画廊）不变色；至少把 `--background/--foreground/--border/--primary/--sidebar` 与 `--skin-blue-500/600` 一并覆盖。
6. **主按钮背景**：默认 `.ds-button--primary` 用 `--ds-color-primary` 纯色；若想用渐变，覆盖 `--ds-button-primary-background` 或在皮肤里直接写 `.ds-button--primary { background: var(--ds-color-primary-gradient) }`（参考 `design-system/styles.css` 中其他皮肤的做法）。
7. **字体必须离线可靠**：禁止远程字体 `@import` 和运行时 CDN 注入；使用系统字体栈，或随应用打包的 WOFF2 + `font-display: swap`。
8. **图标必须跟随皮肤**：图标（lucide / 自定义 SVG）默认以 `currentColor` 着色，颜色取决于所在元素的 `text-*` 类。禁止在皮肤上让图标保持硬编码的固定灰 / 蓝色——必须在全局重映射段（§4.4 / §4.5）把图标常用着色类重定向到皮肤 Token：至少覆盖 `text-gray-*`、`text-slate-*`、`text-zinc-*`、`text-neutral-*`（含深色 `dark:text-*` 变体）映射到 `--ds-color-text / -muted / -subtle`，`text-blue-*` 映射到 `--ds-color-primary`。语义图标（成功绿、警告黄、危险红、品牌点）应绑定 `--ds-color-success/-warning/-danger/-primary` 等语义 Token，不要写死具体色值。皮肤需要独特图标造型时，在皮肤作用域内用专属类覆盖，不要改图标库源码。
9. **强制可读性对比度（禁止浅底浅字 / 深底深字）**：文字与背景必须成对选取。普通文字（包括次要文字、占位符和小号标签）≥ 4.5:1；大号文字 ≥ 3:1；焦点环和关键控件边界 ≥ 3:1。配对铁律：
   - `--ds-color-text`（深）只能配 `--ds-color-canvas / -surface / -surface-subtle / -surface-raised`（浅）；
   - `--ds-color-text-inverse`（浅）只能配主色或深色块（`--ds-color-primary`、`--ds-color-scrim`、深色 sidebar）；
   - `--ds-color-text-muted` 仅用于次要文字，但仍须在其背景上达到 ≥ 4.5:1；
   - `--ds-color-text-subtle` **不得用于正文**，只用于禁用态 / 极次要装饰；
   - 深色块（`.dark`）必须做镜像校验：把浅色下的「深字 on 浅底」替换为「亮字 on 深底」，严禁出现亮背景配亮字、深背景配深字；
   - 提交前用对比度检查器（或浏览器 DevTools 颜色对比）抽测 body 正文、次要文字、主按钮文字三处。
10. **必须作用于全局，覆盖弹窗 / 侧边栏 / 按钮**：皮肤不是「只换卡片背景」。必须覆盖到顶栏、侧边栏、浮层、弹窗和全部按钮。新组件优先使用语义 Token 与 `.ds-*`；旧组件可由 §4.4 的兼容桥临时承接。须实测浅色 / 深色两种模式，打开对话框、下拉、侧栏、点按主按钮均无「未换肤」的残留白块 / 蓝边 / 默认字色。
11. **玻璃效果有合成预算**：禁止全屏动画模糊层、常用工具类模糊和 `[data-exporting] *` 之类通配降级。仅在明确列出的关键浮层与固定导航上使用低强度模糊，并在导出时按同一选择器范围关闭。
12. **命名不承诺未经验证的功效**：皮肤名称描述视觉特征，不使用「护眼」「减少疲劳」等健康功效表述，除非有相应测试与证据。

---

## 7. 验证清单

```bash
# 1. 类型与构建
npx tsc -b
npm run build

# 2. 运行皮肤契约（注册/导入同步、禁止布局 Token、对比度与玻璃性能预算）
npm test -- src/theme/skinContract.test.ts

# 3. 确认皮肤已进入产物 CSS（应包含 data-skin='<id>' 与关键 Token）
$f = (Get-ChildItem -Recurse -Path dist -Filter "*.css" | Where-Object { $_.Length -gt 50KB } | Select-Object -First 1).FullName
Select-String -Path $f -Pattern "data-skin='<id>'" | Select-Object -First 3

# 4. 本地预览（Dev 服务器会自动热更新；新增 CSS 文件建议刷新一次页面）
npm run dev
# 打开 ?design-system=1 可进入设计系统预览页核对组件观感
```

切换验证：顶栏「配色」按钮循环切换，或在设置页选择新皮肤；同时测试**浅色 / 深色**两种模式，确认配色、字体、圆角、描边、阴影均生效且无明显错位。

---

## 8. 一句话总结

> 换配色 = 只覆盖 `§3.4/§3.5/§3.6` 的 Token；**真正的皮肤** = 在上述基础上再覆盖 `§3.1 字体` + `§3.2 圆角` + `§3.3 阴影` + `§4 组件描边规则`，并把离线字体栈与私有 Token 写进皮肤文件。三步注册（`_template.css` → `skins.css @import` → `registry.ts`）后自动接入切换器。
