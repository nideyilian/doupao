# DOUPAO 组件规范与现有模块覆盖

> 全局视觉与交互规则见 `MASTER.md`。  
> 可执行 API 位于 `src/design-system/index.ts`。  
> 可执行规范数据位于 `src/design-system/catalog.ts`。  
> 开发期访问 `/?design-system=1` 查看所有示例和覆盖表。

## 1. 覆盖模型

项目组件分为两层：

1. **共享组件**：跨两个以上业务场景复用，视觉、状态和可访问性由设计系统负责。
2. **业务组件**：任务卡、生成工作台、策略编辑器等承载领域状态，不复制进共享层；
   它们通过共享组件组合，并在本文件登记责任和迁移方向。

这避免了两个相反问题：共享库过少导致每页重复造轮子，或共享库过度抽象导致业务逻辑
被塞进难以复用的“万能组件”。

当前覆盖：

- 共享组件规范（含 2 个配色皮肤组件 `ColorSchemeSwitcher`、`ColorPresetGrid`）。
- 正式 UI 模块逐一登记。
- 7 个类别：基础、布局、表单、导航、数据展示、反馈、浮层。
- 具体数量以 `src/design-system/catalog.ts` 和 `catalog.test.ts` 自动覆盖结果为准。
- 自动覆盖测试：新增或删除 UI 文件时，组件登记表必须同步更新。

## 2. 共享组件规范

### 2.1 基础

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Button` | 提交、创建、保存和命令 | primary / secondary / ghost / danger / loading | 每个区域最多一个主按钮；加载时锁定并声明 `aria-busy` |
| `IconButton` | 紧凑工具栏动作 | sm / md / lg | 必须提供 `aria-label`；陌生图标同时使用 Tooltip |
| `Surface` | 表达表面层级 | default / subtle / raised | 不能仅为“加圆角”使用；真正浮起时才使用 raised |

### 2.2 布局

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Container` | 统一页面宽度和边距 | sm / md / lg / full | 画布类工作区可使用 full，阅读内容不得无边界拉伸 |
| `Stack` | 垂直节奏 | gap 4–48 | 同组紧、异组松；不能用空 div 代替间距 |
| `Inline` | 行内动作和元数据 | wrap / nowrap / align / justify | DOM 顺序必须与视觉顺序相同 |
| `Grid` | 响应式同类项目 | minColumnWidth / gap | 用于卡片和缩略图，不用于混合层级内容 |
| `SplitPane` | 侧栏和主工作区 | start / end | 767px 以下回落单列；避免双重滚动 |
| `ScrollArea` | 必需的面板内滚动 | maxHeight | 可键盘聚焦并显示焦点；页面主滚动优先 |
| `Divider` | 明确内容分组 | horizontal / vertical | 留白足够时不额外添加分隔线 |

### 2.3 表单

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `TextField` | 单行名称、路径和参数 | helper / error / required / readOnly | 可见 label；错误与输入框语义关联 |
| `TextArea` | 提示词、说明和模板 | helper / error / required | 不用 placeholder 代替 label；允许调整高度 |
| `Checkbox` | 独立布尔项或多选 | primary / danger / indeterminate | 使用原生 checkbox；标签扩大点击区域 |
| `Switch` | 立即生效的开关 | label start / end | 需要提交的表单项应使用 Checkbox |
| `RadioGroup` | 2–5 个互斥选项 | vertical / horizontal | 使用 fieldset/legend 和同名 radio |
| `SegmentedControl` | 2–4 个紧凑模式 | sm / md | 只用于短标签和当前视图，不作为顶层导航 |
| `SelectField` | 普通单选列表 | helper / error / disabled | 优先原生 select；复杂动作继续使用高级 Select |
| `SearchField` | 过滤当前集合 | clearable | 使用 `type=search` 和完整可访问名称 |
| `Fieldset` | 相关设置组 | description / actions | 多字段共同描述一个设置时使用 |
| `Stepper` | 小范围数字微调 | min / max / step | 增减按钮必须有完整名称和边界状态 |
| `ColorSchemeSwitcher` | 在皮肤（配色方案）间切换整体视觉 | sm / md | 顶栏/设置选择 默认/Apple/小米；仅切配色而非深浅主题 |
| `ColorPresetGrid` | 以卡片网格选择配色预设 | columns 2/3/4 | 设置页「主题」区块展示渐变预览与选中态 |

### 2.4 反馈

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Badge` | 短状态或分类 | neutral / info / success / warning / danger | 文本必须脱离颜色仍可理解 |
| `StatusIndicator` | 在线、运行、完成和失败 | neutral / info / success / warning / danger | 状态圆点是装饰，文字提供语义 |
| `Alert` | 区域级说明和恢复指导 | info / success / warning / danger | 说明原因、影响和下一步 |
| `ToastMessage` | 非阻断全局反馈 | info / success / warning / danger | 不抢焦点；危险错误使用 `alert` |
| `Spinner` | 短时不确定等待 | sm / md / lg | 预计超过 1 秒且结构已知时改用 Skeleton |
| `Progress` | 批处理、导出和上传进度 | determinate / indeterminate / tones | 提供完整 progressbar 数值属性 |
| `Skeleton` | 为异步内容保留空间 | 任意形状 | 接近最终布局；减少动态时停止动画 |
| `EmptyState` | 解释空集合和下一步 | icon / description / action | 回答是什么、为什么为空、下一步做什么 |
| `ErrorState` | 整个区域失败 | retry / details | 必须提供恢复路径；技术细节不能取代用户说明 |
| `Kbd` | 展示已实现的快捷键 | — | 快捷键不能成为唯一操作入口 |

### 2.5 导航

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Tabs` | 同一上下文内的并列内容 | sm / md / stretch | tablist/tab 语义；方向键切换 |
| `Toolbar` | 相关命令组 | — | 使用 `role=toolbar` 和明确名称 |
| `PageHeader` | 页面标题、说明和主行动 | breadcrumbs / eyebrow / actions | 页面唯一 h1；主行动唯一 |
| `SectionHeader` | 页面内区域标题和动作 | description / actions | 保持标题层级连续 |
| `Breadcrumbs` | 三级以上层级路径 | link / button / current | 当前位置使用 `aria-current=page` |
| `NavList` | 设置、素材和管理侧栏 | icon / badge / disabled | 当前位置清晰；不与同层级 Tabs 混用 |

### 2.6 数据展示

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Card` | 独立信息单元 | header / content / footer | Card 本身不伪装按钮；使用内部链接或按钮 |
| `Panel` | 工作台设置和属性区域 | header / content / footer | 输出 section/h2；简单分组使用 Surface |
| `ListRow` | 标签页、任务、预设和历史 | leading / meta / actions / selected | 可点击时使用真实按钮或链接 |
| `Stat` | 总数、成功、失败和耗时 | trend | 标签始终可见；数字使用 tabular figures |
| `KeyValue` | 参数和只读元数据 | — | 使用 dt/dd；可编辑值改用表单 |
| `Thumbnail` | 固定比例图像预览 | ratio / selected | 必须提供 alt；比例避免布局跳动 |
| `AspectRatio` | 媒体比例容器 | ratio | 不用于文本内容 |
| `Disclosure` | 帮助和进阶设置 | open / closed | 关键内容默认可见；使用原生 details/summary |
| `CodeBlock` | 模板、JSON 和代码 | language | 使用 pre/code；保留空白并允许滚动 |
| `Table` | 列间比较数据 | head / body / row / cell | 保留原生表格结构；窄屏容器可滚动 |

### 2.7 浮层

| 组件 | 用途 | 变体 | 强制规则 |
| --- | --- | --- | --- |
| `Dialog` | 确认、短表单和高风险任务 | sm / md / lg / xl | 锁定焦点、Escape 关闭、关闭后归还焦点 |
| `DialogWorkspace` | 复杂弹窗内部工作区 | single / split / triple | 所有 Tab 共用同一 pane 语法，不在弹窗内再套页面背景 |
| `DialogPane` | 复杂弹窗内的侧栏、列表、内容或状态区 | sidebar / content / canvas / scroll | pane 顺序等于阅读顺序；不为装饰套卡片 |
| `Drawer` | 属性、素材库和窄屏侧栏 | left / right / bottom / sm / md / lg | 保留主上下文；继承 Dialog 焦点管理 |
| `Tooltip` | 解释陌生图标或控件 | top / right / bottom / left | 深色气泡（无边框）；仅补充信息；键盘聚焦可显示 |
| `Popover` | 筛选、颜色、尺寸和短设置 | arrow | 打开状态和位置由业务调用方管理 |
| `Menu` | 右键和更多命令 | item / danger / separator / shortcut | 方向键、Home、End 移动焦点 |

工具提示统一为「深色气泡」视觉：背景 `--ds-color-text`、文字 `--ds-color-text-inverse`、
圆角 `--ds-radius-md`、无边框。两种渲染方式共用同一视觉，行为统一由 `useTooltip(options?)` 控制：

- 静态 / 受控场景：直接使用 `Tooltip`（CSS hover/focus，带 `aria-describedby`）。
- 需要视口碰撞检测 / Portal 定位：使用 `ViewportTooltip`（复用 `.ds-tooltip--viewport` 视觉类）。

`useHintTooltip` 已并入 `useTooltip`（`enabled` / `autoHideMs` / `touchDelayMs` 与
`show` / `hide` / `startTouch` / `clearTimer`）。

复杂弹窗统一使用以下结构，不允许每个 Tab 自行拼一套页面：

```tsx
<Dialog title="管理中心">
  <Tabs aria-label="管理中心功能" />
  <DialogWorkspace layout="triple">
    <DialogPane as="aside" tone="sidebar">分组或导航</DialogPane>
    <DialogPane tone="content">列表或配置</DialogPane>
    <DialogPane tone="content">编辑表单或状态</DialogPane>
  </DialogWorkspace>
</Dialog>
```

规则：

- `DialogPane` 内直接放 `SectionHeader`、`ListRow`、`TextField`、`SelectField`、`TextArea`、`StatusIndicator` 等组件。
- 只有上传区、状态说明、错误恢复这类独立模块才使用 `Surface/Card`；不能为了“看起来有模块”再套大卡片。
- 同一 Dialog 的所有 Tab 保持相同字号、字段高度、按钮样式、选择态和滚动条位置。
- `SelectField` 只用于选值；带复制、删除、更多操作的下拉必须使用 `Menu` 或业务高级 `Select`，不能混用视觉。

### 2.8 交互模式配方

以下是项目中跨两个以上场景重复出现的组合模式。新页面遇到同类需求时必须按配方
组合，不得重新发明结构。全局交互规则见 `MASTER.md` 第 6 章。

#### 可选择媒体网格

适用：画廊任务网格、Agent 图片网格、收藏夹、SOP 批量结果。

```text
Grid → Card/Thumbnail（含状态角标）→ 批量操作栏（选中数 ≥ 1 时出现）
```

- 组合：`Grid + Thumbnail + AspectRatio + StatusIndicator + Toolbar + EmptyState + Skeleton`。
- 选择模型、框选和右键菜单遵循 MASTER 6.3 / 6.5；选中态用 Selection Token。
- 超过 50 个复杂项必须虚拟化；选择状态存 id 集合，不依赖 DOM。
- 每个卡片四态：生成中（进度）、成功（图像）、失败（可重试占位）、已选中。

#### 树 + 列表 + 编辑器工作台

适用：策略工作台、SOP 管理中心、预设管理、词库管理。

```text
SplitPane → NavList/StrategyTree（导航侧栏）→ 列表或网格（中栏）→ 编辑表单（右栏/弹窗）
```

- 组合：`SplitPane + NavList + ListRow + SearchField + Fieldset + TextField + Menu + EmptyState`。
- 树节点行内重命名：双击或菜单进入，Enter 提交、Escape 取消；编辑中禁用导航。
- 未保存的编辑器内容离开前必须确认或自动存草稿（`Ctrl+S` 保存遵循 MASTER 6.2）。
- 三栏在 1024px 以下折叠为两栏（导航转 Drawer），767px 以下单栏逐级下钻。

#### 队列运行器

适用：Agent 批量队列、日程执行器、需求队列、批量导出。

- 组合：`Progress + StatusIndicator + ToastMessage +（详情处）Table/ListRow`。
- 无独立界面的后台协调器只通过 Toast 和全局统计发声，不弹阻断浮层。
- 状态机、取消、失败重试和恢复规则遵循 MASTER 7.3。

#### 批量执行配置弹窗

适用：Agent 批量规划、画廊 SOP 批量、日程创建。

```text
Dialog → Fieldset（参数区）→ 预估摘要（Stat/KeyValue）→ 主行动（唯一）
```

- 组合：`Dialog + Fieldset + TextField/SelectField/Stepper + KeyValue + Alert + Button`。
- 提交前必须展示预估结果（将生成 N 张 / 消耗 M 个任务位）；参数非法时主按钮
  禁用并就近提示原因。
- 提交后弹窗立即关闭，进度交给队列运行器汇报，不在弹窗内等待。

#### 可停靠侧栏

适用：WorkspaceTabBar、WordLibrarySidebar。

- 停靠态与浮动态的视觉切换遵循 MASTER 4.6；宽度、停靠边和展开状态必须持久化。
- 侧栏内部结构：`SearchField（可选）→ 主滚动区（NavList/ListRow）→ 固定操作区`。
- 折叠后保留可发现的展开开关（`IconButton + Tooltip`），不完全消失。

#### 媒体查看链路

适用：所有出现图像缩略图的场景。

- 四级链路 `Thumbnail → HoverImagePreview → Lightbox → DetailModal` 的职责与触发
  遵循 MASTER 6.6；不得跳级复用（如把详情塞进悬停预览）。
- 新场景若只需要两级（缩略图 + Lightbox），中间层直接省略，不做空壳。

## 2.9 页面覆盖文档

每个顶层工作区的「与全局规范差异」登记在 `pages/` 目录：

- `pages/INDEX.md`：索引与差异速览。
- `pages/gallery.md`、`pages/agent.md`、`pages/strategy.md`、`pages/ordering.md`、
  `pages/postprocess.md`、`pages/requirement-prototype.md`。
- 新工作区复制 `pages/_TEMPLATE.md`，并在 `pages/INDEX.md` 登记一行。

页面文档只记录偏离 MASTER.md 的规则（含业务理由与删除条件），不复制全局规范。

## 3. 现有 UI 模块映射

决策含义：

- `migrate`：已具备直接替代条件，优先迁移。
- `compose`：业务组件保留，用共享组件替换其视觉和交互骨架。
- `retain`：领域状态或高级交互必须保留，只复用适合的基础部件。

### 3.1 全局组件

| 模块 | 决策 | 对应共享组件 |
| --- | --- | --- |
| AgentBatchPlannerModal | compose | Dialog / Fieldset / TextField / SelectField / Button / Alert |
| AgentBatchQueueRunner | retain | Progress / ToastMessage / StatusIndicator |
| AgentImageGrid | compose | Grid / Thumbnail / AspectRatio / EmptyState |
| AgentWorkspace | retain | SplitPane / Toolbar / StatusIndicator / Alert / Progress / Thumbnail |
| Checkbox | migrate | Checkbox |
| ConfirmDialog | compose | Dialog / Button / Checkbox / Alert |
| DetailModal | retain | Dialog / Tabs / KeyValue / Thumbnail / Toolbar |
| ErrorBoundary | compose | ErrorState / Button |
| FavoriteCollections | retain | Grid / Card / Thumbnail / Dialog / SearchField / Menu |
| Header | retain | Toolbar / Tabs / Stat / IconButton / Tooltip |
| HelpModal | compose | Dialog / Tabs / Disclosure / CodeBlock |
| HoverImagePreview | retain | Popover / Thumbnail |
| ImageContextMenu | compose | Menu / Kbd |
| InputBar | retain | TextArea / Toolbar / Button / SelectField / Stepper / Tooltip / Popover |
| Lightbox | retain | Dialog / Toolbar / IconButton / StatusIndicator |
| MarkdownRenderer | retain | CodeBlock / Table |
| MaskEditorModal | retain | Dialog / Toolbar / Button / Progress |
| PostprocessV2Workspace | retain | SplitPane / Tabs / Panel / Toolbar |
| PostprocessWorkspace | retain | SplitPane / Tabs / Panel / Toolbar |
| PromptInputDialog | compose | Dialog / TextArea / Button |
| PromptVariableEditor | retain | 无对应共享原语（富文本 contentEditable 编辑器，fieldset/表单字段不适用） |
| RandomPromptModal | retain | Dialog / Tabs / SearchField / ListRow / EmptyState |
| ScheduleModal | retain | Dialog / Tabs / Toolbar / ListRow / Popover |
| ScheduleRunner | retain | ToastMessage / StatusIndicator / Progress |
| SearchBar | compose | Toolbar / SearchField / SelectField / IconButton |
| Select | retain | SelectField / Popover / Menu |
| SettingsModal | retain | Dialog / Tabs / Fieldset / TextField / SelectField / Switch / Alert |
| SizePickerModal | compose | Dialog / Grid / SegmentedControl / Button |
| SopBatchDetailModal | compose | Dialog / Grid / Thumbnail / StatusIndicator / Progress |
| SopBatchTaskCard | compose | Card / Thumbnail / StatusIndicator / Toolbar |
| SupportPromptModal | compose | Dialog / Alert / Button |
| TaskCard | retain | Card / Thumbnail / StatusIndicator / Toolbar / Menu |
| TaskGrid | retain | Grid / Skeleton / EmptyState |
| Toast | migrate | ToastMessage |
| UpdateReleaseNotesModal | compose | Dialog / Disclosure / Button |
| VarEntryEditor | compose | Dialog / TextField / ListRow / Button |
| ViewportTooltip | retain | Tooltip |
| WordLibraryManagerModal | retain | Dialog / Tabs / SearchField / ListRow / EmptyState |
| WordLibrarySidebar | retain | SplitPane / Panel / SearchField / NavList |
| WordLibrarySidebarToggle | migrate | IconButton / Tooltip |
| WorkspaceTabBar | retain | Panel / SearchField / ListRow / Menu / Toolbar |
| WorkspaceTabManagerModal | retain | Dialog / SearchField / ListRow / Menu / EmptyState |
| AppPageRail | retain | 无对应共享原语（固定翻页导航 rail，无滚动容器） |
| WordLibraryDerivativePanel | retain | Button / SegmentedControl / Disclosure / Alert |
| WordLibraryQuickPanel | retain | SearchField / SegmentedControl / ListRow / EmptyState |

### 3.2 Assistant、Composite、Ordering、Requirement、Strategy

| 模块 | 决策 | 对应共享组件 |
| --- | --- | --- |
| AssistantActionBar | retain | Toolbar / SegmentedControl / Switch / Fieldset / Alert / Progress / CodeBlock |
| BatchExportTab | compose | Fieldset / TextField / SelectField / Progress / Alert |
| DistributionSettingsPanel | compose | Panel / Fieldset / Switch / TextField |
| ExportResultsPanel | compose | Panel / Progress / StatusIndicator / Alert / Table |
| FloatingLayerToolbar | migrate | Toolbar / Button / IconButton / Tooltip |
| FloatingLogoLibrary | compose | Panel / Grid / Thumbnail / IconButton / Tooltip |
| GlobalOutputRulesPanel | compose | Panel / Fieldset / SelectField / TextField |
| PresetCanvasEditor | retain | Toolbar / AspectRatio / Popover / StatusIndicator |
| PresetLayerPanel | retain | Panel / ListRow / Fieldset / Stepper / Menu |
| PresetManagementTab | retain | Tabs / Panel / ListRow / Menu / EmptyState |
| PresetNamingFields | retain | Fieldset / TextField / Badge / Popover / Alert |
| CompositeWorkspace | retain | SplitPane / Tabs / Panel / Toolbar |
| RequirementOrderingWorkspace | retain | PageHeader / Tabs / Container |
| OrderingCreate | retain | PageHeader / Card / Fieldset / SegmentedControl / Thumbnail |
| OrderingHistory | retain | PageHeader / Table / StatusIndicator / Drawer / EmptyState |
| RequirementPrototype AppShell | retain | Container / PageHeader / NavList / Card / Table |
| Requirement QueueRunner | retain | Progress / ToastMessage / StatusIndicator |
| GallerySopBatchModal | retain | Dialog / Fieldset / Thumbnail / Progress / Alert |
| GallerySopManagementCenter | retain | PageHeader / SplitPane / Panel |
| RequirementStrategyWorkspace | retain | PageHeader / SplitPane / Panel |
| StoreStrategyImage | retain | Thumbnail / AspectRatio |
| SopManagementCenter | retain | PageHeader / SearchField / ListRow / Panel / EmptyState |
| SopPresetPickerModal | compose | Dialog / SearchField / ListRow / EmptyState |
| StrategyEditor | retain | Fieldset / TextField / TextArea / Switch / Disclosure |
| StrategyGrid | compose | Grid / Card / StatusIndicator / EmptyState |
| StrategyTree | retain | NavList / ListRow / TextField / Menu |

## 4. 高级组件边界

以下组件不能被简单基础组件直接替换：

- `Select`：含拖拽排序、行内编辑/删除动作、触摸拖拽预览和边界定位。
- `ViewportTooltip`：含视口碰撞检测、Portal 定位和全局关闭协调。
- `Lightbox`、`MaskEditorModal`、`PresetCanvasEditor`：属于专业媒体编辑交互。
- `WorkspaceTabBar`、`WordLibrarySidebar`：含停靠、拖拽、尺寸和持久化状态。
- `TaskCard`、`AgentWorkspace`、`AssistantActionBar`：承载领域状态机。

这些组件保留在业务层，但内部新增视觉元素时必须从共享组件库组合。

## 5. 使用与治理

```tsx
import {
  Alert,
  Button,
  Fieldset,
  SelectField,
  TextField,
} from '../design-system'
```

新增共享组件前必须满足：

1. 至少两个真实业务场景，或同一模式在项目中重复三次以上。
2. 能定义清晰边界，不包含业务 Store、API 和领域状态。
3. 完成默认、hover、focus、disabled、loading/error、浅/深色和窄屏规范。
4. 在 `catalog.ts` 登记，并在活预览中提供可操作示例。
5. 更新现有模块覆盖表；自动测试必须继续保持零遗漏。
