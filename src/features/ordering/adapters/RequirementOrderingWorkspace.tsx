import { useState } from 'react'
import { ClipboardPlusIcon as ClipboardPlus, ListChecksIcon as ListChecks } from '../../../design-system/icons'
import { openInExplorer } from '../../../lib/localSave'
import { useStore } from '../../../store'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import OrderingCreate from '../OrderingCreate'
import OrderingHistory from '../OrderingHistory'
import type { OrderingOrder } from '../types'

function useOrderingHostData() {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const users = useRequirementPrototype((state) => state.users)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const settings = useRequirementPrototype((state) => state.settings)
  const orders = useRequirementPrototype((state) => state.orders)
  const selectedOrderId = useRequirementPrototype((state) => state.selectedOrderId)
  const remainingQuota = useRequirementPrototype((state) => state.remainingQuota)
  const createOrder = useRequirementPrototype((state) => state.createOrder)
  const selectOrder = useRequirementPrototype((state) => state.selectOrder)
  const cancelOrder = useRequirementPrototype((state) => state.cancelOrder)
  const retryUnit = useRequirementPrototype((state) => state.retryUnit)
  const tasks = useStore((state) => state.tasks)
  const user = users.find((item) => item.id === sessionUserId)

  return {
    sessionUserId: sessionUserId ?? '',
    user,
    catalog,
    settings,
    orders,
    selectedOrderId,
    remainingQuota: remainingQuota(sessionUserId ?? ''),
    createOrder,
    selectOrder,
    cancelOrder,
    retryUnit,
    tasks,
  }
}

export function RequirementOrderingCreatePage() {
  const host = useOrderingHostData()
  return (
    <OrderingCreate
      catalog={host.catalog}
      settings={host.settings}
      currentUserId={host.sessionUserId}
      remainingQuota={host.remainingQuota}
      orders={host.orders}
      onCreateOrder={host.createOrder}
    />
  )
}

export function RequirementOrderingHistoryPage() {
  const host = useOrderingHostData()
  return (
    <OrderingHistory
      catalog={host.catalog}
      currentUserId={host.sessionUserId}
      canViewAll={host.user?.role === 'admin'}
      orders={host.orders}
      tasks={host.tasks}
      selectedOrderId={host.selectedOrderId}
      onSelectOrder={host.selectOrder}
      onCancelOrder={host.cancelOrder}
      onRetryUnit={host.retryUnit}
      onOpenTaskFolder={(task) => task.scheduledOutputPath && void openInExplorer(task.scheduledOutputPath)}
    />
  )
}

export default function RequirementOrderingWorkspace() {
  const host = useOrderingHostData()
  const canCreate = host.user?.role === 'optimizer'
  const [view, setView] = useState<'create' | 'history'>(canCreate ? 'create' : 'history')
  const [selectedOrderId, setSelectedOrderId] = useState(host.selectedOrderId)

  const createWithoutLeavingWorkspace = (draft: Parameters<typeof host.createOrder>[0]) => {
    const result = host.createOrder(draft)
    if (result.order) {
      useRequirementPrototype.setState({ route: 'legacy', selectedOrderId: result.order.id })
      setSelectedOrderId(result.order.id)
    }
    return result
  }

  const showCreatedOrder = (order: OrderingOrder) => {
    setSelectedOrderId(order.id)
    setView('history')
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-ds-surface text-ds-text dark:bg-ds-scrim dark:text-ds-text-subtle">
      <div className="border-b border-ds-border bg-ds-surface dark:border-ds-border-strong dark:bg-ds-scrim">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold">下单中心</h1>
            <p className="mt-1 text-sm text-ds-muted">组合产品、渠道和素材策略，提交生成并跟踪任务。</p>
          </div>
          <nav
            className="flex rounded-ds-lg border border-ds-border bg-ds-surface/70 p-1 dark:border-ds-border-strong dark:bg-ds-subtle/60"
            aria-label="下单中心导航"
          >
            {canCreate && (
              <button
                type="button"
                onClick={() => setView('create')}
                className={`flex min-h-ds-control-lg items-center gap-2 rounded-lg px-4 text-sm transition ${view === 'create' ? 'bg-ds-surface font-medium text-ds-primary shadow-sm dark:bg-ds-scrim dark:text-ds-primary' : 'text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-white'}`}
              >
                <ClipboardPlus size={16} />
                新建需求
              </button>
            )}
            <button
              type="button"
              onClick={() => setView('history')}
              className={`flex min-h-ds-control-lg items-center gap-2 rounded-lg px-4 text-sm transition ${view === 'history' ? 'bg-ds-surface font-medium text-ds-primary shadow-sm dark:bg-ds-scrim dark:text-ds-primary' : 'text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-white'}`}
            >
              <ListChecks size={16} />
              {host.user?.role === 'admin' ? '全部任务' : '我的任务'}
            </button>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] p-5">
        {view === 'create' && canCreate ? (
          <OrderingCreate
            catalog={host.catalog}
            settings={host.settings}
            currentUserId={host.sessionUserId}
            remainingQuota={host.remainingQuota}
            orders={host.orders}
            onCreateOrder={createWithoutLeavingWorkspace}
            onCreated={showCreatedOrder}
          />
        ) : (
          <OrderingHistory
            catalog={host.catalog}
            currentUserId={host.sessionUserId}
            canViewAll={host.user?.role === 'admin'}
            orders={host.orders}
            tasks={host.tasks}
            selectedOrderId={selectedOrderId}
            onSelectOrder={setSelectedOrderId}
            onCancelOrder={host.cancelOrder}
            onRetryUnit={host.retryUnit}
            onOpenTaskFolder={(task) => task.scheduledOutputPath && void openInExplorer(task.scheduledOutputPath)}
          />
        )}
      </main>
    </div>
  )
}
