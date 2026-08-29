# 下单工作区迁移与复现说明

## 1. 模块定位

下单已从需求中心内部页面拆为与“画廊”“策略”“后期处理”“Agent”并列的一级工作区。一级“下单”工作区包含新建需求和任务跟踪两个业务面板，并根据当前角色显示可用能力：

- 优化师：新建需求、查看自己的任务。
- 管理员：查看全部任务。
- 其他角色：只查看自己有权限访问的任务。

进入下单模式后，画廊提示词输入栏和词条侧栏不会显示。

## 2. 目录结构

```text
src/features/ordering/
├─ index.ts
├─ types.ts                              # 可迁移业务契约
├─ planner.ts                            # 组合展开、校验和提示词编译
├─ OrderingCreate.tsx                    # 新建需求核心界面
├─ OrderingHistory.tsx                   # 任务列表、详情和操作
└─ adapters/
   └─ RequirementOrderingWorkspace.tsx   # 当前项目 Store、文件系统适配
```

模块分为两层：

- 核心层不读取全局 Store，不依赖 Electron，也不直接操作文件系统。
- `adapters` 连接当前项目的用户、目录、订单、任务、额度、队列操作和结果目录。

## 3. 运行依赖

核心界面需要：

```bash
npm install react react-dom lucide-react
```

当前组件使用 Tailwind CSS，目标项目需保证扫描策略包含：

```js
content: ['./src/**/*.{js,ts,jsx,tsx}']
```

Zustand、Electron 和当前数据库只在项目适配层使用，不是核心模块的必要依赖。

## 4. 一级工作区接入

### 4.1 注册应用模式

```ts
export type AppMode =
  | 'gallery'
  | 'strategy'
  | 'ordering'
  | 'postprocess'
  | 'agent'
```

持久化恢复逻辑也要把 `ordering` 加入合法模式白名单。

### 4.2 增加顶部入口

```tsx
<button
  type="button"
  onClick={() => setAppMode('ordering')}
  className={appMode === 'ordering' ? activeClass : inactiveClass}
>
  下单
</button>
```

当前移动端使用五等分导航，保持在五个一级入口以内。按钮文案使用短标签，避免横向滚动。

### 4.3 挂载工作区

```tsx
import { lazy, Suspense } from 'react'

const OrderingWorkspace = lazy(
  () => import('./features/ordering/adapters/RequirementOrderingWorkspace'),
)

{appMode === 'ordering' && (
  <Suspense fallback={null}>
    <OrderingWorkspace />
  </Suspense>
)}
```

画廊专属组件按模式显示：

```tsx
{(appMode === 'gallery' || appMode === 'agent') && <InputBar />}
```

词条侧栏、画廊工具栏和其他浮层使用同样条件，防止覆盖下单工作区。

## 5. 核心数据契约

### 5.1 目录数据

`OrderingCatalog` 包含三个目录：

| 类型 | 必要内容 |
| --- | --- |
| `OrderingProduct` | 产品事实、人群、场景、禁用项、发布状态 |
| `OrderingChannel` | 支持尺寸、渠道要求、禁用项、发布状态 |
| `OrderingMaterialType` | 固定或智能策略、兼容产品/渠道、支持尺寸 |

核心规划器只读取这些契约，不关心目录来自数据库、接口还是本地配置。

### 5.2 下单草稿

`OrderingDraft` 保存：

- 多选产品 ID。
- 渠道及每个渠道选中的尺寸。
- 多选素材类型 ID。
- 每个有效组合的生成数量。
- 是否加急、加急原因和目标时间。

### 5.3 订单与任务

`OrderingOrder` 包含订单状态、原始草稿、执行单元、排除组合、进度、加急状态和输出信息。每个 `OrderingUnit` 对应一个“产品 × 渠道 × 尺寸 × 素材类型”组合。

`OrderingTask` 是最小任务适配契约，目前只要求任务 ID 和可选结果目录。

## 6. 规划器复用

`planner.ts` 是纯函数模块，可独立用于前端预览、服务端校验或创建队列任务：

```ts
const preview = planOrderingOrder(draft, catalog, {
  maxImagesPerOrder: 500,
  remainingDailyQuota: 2000,
})
```

返回值包括：

- `units`：可以执行的组合及完整提示词。
- `excluded`：因目录状态、尺寸或兼容性被排除的组合。
- `totalImages`：计划生成总量。
- `errors`：缺少选项、数量错误、超单次上限或超额度等阻断原因。
- `valid`：是否允许提交。

服务端创建订单时必须再次调用同一规划器校验，不要只信任前端预览结果。

## 7. 核心组件接入

### 7.1 新建需求

```tsx
<OrderingCreate
  catalog={catalog}
  settings={settings}
  currentUserId={user.id}
  remainingQuota={quota}
  orders={orders}
  onCreateOrder={createOrder}
  onCreated={(order) => openOrder(order.id)}
/>
```

`onCreateOrder` 必须返回：

```ts
{ order?: OrderingOrder; error?: string }
```

后端或 Store 返回的错误会显示在下单摘要附近。

### 7.2 任务记录

```tsx
<OrderingHistory
  catalog={catalog}
  currentUserId={user.id}
  canViewAll={user.role === 'admin'}
  orders={orders}
  tasks={tasks}
  selectedOrderId={selectedOrderId}
  onSelectOrder={setSelectedOrderId}
  onCancelOrder={cancelOrder}
  onRetryUnit={retryUnit}
  onOpenTaskFolder={openTaskFolder}
/>
```

打开文件夹是可选能力。Web 项目没有本地文件系统时可以不传 `onOpenTaskFolder`，组件会隐藏入口。

## 8. 宿主适配清单

目标项目需要提供：

- 当前用户 ID 和角色。
- 产品、渠道、素材类型目录。
- 下单限制、数量快捷项和每日剩余额度。
- 当前订单列表和生成任务列表。
- 创建订单、取消订单、重试失败单元。
- 可选的本地结果目录打开能力。
- 后台队列执行器，将排队单元转成真实图片生成任务。
- 完成后的订单状态和进度回写。

当前映射集中在 `adapters/RequirementOrderingWorkspace.tsx`。迁移时优先重写这个文件，不要让核心组件直接依赖目标项目的 Store。

## 9. 队列与文件清单

当前项目的队列执行和结果清单仍属于宿主运行环境：

- `features/requirementPrototype/QueueRunner.tsx` 负责把订单单元提交到现有图片生成任务。
- `features/requirementPrototype/manifests.ts` 负责输出 JSON、HTML 和表格清单。

迁移到其他项目时可替换为后端队列、消息队列或云任务。必须保持以下状态回写语义：

1. 单元从 `queued` 进入 `running`。
2. 成功后标记 `done` 并关联任务 ID。
3. 失败后标记 `error` 并保存可读错误。
4. 重试时清理旧错误并重新排队。
5. 汇总单元状态更新订单进度和最终状态。

## 10. 持久化与数据迁移

迁移已有订单时保留：

- 订单、单元和任务 ID。
- 产品、渠道、素材类型关联 ID。
- 创建者、创建时间和订单号。
- 原始草稿、排除组合及提示词。
- 运行状态、完成数量、失败数量和输出目录。

如果目标项目重新生成目录 ID，必须先建立旧 ID 到新 ID 的映射，否则历史订单详情无法显示名称。

应用状态持久化还需允许恢复 `ordering` 模式。

## 11. 复现步骤

1. 复制 `src/features/ordering` 到目标项目。
2. 安装 React、图标和 Tailwind 依赖。
3. 准备符合 `OrderingCatalog` 的目录数据。
4. 实现额度查询和 `CreateOrderingOrder`。
5. 实现取消、重试和订单状态回写。
6. 按目标项目状态库重写 `adapters/RequirementOrderingWorkspace.tsx`。
7. 注册 `ordering` 应用模式和顶部“下单”入口。
8. 在下单模式隐藏画廊输入组件。
9. 接入后台队列和可选结果清单输出。
10. 完成验证清单后再迁移正式订单。

## 12. 验证清单

```bash
npm test
npm run build
```

- 顶部可以在画廊、策略、下单、后期处理和 Agent 之间切换。
- 移动端五个入口不产生横向滚动。
- 下单模式不显示画廊输入栏和词条侧栏。
- 只有已发布且未归档的目录项可供选择。
- 产品、渠道尺寸和素材类型组合实时展开。
- 不兼容组合正确排除并说明原因。
- 超单次上限、超每日额度和无有效组合时无法提交。
- 加急单必须填写原因。
- 成功提交后进入任务记录并选中新订单。
- 普通用户只能看到自己的订单，管理员可以看到全部订单。
- 取消、失败重试、进度显示和打开结果目录正常。
- 刷新后订单和当前一级工作区能够恢复。
- 浅色、深色和窄屏布局均可正常使用。

## 13. 当前项目专属部分

迁移时通常需要替换：

- `RequirementOrderingWorkspace.tsx`：当前 Zustand Store、用户权限和文件系统适配。
- `QueueRunner.tsx`：当前图片生成任务提交方式。
- `manifests.ts`：当前 Electron 本地目录和文件输出方式。

`types.ts`、`planner.ts`、`OrderingCreate.tsx` 和 `OrderingHistory.tsx` 可以作为可移植核心直接复用。
