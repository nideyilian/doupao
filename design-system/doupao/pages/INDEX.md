# 页面覆盖文档索引

本目录为各顶层工作区记录**与 `../MASTER.md` 不同**的规范覆盖。全局视觉、交互、Token 一律以 MASTER.md 为准；新页面应优先复用 `../COMPONENTS.md` 第 2.8 节的交互模式配方。

| 文档 | 工作区 | 入口 | 关键差异 |
| --- | --- | --- | --- |
| [gallery.md](./gallery.md) | 画廊主页 | `appMode==='gallery'`（默认） | 自适应占满停靠侧栏间宽度；自实现鼠标框选；无专属快捷键 |
| [agent.md](./agent.md) | Agent 工作台 | `appMode==='agent'` | 会话侧栏可收起；消息内嵌 `AgentImageGrid`；无框选/专属快捷键 |
| [strategy.md](./strategy.md) | 策略工作台 | `appMode==='strategy'`（壳内复用） | 全宽三栏；专属 `Ctrl+C/V` 复制粘贴策略 |
| [ordering.md](./ordering.md) | 下单工作台 | `appMode==='ordering'`（壳内复用） | `max-w-[1600px]` 双视图；强角色权限；无快捷键/画布 |
| [postprocess.md](./postprocess.md) | 后期/合成工作台 | `appMode==='postprocess'` | 全宽画布 + 多快捷键 + 图层拖拽编辑；无停靠留白 |
| [requirement-prototype.md](./requirement-prototype.md) | 需求中心壳 | 应用外层始终挂载 | 独立登录/角色导航；与 legacy `SegmentedControl` 双导航并存 |

> 编写新工作区时，复制 `_TEMPLATE.md` 并按上表登记一行。
