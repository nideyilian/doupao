import { memo, useEffect, useState } from 'react'
import { Button, Checkbox, Dialog, Progress } from '../../design-system'
import { TrashIcon } from '../../design-system/icons'
import type { AssetPurgePlan } from '../../lib/assetPurge'
import type { PurgeGeneratedAssetsProgress } from '../../store'
import { useAssetLibraryStore } from './store'

export interface AssetPurgeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 请求永久删除的素材 id；打开时自动预览引用冲突 */
  assetIds: string[]
  /** 操作说明，如“清空回收站”“永久删除选中素材” */
  title?: string
  /** 打开时默认勾选「解除引用并彻底删除」（清空回收站等希望一次清空的场景） */
  forceByDefault?: boolean
  onExecuted?: (result: { purged: string[]; blocked: unknown[]; detachedRefCount?: number }) => void
}

function assetLabel(id: string, fallback: string) {
  const asset = useAssetLibraryStore.getState().assetsById[id]
  const origin = asset?.origins.find((item) => item.key === asset.primaryOriginKey) ?? asset?.origins[0]
  const prompt = origin?.prompt?.trim()
  if (prompt) return prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt
  return fallback
}

/** 引用类型 → 用户可读归类 */
const REFERENCE_TYPE_LABELS: Record<string, string> = {
  'asset-origin-input': '被其他素材用作输入图',
  'task-input': '被任务作为输入图',
  mask: '被作为遮罩/遮罩目标',
  'gallery-draft': '在工作区/输入中',
  'agent-draft': '在 Agent 草稿中',
  'agent-conversation': '被 Agent 会话引用',
  'sop-reference': '被 SOP 批量任务引用',
  'sop-cover': '用作 SOP 封面',
  'strategy-reference': '被策略模块引用',
  'strategy-cover': '用作策略封面',
  ordering: '被排单任务引用',
  postprocess: '被后期处理引用',
  composite: '被合成处理引用',
  'asset-original': '素材原图',
}

function blockedReasonSummary(plan: AssetPurgePlan): { type: string; label: string; count: number }[] {
  const byType = new Map<string, number>()
  for (const item of plan.blocked) {
    const types = new Set(item.references.map((ref) => ref.type))
    for (const type of types) byType.set(type, (byType.get(type) ?? 0) + 1)
  }
  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, label: REFERENCE_TYPE_LABELS[type] ?? type, count }))
}

function progressLabel(progress: PurgeGeneratedAssetsProgress | null): string {
  if (!progress) return '正在删除…'
  switch (progress.phase) {
    case 'preparing':
      return '正在读取素材并制定删除计划…'
    case 'records':
      return '正在删除素材记录…'
    case 'images':
      return progress.total ? `正在清理图片文件 ${progress.done}/${progress.total}` : '正在清理图片文件…'
    default:
      return '正在删除…'
  }
}

function AssetPurgeModalInner({
  assetIds,
  forceByDefault = false,
  onExecuted,
  onOpenChange,
  open,
  title = '永久删除素材',
}: AssetPurgeModalProps) {
  const [plan, setPlan] = useState<AssetPurgePlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  // 执行期真实进度（Eagle 式反馈）：preparing → records → images(done/total)
  const [progress, setProgress] = useState<PurgeGeneratedAssetsProgress | null>(null)

  useEffect(() => {
    if (!open || assetIds.length === 0) return
    let cancelled = false
    setPlan(null)
    setError(null)
    setProgress(null)
    setForce(forceByDefault)
    setLoading(true)
    void import('../../store')
      .then(({ planPurgeGeneratedAssets }) => planPurgeGeneratedAssets(assetIds))
      .then((nextPlan) => {
        if (!cancelled) setPlan(nextPlan)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '预览失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [assetIds, forceByDefault, open])

  const confirm = async () => {
    if (executing) return
    setExecuting(true)
    setError(null)
    setProgress({ phase: 'preparing' })
    try {
      const { purgeGeneratedAssets } = await import('../../store')
      const result = await purgeGeneratedAssets(assetIds, {
        // force 时无法复用普通预览计划（被引用素材也要进入删除列表），由 purge 内部重新规划
        plan: force ? undefined : (plan ?? undefined),
        force,
        onProgress: setProgress,
      })
      const { useStore } = await import('../../store')
      if (force) {
        if (result.detachedRefCount) {
          useStore
            .getState()
            .showToast(`已彻底删除 ${result.purged.length} 张素材，并解除 ${result.detachedRefCount} 处引用`, 'success')
        } else {
          useStore.getState().showToast(`已删除 ${result.purged.length} 张素材`, 'success')
        }
      } else if (result.blocked.length > 0) {
        useStore.getState().showToast(`${result.blocked.length} 张素材被其他任务或工作区引用，已保留`, 'info')
      }
      onExecuted?.(result)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setExecuting(false)
      setProgress(null)
    }
  }

  const allowedCount = plan?.allowedAssetIds.length ?? 0
  const blockedCount = plan?.blocked.length ?? 0
  const totalCount = allowedCount + blockedCount
  const showForceOption = blockedCount > 0 && !loading && !executing

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        if (!executing) onOpenChange(false)
      }}
      title={title}
      description="永久删除会释放素材原图；被其他任务、工作区或 SOP 引用的素材默认保留，勾选「解除引用并彻底删除」可一并清除。"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={executing}>
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={loading || executing || (!force && allowedCount === 0)}
            data-testid="asset-purge-confirm"
          >
            {executing
              ? '删除中…'
              : force
                ? `彻底删除 ${totalCount > 0 ? `${totalCount} 张` : ''}`
                : `永久删除${allowedCount > 0 ? ` ${allowedCount} 张` : ''}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="asset-purge-modal">
        {loading && <p className="text-sm text-ds-muted">正在检查引用…</p>}

        {error && <p className="text-sm text-ds-danger">预览失败：{error}</p>}

        {executing && (
          <div className="space-y-2" data-testid="asset-purge-progress">
            <Progress
              label={progressLabel(progress)}
              value={progress?.phase === 'images' ? progress.done : undefined}
              max={progress?.total ?? 100}
              showValue
              tone="danger"
            />
            <p className="text-xs text-ds-muted">删除过程中请勿关闭窗口；完成后素材会立即从网格消失。</p>
          </div>
        )}

        {plan && !loading && !executing && (
          <>
            <p className="text-sm">
              {force ? (
                <>
                  将彻底删除全部 <strong className="tabular-nums">{totalCount}</strong> 张素材
                  {blockedCount > 0 && <>（含解除引用保留的 {blockedCount} 张）</>}。
                </>
              ) : (
                <>
                  将永久删除 <strong className="tabular-nums">{allowedCount}</strong> 张素材
                  {blockedCount > 0 && (
                    <>
                      ，<strong className="tabular-nums">{blockedCount}</strong> 张因仍被引用而保留
                    </>
                  )}
                  。
                </>
              )}
            </p>

            {blockedCount > 0 && (
              <>
                <div className="space-y-1 rounded-md border border-ds-border bg-ds-muted/5 p-2">
                  <p className="text-xs font-medium text-ds-muted">保留原因（按引用类型统计）</p>
                  {blockedReasonSummary(plan).map((entry) => (
                    <p key={entry.type} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ds-text">{entry.label}</span>
                      <span className="tabular-nums text-ds-muted">{entry.count} 张</span>
                    </p>
                  ))}
                  <p className="text-xs text-ds-muted">
                    这些素材仍被任务、工作区或素材输入引用，删除会破坏引用链，故默认保留。
                  </p>
                </div>

                {showForceOption && (
                  <Checkbox
                    checked={force}
                    onChange={setForce}
                    tone="danger"
                    data-testid="asset-purge-force"
                    label="解除引用并彻底删除"
                    description={`勾选后，被引用的 ${blockedCount} 张素材也会一并删除；任务输入、工作区输入、Agent 会话、SOP 与策略等处的引用会被同步解除，不可恢复。`}
                  />
                )}

                <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-ds-border p-2">
                  {plan.blocked.map((item) => (
                    <div key={item.assetId} className="rounded-md bg-ds-muted/10 px-2 py-1.5 text-xs">
                      <p className="font-medium">「{assetLabel(item.assetId, item.assetId)}」无法删除</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ds-muted">
                        {item.references.map((reference, index) => (
                          <li key={`${reference.type}:${reference.ownerId}:${index}`}>{reference.label}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}

            {(allowedCount > 0 || force) && (
              <p className="flex items-center gap-1.5 text-xs text-ds-muted">
                <TrashIcon size={13} /> 此操作不可撤销，删除后原图与缩略图将被释放。
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

export default memo(AssetPurgeModalInner)
