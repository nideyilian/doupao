import type { ReactNode } from 'react'
import {
  ChevronRightIcon as ChevronRight,
  CloseIcon as X,
  FolderOpenIcon as FolderOpen,
  RefreshIcon as RefreshCw,
} from '../../design-system/icons'
import type { OrderingCatalog, OrderingOrder, OrderingTask } from './types'

const statusLabel: Record<OrderingOrder['status'], string> = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  partially_failed: '部分失败',
  failed: '失败',
  cancelled: '已取消',
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-ds-xl border border-ds-border bg-ds-surface shadow-sm dark:border-ds-border-strong dark:bg-ds-scrim ${className}`}
    >
      {children}
    </section>
  )
}

export interface OrderingHistoryProps {
  catalog: OrderingCatalog
  currentUserId: string
  canViewAll: boolean
  orders: OrderingOrder[]
  tasks: OrderingTask[]
  selectedOrderId?: string | null
  onSelectOrder: (orderId: string) => void
  onCancelOrder: (orderId: string) => void
  onRetryUnit: (orderId: string, unitId: string) => void
  onOpenTaskFolder?: (task: OrderingTask) => void
}

function OrderDetail({
  order,
  catalog,
  tasks,
  onCancelOrder,
  onRetryUnit,
  onOpenTaskFolder,
}: Pick<OrderingHistoryProps, 'catalog' | 'tasks' | 'onCancelOrder' | 'onRetryUnit' | 'onOpenTaskFolder'> & {
  order: OrderingOrder
}) {
  const productById = new Map(catalog.products.map((item) => [item.id, item.name]))
  const channelById = new Map(catalog.channels.map((item) => [item.id, item.name]))
  const typeById = new Map(catalog.materialTypes.map((item) => [item.id, item.name]))
  const percent = order.totalImages
    ? Math.round(((order.completedImages + order.failedImages) / order.totalImages) * 100)
    : 0

  const openUnitFolder = (taskId?: string) => {
    const task = tasks.find((item) => item.id === taskId)
    if (task) onOpenTaskFolder?.(task)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ds-border p-5 dark:border-ds-border-strong">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{order.number}</h2>
            {order.urgentRequested && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${order.urgentApproved ? 'bg-ds-warning-subtle text-ds-warning' : 'bg-ds-surface text-ds-muted dark:bg-ds-subtle dark:text-ds-muted'}`}
              >
                {order.urgentApproved ? '紧急已批准' : '紧急待审批'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ds-muted">
            {order.createdByName} · {formatDate(order.createdAt)}
          </p>
        </div>
        {(order.status === 'queued' || order.status === 'running') && (
          <button
            type="button"
            onClick={() => onCancelOrder(order.id)}
            className="flex min-h-ds-control-lg items-center gap-2 rounded-lg border border-ds-danger/35 px-3 py-2 text-sm text-ds-danger hover:bg-ds-danger-subtle dark:border-ds-danger dark:hover:bg-ds-danger/30"
          >
            <X size={15} />
            取消未完成任务
          </button>
        )}
      </div>
      <div className="p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ['状态', statusLabel[order.status]],
            ['总量', `${order.totalImages} 张`],
            ['已完成', `${order.completedImages} 张`],
            ['预计完成', order.estimatedFinishedAt ? formatDate(order.estimatedFinishedAt) : '计算中'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-ds-lg bg-ds-surface p-3 dark:bg-ds-scrim">
              <span className="block text-xs text-ds-muted">{label}</span>
              <strong className="mt-1 block text-sm">{value}</strong>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <div className="mb-2 flex justify-between text-xs text-ds-muted">
            <span>整体进度</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ds-surface dark:bg-ds-subtle">
            <div className="h-full rounded-full bg-ds-primary transition" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-ds-lg border border-ds-border dark:border-ds-border-strong">
          {order.units.map((unit, index) => (
            <div
              key={unit.id}
              className="flex flex-wrap items-center gap-3 border-b border-ds-border px-4 py-3 last:border-0 dark:border-ds-border-strong"
            >
              <span className="flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-lg bg-ds-surface text-xs text-ds-muted dark:bg-ds-subtle">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {productById.get(unit.productId)} · {channelById.get(unit.channelId)} · {unit.ratio} ·{' '}
                  {typeById.get(unit.materialTypeId)}
                </p>
                <p className="mt-0.5 text-xs text-ds-muted">
                  {unit.quantity} 张{unit.error ? ` · ${unit.error}` : ''}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  unit.status === 'done'
                    ? 'bg-ds-success-subtle text-ds-success dark:bg-ds-success/30 dark:text-ds-success'
                    : unit.status === 'error'
                      ? 'bg-ds-danger-subtle text-ds-danger dark:bg-ds-danger/30 dark:text-ds-danger'
                      : unit.status === 'running'
                        ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary'
                        : 'bg-ds-surface text-ds-muted dark:bg-ds-subtle dark:text-ds-muted'
                }`}
              >
                {unit.status === 'done'
                  ? '完成'
                  : unit.status === 'error'
                    ? '失败'
                    : unit.status === 'running'
                      ? '生成中'
                      : unit.status === 'cancelled'
                        ? '已取消'
                        : '排队中'}
              </span>
              {unit.taskId && onOpenTaskFolder && (
                <button
                  type="button"
                  onClick={() => openUnitFolder(unit.taskId)}
                  className="flex h-ds-control-lg w-ds-control-lg items-center justify-center rounded-lg text-ds-muted hover:bg-ds-subtle dark:hover:bg-ds-subtle"
                  title="打开结果目录"
                  aria-label="打开结果目录"
                >
                  <FolderOpen size={16} />
                </button>
              )}
              {unit.status === 'error' && (
                <button
                  type="button"
                  onClick={() => onRetryUnit(order.id, unit.id)}
                  className="flex min-h-ds-control-lg items-center gap-1 rounded-lg border border-ds-border px-2.5 py-1.5 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
                >
                  <RefreshCw size={13} />
                  重试
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default function OrderingHistory({
  catalog,
  currentUserId,
  canViewAll,
  orders,
  tasks,
  selectedOrderId,
  onSelectOrder,
  onCancelOrder,
  onRetryUnit,
  onOpenTaskFolder,
}: OrderingHistoryProps) {
  const visible = canViewAll ? orders : orders.filter((item) => item.createdBy === currentUserId)
  const selected = visible.find((item) => item.id === selectedOrderId) ?? visible[0]

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="self-start overflow-hidden">
        <div className="border-b border-ds-border p-4 dark:border-ds-border-strong">
          <h2 className="font-semibold">需求任务</h2>
          <p className="mt-1 text-xs text-ds-muted">共 {visible.length} 个订单</p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto overscroll-contain">
          {visible.length === 0 && <div className="p-8 text-center text-sm text-ds-muted">暂无任务</div>}
          {visible.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => onSelectOrder(order.id)}
              className={`flex min-h-ds-16 w-full items-center gap-3 border-b border-ds-border p-4 text-left dark:border-ds-border-strong ${selected?.id === order.id ? 'bg-ds-primary-subtle dark:bg-ds-primary-subtle/20' : 'hover:bg-ds-subtle dark:hover:bg-ds-subtle'}`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${order.status === 'completed' ? 'bg-ds-success' : order.status === 'failed' ? 'bg-ds-danger' : order.status === 'running' ? 'bg-ds-primary' : 'bg-ds-subtle'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{order.number}</span>
                <span className="mt-1 block text-xs text-ds-muted">
                  {statusLabel[order.status]} · {order.totalImages} 张
                </span>
              </span>
              <ChevronRight size={15} className="text-ds-muted" />
            </button>
          ))}
        </div>
      </Card>
      {selected ? (
        <OrderDetail
          order={selected}
          catalog={catalog}
          tasks={tasks}
          onCancelOrder={onCancelOrder}
          onRetryUnit={onRetryUnit}
          onOpenTaskFolder={onOpenTaskFolder}
        />
      ) : (
        <Card className="flex min-h-80 items-center justify-center text-sm text-ds-muted">选择一个任务查看详情</Card>
      )}
    </div>
  )
}
