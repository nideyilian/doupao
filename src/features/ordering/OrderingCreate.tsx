import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangleIcon as AlertTriangle,
  CheckIcon as Check,
  ClipboardPlusIcon as ClipboardPlus,
  MinusIcon as Minus,
  PlusIcon as Plus,
  ZapIcon as Zap,
} from '../../design-system/icons'
import { planOrderingOrder } from './planner'
import type {
  CreateOrderingOrder,
  OrderingCatalog,
  OrderingChannel,
  OrderingDraft,
  OrderingOrder,
  OrderingSettings,
} from './types'

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-ds-xl border border-ds-border bg-ds-surface shadow-sm dark:border-ds-border-strong dark:bg-ds-scrim ${className}`}
    >
      {children}
    </section>
  )
}

function SelectorCard({
  selected,
  title,
  subtitle,
  badge,
  onClick,
}: {
  selected: boolean
  title: string
  subtitle: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative min-h-24 rounded-ds-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-ds-focus ${
        selected
          ? 'border-ds-primary bg-ds-primary-subtle shadow-sm dark:bg-ds-primary-subtle/30'
          : 'border-ds-border bg-ds-surface hover:border-ds-primary/35 hover:bg-ds-subtle dark:border-ds-border-strong dark:bg-ds-scrim dark:hover:bg-ds-subtle'
      }`}
    >
      <span className="block pr-7 font-medium text-ds-text dark:text-ds-text-subtle">{title}</span>
      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-ds-muted dark:text-ds-muted">{subtitle}</span>
      {badge && (
        <span className="mt-2 inline-block rounded-full bg-ds-surface px-2 py-0.5 text-xs text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
          {badge}
        </span>
      )}
      <span
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-ds-primary bg-ds-primary text-ds-text-inverse' : 'border-ds-border dark:border-ds-border-strong'}`}
      >
        {selected && <Check size={13} />}
      </span>
    </button>
  )
}

export interface OrderingCreateProps {
  catalog: OrderingCatalog
  settings: OrderingSettings
  currentUserId: string
  remainingQuota: number
  orders: OrderingOrder[]
  onCreateOrder: CreateOrderingOrder
  onCreated?: (order: OrderingOrder) => void
}

export default function OrderingCreate({
  catalog,
  settings,
  currentUserId,
  remainingQuota,
  orders,
  onCreateOrder,
  onCreated,
}: OrderingCreateProps) {
  const [draft, setDraft] = useState<OrderingDraft>({
    productIds: [],
    channels: [],
    materialTypeIds: [],
    quantity: settings.defaultQuantity,
    urgentRequested: false,
    urgentReason: '',
    urgentTargetMinutes: 60,
  })
  const [message, setMessage] = useState('')

  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const order of orders.filter((item) => item.createdBy === currentUserId)) {
      for (const productId of order.draft.productIds) map.set(productId, (map.get(productId) ?? 0) + 1)
    }
    return map
  }, [currentUserId, orders])

  const products = useMemo(
    () =>
      catalog.products
        .filter((item) => item.published && !item.archived)
        .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)),
    [catalog.products, usage],
  )
  const preview = useMemo(
    () =>
      planOrderingOrder(draft, catalog, {
        maxImagesPerOrder: settings.maxImagesPerOrder,
        remainingDailyQuota: remainingQuota,
      }),
    [catalog, draft, remainingQuota, settings.maxImagesPerOrder],
  )

  const toggleProduct = (id: string) =>
    setDraft((current) => ({
      ...current,
      productIds: current.productIds.includes(id)
        ? current.productIds.filter((item) => item !== id)
        : [...current.productIds, id],
    }))
  const toggleType = (id: string) =>
    setDraft((current) => ({
      ...current,
      materialTypeIds: current.materialTypeIds.includes(id)
        ? current.materialTypeIds.filter((item) => item !== id)
        : [...current.materialTypeIds, id],
    }))
  const toggleChannel = (channel: OrderingChannel) =>
    setDraft((current) => ({
      ...current,
      channels: current.channels.some((item) => item.channelId === channel.id)
        ? current.channels.filter((item) => item.channelId !== channel.id)
        : [...current.channels, { channelId: channel.id, ratios: [...channel.ratios] }],
    }))
  const toggleRatio = (channelId: string, ratio: '16:9' | '9:16') =>
    setDraft((current) => ({
      ...current,
      channels: current.channels.map((item) =>
        item.channelId !== channelId
          ? item
          : {
              ...item,
              ratios: item.ratios.includes(ratio)
                ? item.ratios.filter((value) => value !== ratio)
                : [...item.ratios, ratio],
            },
      ),
    }))

  const submit = () => {
    const result = onCreateOrder(draft)
    if (result.error) {
      setMessage(result.error)
      return
    }
    setMessage('')
    if (result.order) onCreated?.(result.order)
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ds-text dark:text-white">1. 选择产品</h2>
              <p className="mt-1 text-sm text-ds-muted">常用 SKU 已根据你的下单记录优先排列，可多选。</p>
            </div>
            <span className="shrink-0 text-sm text-ds-muted">已选 {draft.productIds.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {products.map((product) => (
              <SelectorCard
                key={product.id}
                selected={draft.productIds.includes(product.id)}
                title={product.name}
                subtitle={product.summary}
                badge={(usage.get(product.id) ?? 0) > 0 ? `常用 ${usage.get(product.id)} 次` : product.category}
                onClick={() => toggleProduct(product.id)}
              />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ds-text dark:text-white">2. 选择渠道与尺寸</h2>
              <p className="mt-1 text-sm text-ds-muted">勾选渠道后默认同时生成横版和竖版，可单独取消尺寸。</p>
            </div>
            <span className="shrink-0 text-sm text-ds-muted">已选 {draft.channels.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {catalog.channels
              .filter((item) => item.published && !item.archived)
              .map((channel) => {
                const selection = draft.channels.find((item) => item.channelId === channel.id)
                return (
                  <div
                    key={channel.id}
                    className={`rounded-ds-lg border p-4 ${selection ? 'border-ds-primary bg-ds-primary-subtle dark:bg-ds-primary-subtle/30' : 'border-ds-border dark:border-ds-border-strong'}`}
                  >
                    <button
                      type="button"
                      aria-pressed={Boolean(selection)}
                      onClick={() => toggleChannel(channel)}
                      className="flex min-h-ds-control-lg w-full items-start justify-between text-left"
                    >
                      <span>
                        <span className="block font-medium text-ds-text dark:text-white">{channel.name}</span>
                        <span className="mt-1 block text-xs text-ds-muted">{channel.summary}</span>
                      </span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border ${selection ? 'border-ds-primary bg-ds-primary text-ds-text-inverse' : 'border-ds-border'}`}
                      >
                        {selection && <Check size={13} />}
                      </span>
                    </button>
                    {selection && (
                      <div className="mt-4 flex gap-2 border-t border-ds-primary/35 pt-3 dark:border-ds-primary">
                        {channel.ratios.map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            aria-pressed={selection.ratios.includes(ratio)}
                            onClick={() => toggleRatio(channel.id, ratio)}
                            className={`min-h-ds-control-lg rounded-lg px-3 py-1.5 text-xs font-medium ${selection.ratios.includes(ratio) ? 'bg-ds-primary text-ds-text-inverse' : 'bg-ds-surface text-ds-muted dark:bg-ds-subtle dark:text-ds-muted'}`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ds-text dark:text-white">3. 选择素材类型</h2>
              <p className="mt-1 text-sm text-ds-muted">固定规则会严格匹配已发布规范，其余类型使用智能差异化策略。</p>
            </div>
            <span className="shrink-0 text-sm text-ds-muted">已选 {draft.materialTypeIds.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {catalog.materialTypes
              .filter((item) => item.published && !item.archived)
              .map((type) => (
                <SelectorCard
                  key={type.id}
                  selected={draft.materialTypeIds.includes(type.id)}
                  title={type.name}
                  subtitle={type.summary}
                  badge={type.mode === 'fixed' ? `固定规则 · v${type.version}` : `智能策略 · v${type.version}`}
                  onClick={() => toggleType(type.id)}
                />
              ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ds-text dark:text-white">4. 设置每组合数量</h2>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {settings.quantityShortcuts.map((quantity) => (
              <button
                key={quantity}
                type="button"
                aria-pressed={draft.quantity === quantity}
                onClick={() => setDraft((current) => ({ ...current, quantity }))}
                className={`min-h-ds-control-lg rounded-lg border px-4 text-sm ${draft.quantity === quantity ? 'border-ds-primary bg-ds-primary text-ds-text-inverse' : 'border-ds-border bg-ds-surface text-ds-text hover:border-ds-primary/35 dark:border-ds-border-strong dark:bg-ds-scrim dark:text-ds-text-subtle'}`}
              >
                {quantity}
              </button>
            ))}
            <div className="ml-1 flex h-ds-control-lg items-center overflow-hidden rounded-lg border border-ds-border dark:border-ds-border-strong">
              <button
                type="button"
                aria-label="减少数量"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    quantity: Math.max(1, current.quantity - settings.quantityStep),
                  }))
                }
                className="h-full min-w-11 px-3 hover:bg-ds-subtle dark:hover:bg-ds-subtle"
              >
                <Minus size={15} />
              </button>
              <span className="w-16 text-center text-sm font-semibold">{draft.quantity}</span>
              <button
                type="button"
                aria-label="增加数量"
                onClick={() =>
                  setDraft((current) => ({ ...current, quantity: current.quantity + settings.quantityStep }))
                }
                className="h-full min-w-11 px-3 hover:bg-ds-subtle dark:hover:bg-ds-subtle"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle p-4 dark:border-ds-warning dark:bg-ds-warning/20">
            <input
              type="checkbox"
              checked={draft.urgentRequested}
              onChange={(event) => setDraft((current) => ({ ...current, urgentRequested: event.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-ds-border text-ds-warning focus:ring-amber-500"
            />
            <span className="flex-1">
              <span className="flex items-center gap-2 font-medium text-ds-warning dark:text-ds-warning">
                <Zap size={16} />
                申请紧急单
              </span>
              <span className="mt-1 block text-xs text-ds-warning dark:text-ds-warning">
                提交后由管理员审批，审批通过才会提升队列优先级。
              </span>
              {draft.urgentRequested && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([30, 60, 120] as const).map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        aria-pressed={draft.urgentTargetMinutes === minutes}
                        onClick={() => setDraft((current) => ({ ...current, urgentTargetMinutes: minutes }))}
                        className={`min-h-ds-control-lg rounded-lg px-3 py-1.5 text-xs ${draft.urgentTargetMinutes === minutes ? 'bg-ds-warning text-ds-text-inverse' : 'bg-ds-surface text-ds-warning dark:bg-ds-scrim dark:text-ds-warning'}`}
                      >
                        {minutes < 60 ? '30 分钟' : `${minutes / 60} 小时`}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={draft.urgentReason}
                    onChange={(event) => setDraft((current) => ({ ...current, urgentReason: event.target.value }))}
                    placeholder="填写紧急原因"
                    className="mt-3 min-h-20 w-full rounded-lg border border-ds-warning/35 bg-ds-surface p-3 text-sm text-ds-text outline-none focus:ring-2 focus:ring-amber-300 dark:bg-ds-scrim dark:text-ds-text-subtle"
                  />
                </>
              )}
            </span>
          </label>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-5 xl:self-start">
        <Card className="overflow-hidden">
          <div className="border-b border-ds-border p-5 dark:border-ds-border-strong">
            <h2 className="font-semibold text-ds-text dark:text-white">下单摘要</h2>
            <p className="mt-1 text-xs text-ds-muted">无效组合会自动排除，不影响其他组合。</p>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-ds-lg bg-ds-surface p-4 dark:bg-ds-scrim">
              <div className="flex items-end justify-between">
                <span className="text-sm text-ds-muted">预计生成</span>
                <span className="text-3xl font-semibold text-ds-text dark:text-white">
                  {preview.totalImages}
                  <small className="ml-1 text-sm font-normal text-ds-muted">张</small>
                </span>
              </div>
              <div className="mt-3 text-xs leading-5 text-ds-muted">
                {draft.productIds.length || 0} 产品 ×{' '}
                {draft.channels.reduce((sum, item) => sum + item.ratios.length, 0)} 渠道尺寸 ×{' '}
                {draft.materialTypeIds.length || 0} 类型 × {draft.quantity} 张
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-ds-border p-3 dark:border-ds-border-strong">
                <span className="block text-xs text-ds-muted">有效任务</span>
                <strong className="mt-1 block">{preview.units.length} 个</strong>
              </div>
              <div className="rounded-lg border border-ds-border p-3 dark:border-ds-border-strong">
                <span className="block text-xs text-ds-muted">今日剩余额度</span>
                <strong className="mt-1 block">{remainingQuota} 张</strong>
              </div>
            </div>
            {preview.excluded.length > 0 && (
              <div className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle p-3 text-xs text-ds-warning dark:border-ds-warning dark:bg-ds-warning/20 dark:text-ds-warning">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <AlertTriangle size={14} />
                  已排除 {preview.excluded.length} 个不兼容组合
                </div>
                {preview.excluded.slice(0, 4).map((item) => (
                  <p key={`${item.productId}-${item.channelId}-${item.ratio}-${item.materialTypeId}`}>
                    · {item.ratio}：{item.reason}
                  </p>
                ))}
              </div>
            )}
            {(message || preview.errors.length > 0) && (
              <div
                role="alert"
                className="rounded-ds-lg bg-ds-danger-subtle p-3 text-xs leading-5 text-ds-danger dark:bg-ds-danger/30 dark:text-ds-danger"
              >
                {message || preview.errors[0]}
              </div>
            )}
            <button
              type="button"
              disabled={!preview.valid || (draft.urgentRequested && !draft.urgentReason?.trim())}
              onClick={submit}
              className="flex min-h-ds-12 w-full items-center justify-center gap-2 rounded-ds-lg bg-ds-primary font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover disabled:cursor-not-allowed disabled:bg-ds-subtle dark:disabled:bg-ds-subtle"
            >
              <ClipboardPlus size={18} />
              确认下单
            </button>
            <p className="text-center text-xs text-ds-muted">提交后直接进入生成队列，不再二次确认</p>
          </div>
        </Card>
      </aside>
    </div>
  )
}
