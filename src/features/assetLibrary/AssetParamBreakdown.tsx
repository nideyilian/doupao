import { memo } from 'react'
import type { GeneratedAssetOrigin, TaskParams } from '../../types'

/**
 * 素材参数解耦展示：把来源快照的参数拆成两组——
 * 1) 共享参数（任务/批次级）：该任务全部输出图共有的请求参数与模型信息（origin.requestedParams / apiModel 等）；
 * 2) 本图专属参数：seed、图级实际生效差异（origin.imageActualParams，来自 actualParamsByImage）、文件名信息。
 *
 * 只读展示，不依赖任务记录存活；任务已删除的素材仍可完整追溯参数。
 */

type ParamKey = keyof TaskParams

interface ParamRow {
  key: string
  label: string
  requested?: string
  actual?: string
}

function formatSize(value: string | undefined): string {
  if (!value || value === 'auto') return '自动'
  return value
}

function formatQuality(value: TaskParams['quality'] | undefined): string {
  if (!value) return '—'
  const map: Record<TaskParams['quality'], string> = { auto: '自动', low: '低', medium: '中', high: '高' }
  return map[value] ?? value
}

function formatFormat(value: TaskParams['output_format'] | undefined): string {
  return value ? value.toUpperCase() : '—'
}

function formatReferenceMode(value: TaskParams['reference_mode'] | undefined): string {
  if (!value) return '—'
  return value === 'cycle' ? '循环参考' : '全部参考'
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return String(value)
}

function formatCompression(value: number | null | undefined): string {
  if (value == null) return '不压缩'
  if (value === 0) return '无损'
  return String(value)
}

function formatBoolean(value: boolean | undefined, label = '开启'): string {
  return value ? label : '关闭'
}

/** 共享参数行（请求值 + 任务级实际差异） */
function buildSharedRows(origin: GeneratedAssetOrigin): ParamRow[] {
  const requested = origin.requestedParams
  const actual = origin.actualParams
  const row = (key: string, label: string, requestedValue: string, actualValue?: string): ParamRow => ({
    key,
    label,
    requested: requestedValue,
    actual: actualValue,
  })
  const rows: ParamRow[] = []
  if (origin.apiModel) {
    rows.push(
      row(
        'apiModel',
        '模型',
        origin.apiProfileName ? `${origin.apiProfileName} · ${origin.apiModel}` : origin.apiModel,
      ),
    )
  }
  rows.push(
    row('size', '尺寸', formatSize(requested.size), actual?.size ? formatSize(actual.size) : undefined),
    row(
      'quality',
      '质量',
      formatQuality(requested.quality),
      actual?.quality ? formatQuality(actual.quality) : undefined,
    ),
    row(
      'output_format',
      '格式',
      formatFormat(requested.output_format),
      actual?.output_format ? formatFormat(actual.output_format) : undefined,
    ),
    row(
      'output_compression',
      '压缩',
      formatCompression(requested.output_compression),
      actual?.output_compression != null ? formatCompression(actual.output_compression) : undefined,
    ),
    row('reference_mode', '参考模式', formatReferenceMode(requested.reference_mode)),
    row('n', '数量', formatNumber(requested.n), actual?.n != null ? formatNumber(actual.n) : undefined),
  )
  if (requested.postprocess_resize_enabled) {
    rows.push(
      row('postprocess_resize_enabled', '后处理缩放', formatBoolean(true, `${requested.postprocess_size ?? '自动'}`)),
    )
  }
  if (requested.postprocess_compress_enabled) {
    rows.push(
      row(
        'postprocess_compress_enabled',
        '后处理压缩',
        formatBoolean(
          true,
          `${requested.postprocess_format?.toUpperCase() ?? ''} ≤${requested.postprocess_max_size_kb ?? '?'}KB`,
        ),
      ),
    )
  }
  rows.push(row('moderation', '审核', requested.moderation ?? '—'))
  if (requested.adNegativeRuleId && requested.adNegativeRuleId !== 'general-strict') {
    rows.push(row('adNegativeRuleId', '合规规则', requested.adNegativeRuleId))
  }
  return rows
}

/** 本图专属参数行（seed + 图级实际差异 + 文件名） */
function buildExclusiveRows(origin: GeneratedAssetOrigin): ParamRow[] {
  const requested = origin.requestedParams
  const imageActual = origin.imageActualParams
  const rows: ParamRow[] = []
  const seed = origin.seed ?? imageActual?.seed
  if (seed !== undefined) {
    rows.push({ key: 'seed', label: 'Seed', requested: formatNumber(seed) })
  }
  if (imageActual) {
    for (const [key, value] of Object.entries(imageActual)) {
      if (key === 'seed' || value === undefined || value === null) continue
      if (key === 'size') {
        rows.push({
          key: 'size',
          label: '实际尺寸',
          requested: formatSize(requested.size),
          actual: formatSize(String(value)),
        })
      } else if (key === 'quality') {
        rows.push({
          key: 'quality',
          label: '实际质量',
          requested: formatQuality(requested.quality),
          actual: formatQuality(value as TaskParams['quality']),
        })
      } else if (key === 'output_format') {
        rows.push({
          key: 'output_format',
          label: '实际格式',
          requested: formatFormat(requested.output_format),
          actual: formatFormat(value as TaskParams['output_format']),
        })
      } else if (key === 'output_compression') {
        rows.push({
          key: 'output_compression',
          label: '实际压缩',
          requested: formatCompression(requested.output_compression),
          actual: formatCompression(value as number | null),
        })
      } else {
        rows.push({ key: key as ParamKey, label: `实际 ${key}`, requested: String(value) })
      }
    }
  }
  if (origin.generatedFileNameBase)
    rows.push({ key: 'generatedFileNameBase', label: '文件名', requested: origin.generatedFileNameBase })
  if (origin.filenameLabel) rows.push({ key: 'filenameLabel', label: '文件名批次', requested: origin.filenameLabel })
  if (origin.filenameBatch !== undefined)
    rows.push({ key: 'filenameBatch', label: '批次号', requested: formatNumber(origin.filenameBatch) })
  return rows
}

function ParamRows({ rows }: { rows: ParamRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-ds-muted">—</p>
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-ds-muted">{row.label}</dt>
          <dd className="min-w-0 truncate">
            {row.actual && row.actual !== row.requested ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-ds-muted line-through decoration-ds-muted/50">{row.requested}</span>
                <span className="rounded-sm bg-ds-warning/15 px-1 text-ds-warning" title="API 实际响应值">
                  {row.actual}
                </span>
              </span>
            ) : (
              <span className="text-ds-foreground">{row.requested}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export interface AssetParamBreakdownProps {
  origin: GeneratedAssetOrigin | undefined
  className?: string
}

/** 素材参数解耦展示：共享（任务级）参数与专属（本图）参数分组呈现。 */
function AssetParamBreakdown({ origin, className = '' }: AssetParamBreakdownProps) {
  if (!origin) return null
  const sharedRows = buildSharedRows(origin)
  const exclusiveRows = buildExclusiveRows(origin)
  return (
    <div className={`space-y-3 ${className}`}>
      <section aria-label="任务级共享参数">
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">
          生成参数
          <span className="ml-1 font-normal normal-case text-ds-muted/60">· 任务级共享</span>
        </h4>
        <ParamRows rows={sharedRows} />
      </section>
      {(exclusiveRows.length > 0 || origin.seed !== undefined) && (
        <section aria-label="本图专属参数">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">
            本图专属
            <span className="ml-1 font-normal normal-case text-ds-muted/60">· Seed / 实际差异 / 文件名</span>
          </h4>
          <ParamRows rows={exclusiveRows} />
        </section>
      )}
    </div>
  )
}

export default memo(AssetParamBreakdown)
