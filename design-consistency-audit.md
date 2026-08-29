# DOUPAO 设计一致性审计报告

> 审计日期：本次会话
> 审计范围：`src/` 业务代码（271 个 .tsx/.ts 文件，103,315 行），排除 `design-system/`、`theme/`、测试文件
> 审计方法：脚本 `scripts/audit-design-consistency.mjs`（只读，复用 `migrate-legacy-tokens.mjs` 的迁移规则）
> 审计目的：为"界面看起来杂乱"定位根因，而不是替换设计系统（当前设计系统本身已成熟，见 §6）

---

## 0. 执行摘要（TL;DR）

| 维度         | 真实状态                                                                                                    | 结论                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| 新旧组件风格 | **旧类迁移已完成**（业务代码 0 处可迁移旧类，ds-* 使用 8364 处）                                            | ✅ 不是问题根源         |
| 图标系统     | **源已统一**到 `design-system/icons.tsx`（lucide 包装）；但 16 个文件仍含 **120 处手写内联 `<svg>`**        | ⚠️ 中等，集中在老组件   |
| 控件高度     | **`--ds-control-sm/md/lg` 尺度 Token 已定义但几乎没人用**；48 个文件散用 `h-7~h-16`、`min-h-*` 共 17 种高度 | 🔴 高度不统一的真实根源 |
| 配色         | hex 84 处（多在数据/工具库，属"持久化用户调色板"，已豁免）；`text-white` 88 处（反色文字，设计如此）        | ⚠️ 低–中，个别残留      |
| 圆角/间距    | 已迁移到 `rounded-ds-*` / `--ds-space-*`                                                                    | ✅ 基本一致             |

**一句话结论：DOUPAO 的"杂乱"主要不是类名体系问题（那层已经很干净），而是「尺寸尺度 Token 存在但业务代码没消费」导致的控件高度/密度不一致，加上少数老组件残留的手写 SVG 图标。** 这不是需要"替换设计系统"的问题，而是需要"让业务代码用上已有 Token"的收敛问题。

---

## 1. 维度 A：新旧组件风格（✅ 已基本统一）

### 1.1 数据

- 可迁移旧类（`bg-white`/`text-gray-*`/`rounded-xl`/`bg-blue-*` 等，按 `migrate-legacy-tokens.mjs` 规则判定）：**0 处**
- 已使用的 `ds-*` 语义 Token：**8,364 处**
- `src/components/` 下实测：**0 处** `bg-white`、`text-gray-*`、`border-gray-*`、`rounded-xl/2xl/3xl`

### 1.2 判断

旧类 → Token 的迁移（`migrate-legacy-tokens.mjs`）**已经执行完毕**。项目里 `skins.css` 的"全局工具类重映射"和 `legacy-tokens.json` 是**历史迁移兼容桥**，不是当前代码状态。所谓"新旧组件风格不统一"，在类名层面**已不成立**——新旧功能（gallery/agent vs strategy/ordering/assetLibrary）现在都在用同一套 `ds-*` 语义 Token。

> ⚠️ 注意：这里"统一"指**类名体系**统一。不同功能模块在**同类控件的具体用法**（尺寸、圆角、密度）上仍可能不一致——这正是维度 B 要说的。

---

## 2. 维度 B：控件高度与密度（🔴 主要问题）

### 2.1 现状：尺度 Token 存在但被绕过

设计系统在 `src/design-system/styles.css` 已定义完整控件高度尺度：

```css
--ds-control-sm: 2rem; /* 32px — 紧凑 */
--ds-control-md: 2.25rem; /* 36px — 默认 */
--ds-control-lg: 2.5rem; /* 40px — 宽松 */
```

同时 `tailwind.config.js` 也定义了 `rounded-ds-*` 圆角 Token 与 `shadow-ds-*` 阴影 Token。**但业务代码几乎不消费 `--ds-control-*`，而是散用裸高度类。**

### 2.2 数据

- 出现裸高度类（`h-7`~`h-16`、`min-h-*`、`h-[52px]` 等）的文件：**48 / 271**
- 全仓去重的高度变体：**17 种**，文件分布（按使用文件数）：

| 高度类                      | 使用文件数 | 对应像素 | 若用 Token        |
| --------------------------- | ---------- | -------- | ----------------- |
| `h-8`                       | 22         | 32px     | `--ds-control-sm` |
| `h-10`                      | 20         | 40px     | `--ds-control-lg` |
| `h-9`                       | 15         | 36px     | `--ds-control-md` |
| `h-7`                       | 13         | 28px     | （无 Token）      |
| `min-h-11`                  | 10         | 44px     | （无 Token）      |
| `h-16`                      | 9          | 64px     | 内容区            |
| `h-11`                      | 8          | 44px     | （无 Token）      |
| `h-12`                      | 7          | 48px     | （无 Token）      |
| `min-h-10`                  | 6          | 40px     | `--ds-control-lg` |
| `min-h-9`                   | 5          | 36px     | `--ds-control-md` |
| `min-h-16`                  | 4          | 64px     | 内容区            |
| `h-14`                      | 3          | 56px     | 标题栏            |
| `min-h-8`                   | 3          | 32px     | `--ds-control-sm` |
| `min-h-12`                  | 2          | 48px     | （无 Token）      |
| `h-[52px]` / `min-h-[52px]` | 2          | 52px     | 输入栏图标位      |
| `min-h-14`                  | 1          | 56px     | 标题栏            |

### 2.3 最乱的 5 个文件（同一文件内高度变体最多）

| 文件                                                  | 高度变体数 | 出现的值                                                             |
| ----------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `features/strategy/adapters/GallerySopBatchModal.tsx` | 9          | h-7, h-8, h-9, h-10, h-11, min-h-8, min-h-9, min-h-10, min-h-11      |
| `features/strategy/StrategyEditor.tsx`                | 9          | h-7, h-8, h-9, h-10, min-h-9, min-h-10, min-h-11, min-h-14, min-h-16 |
| `features/strategy/StrategyGrid.tsx`                  | 9          | h-7, h-8, h-9, h-10, h-11, h-14, min-h-12, min-h-16                  |
| `features/requirementPrototype/AppShell.tsx`          | 6          | h-8, h-9, h-10, h-11, h-16, min-h-11                                 |
| `components/AgentWorkspace.tsx`                       | 5          | h-7, h-9, h-10, h-14, h-16                                           |

### 2.4 根因

1. 老组件（gallery/agent 系）沿用 Tailwind 默认高度类，从未迁移到 `--ds-control-*`；
2. 新功能模块（strategy/ordering）各自为政，同一语义控件（如"一个操作按钮"）在 `h-8`（32px）到 `h-11`（44px）之间漂移；
3. 存在 `h-7`（28px）、`h-11/min-h-11`（44px）这类**设计系统尺度里没有**的"孤儿高度"，说明有开发者按直觉加值。

### 2.5 建议

- 将**交互控件**（按钮、输入框、选择器、图标按钮）统一到三档：`--ds-control-sm`(32px) / `--ds-control-md`(36px) / `--ds-control-lg`(40px)；
- 消灭 `h-7`、`h-11`、`min-h-11` 等无 Token 高度：h-7→sm、h-11→lg（若需 44px 触控目标，应新增 `--ds-control-touch: 2.75rem` 并显式声明，而不是散落 `min-h-11`）；
- `h-14`/`h-16` 属于标题栏/内容区高度，不属于控件尺度，可保留但建议统一为语义名（如 `--ds-header-sm`）。

---

## 3. 维度 C：图标系统（⚠️ 中等，源已统一、残留手写 SVG）

### 3.1 现状

- **图标源已统一**：`src/components/icons.tsx` 只是一行 `export * from '../design-system/icons'`；`design-system/icons.tsx` 是 lucide 图标（约 90 个）的统一包装（`size`/`strokeWidth`/`title` props）。
- **残留手写内联 SVG**：16 个文件共 **120 处** `<svg>`，全部集中在老组件。

### 3.2 数据

| 文件                                 | 手写 `<svg>` 数 |
| ------------------------------------ | --------------- |
| `components/InputBar.tsx`            | 30              |
| `components/SettingsModal.tsx`       | 22              |
| `components/TaskCard.tsx`            | 18              |
| `components/HelpModal.tsx`           | 10              |
| `components/MaskEditorModal.tsx`     | 8               |
| `components/DetailModal.tsx`         | 8               |
| `components/SizePickerModal.tsx`     | 5               |
| `components/FavoriteCollections.tsx` | 5               |
| 其余 8 文件                          | ≤3              |

### 3.3 判断

新功能（strategy/ordering/assetLibrary）已统一用 `design-system/icons`（lucide）。**老组件（InputBar/SettingsModal/TaskCard/HelpModal 等）仍内联手写 SVG**，与统一图标风格并存——这就是"图标系统混乱"的实际观感来源。它们大多是自定义图形（放大镜、上传、生成图标、状态图标等），lucide 未必有完全等价物，因此迁移需要逐一判断。

### 3.4 建议

- 为每个手写 SVG 判断：lucide 有等价物 → 替换为 `design-system/icons` 导出；无等价物且高频复用 → 补充进 `design-system/icons.tsx`（保持统一 props 接口），避免散落在组件里；
- 明确规则："组件里不出现裸 `<svg>`"，全部走 `design-system/icons` 或 `Icon` 注册表。

---

## 4. 维度 D：配色（⚠️ 低–中）

### 4.1 数据

- 写死 hex：**84 处**，但分布集中在**数据/工具库**（非 UI 组件）：
  - `features/composite/lib/compositeDefaults.ts`（18）— 合成默认色板
  - `features/assetLibrary/colorLabels.ts`（17）— 素材标签用户色
  - `lib/watermarkEngine.ts`（7）、`lib/promptVariableColors.ts`（6）等
  - 真正 UI 组件中很少：`MaskEditorModal`(3)、`PostprocessWorkspace`(8)、`PostprocessV2Workspace`(3)
- `text-white`：**88 处** — 这是**预期行为**（反色文字，`migrate-legacy-tokens.mjs` 特意保留，`text-white` 配实心色底用于角标/覆盖层），不是 bug。
- `text-black`：0 处。

### 4.2 判断

`compliance.test.ts` 已对"持久化用户数据调色板"（`colorLabels.ts`、`promptVariableColors.ts`）做了白名单豁免——这些 hex 是**用户数据驱动的色标**，本就不该走设计 Token。UI 组件内的 hex 残留很少（Postprocess/MaskEditor 等老工作台），属于低优先级。

### 4.3 建议

- UI 组件内的 hex 残留（Postprocess 系、MaskEditor）可迁移到 `--ds-color-*` 语义色或明确归类为"画布工具色"（如遮罩红/绿），单独登记；
- `text-white` 保持现状（有规范依据），无需清理；
- 用户数据调色板维持白名单豁免，不强行改。

---

## 5. 已核实为"正常/非问题"的点

| 检查项                                | 结论                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| 旧类（bg-white/text-gray/rounded-xl） | 已全部迁移，业务代码 0 处                                      |
| 深浅色模式                            | `darkMode:'class'` + `--ds-*` 深色变量，完整                   |
| 皮肤系统                              | 5 套皮肤 + `--skin-blue-*` 品牌换肤，机制完整                  |
| z-index                               | 全部走 `--ds-z-*` Token（compliance 强制，无任意数字 z-index） |
| 字号                                  | 已归一到 DS 字号体系（compliance 禁止 text-[8-11px]）          |
| transition                            | 禁止 `transition-all`（compliance 强制）                       |
| 图标来源                              | 已统一到 `design-system/icons`（lucide 包装）                  |

---

## 6. 结论与治理建议

### 6.1 根本判断

**DOUPAO 的设计系统本身不落后，不需要"替换成上游 gpt_image_playground 那套"**（上游那套是 DOUPAO 的前身、功能更少：无皮肤、无 shadcn、无 Token 体系、无规范/测试）。当前"杂乱"的真实来源是：

1. **主要**：控件高度尺度 Token（`--ds-control-sm/md/lg`）定义了但业务代码没消费，导致 48 个文件、17 种高度漂移；
2. **次要**：16 个老组件残留 120 处手写内联 SVG；
3. **低**：Postprocess/MaskEditor 等老工作台少量 hex 残留。

### 6.2 建议的治理顺序（按性价比）

| 优先级 | 动作                                                                               | 工作量 | 收益                   |
| ------ | ---------------------------------------------------------------------------------- | ------ | ---------------------- |
| P0     | 将 `--ds-control-*` 高度 Token 引入业务代码，消灭 `h-7/h-11/min-h-11` 孤儿高度     | 中     | 立即消除"按钮忽大忽小" |
| P0     | 明确 `--ds-control-touch`（如需 44px 触控），替换 `min-h-11` 散落写法              | 小     | 触控目标统一           |
| P1     | 老组件手写 SVG → `design-system/icons`（或补充注册表）                             | 中     | 图标观感统一           |
| P2     | Postprocess/MaskEditor hex → 语义色或工具色登记                                    | 小     | 配色收敛               |
| 持续   | 在 `compliance.test.ts` 增加"禁止新增裸 `h-7~h-16` 控件高度、禁止裸 `<svg>`"的守卫 | 小     | 防止回潮               |

### 6.3 与"替换设计系统"的关系

本报告确认：**不需要、也不应该用上游 gpt_image_playground 的设计系统替换 DOUPAO 当前的**。正确方向是让 DOUPAO 业务代码更充分地消费它已有的 `--ds-control-*` / `--ds-space-*` / `rounded-ds-*` 等尺度 Token，并把残留手写图标与 hex 收敛掉。这正是 `compliance.test.ts` 里"旧工具类只减不增"治理路径的自然延伸。

---

## 附录：复现方法

```bash
node scripts/audit-design-consistency.mjs --json tasks/design-audit.json
```

脚本输出全仓逐文件统计（`tasks/design-audit.json`），覆盖：可迁移旧类数、ds-* 使用数、高度类集合、`<svg>` 数、lucide 导入、hex / text-white 计数。
