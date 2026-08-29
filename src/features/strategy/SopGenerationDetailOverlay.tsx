import { PencilIcon as Pencil, RefreshIcon as RefreshCw } from '../../design-system/icons'
import { Badge, Button, StatusIndicator } from '../../design-system'
import type { SopGenerationRecord } from '../../types'

/**
 * SOP 生成记录详情浮层：完整展示一次智能生成的输入（说明/参考图/元指令）、结果或失败原因。
 * 由 SOP 管理中心内联实现拆出，行为与原来完全一致。
 */
export default function SopGenerationDetailOverlay({
  record,
  running,
  onEdit,
  onRegenerate,
  onBack,
}: {
  record: SopGenerationRecord
  running: boolean
  onEdit: (record: SopGenerationRecord) => void
  onRegenerate: (record: SopGenerationRecord) => void
  onBack: () => void
}) {
  const title = record.result?.name ?? record.metaInstruction.name

  return (
    <div className="sop-center-generation-detail-overlay" aria-label={`生成记录详情 ${title}`}>
      <section className="sop-center-generation-detail">
        <header className="sop-center-generation-detail-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate font-semibold">{title}</h3>
              <StatusIndicator
                tone={record.status === 'success' ? 'success' : record.status === 'error' ? 'danger' : 'info'}
                pulse={record.status === 'running'}
              >
                {record.status === 'success' ? '生成成功' : record.status === 'error' ? '生成失败' : '生成中'}
              </StatusIndicator>
            </div>
            <div className="sop-center-generation-detail-meta">
              <span>{new Date(record.createdAt).toLocaleString('zh-CN')}</span>
              {record.targetGroup?.name && <Badge tone="neutral">{record.targetGroup.name}</Badge>}
              {record.elapsedMs !== undefined && <span>{(record.elapsedMs / 1000).toFixed(1)} 秒</span>}
              <span>{record.referenceImages.length} 张参考图</span>
            </div>
          </div>
          <div className="sop-center-generation-detail-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => onEdit(record)}
              leadingIcon={<Pencil size={13} />}
            >
              编辑输入
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={running}
              onClick={() => onRegenerate(record)}
              leadingIcon={<RefreshCw size={13} />}
            >
              重新生成
            </Button>
            <Button variant="secondary" size="sm" onClick={onBack}>
              返回记录
            </Button>
          </div>
        </header>

        <div className="sop-center-generation-detail-body">
          <section className="sop-center-generation-detail-section">
            <h4>生成说明</h4>
            <pre aria-label="生成记录完整生成说明">{record.brief || '未填写生成说明'}</pre>
          </section>

          <section className="sop-center-generation-detail-section">
            <h4>参考图片 · {record.referenceImages.length} 张</h4>
            {record.referenceImages.length > 0 ? (
              <div className="sop-center-generation-detail-images">
                {record.referenceImages.map((image, index) => (
                  <figure key={image.id}>
                    <img src={image.dataUrl} alt={`生成记录参考图 ${index + 1}：${image.name}`} loading="lazy" />
                    <figcaption>
                      图 {index + 1} · {image.name}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="sop-center-generation-detail-empty">本次未使用参考图片。</p>
            )}
          </section>

          <section className="sop-center-generation-detail-section">
            <h4>完整元指令 · {record.metaInstruction.name}</h4>
            {record.metaInstruction.description && (
              <p className="sop-center-generation-detail-description">{record.metaInstruction.description}</p>
            )}
            <pre aria-label="生成记录完整元指令">{record.metaInstruction.instruction}</pre>
          </section>

          {record.result && (
            <section className="sop-center-generation-detail-section">
              <h4>完整 SOP 正文 · {record.result.name}</h4>
              {record.result.description && (
                <p className="sop-center-generation-detail-description">{record.result.description}</p>
              )}
              <pre aria-label="生成记录完整 SOP 正文">{record.result.content}</pre>
            </section>
          )}

          {record.error && (
            <section className="sop-center-generation-detail-section" data-tone="danger">
              <h4>失败原因</h4>
              <pre aria-label="生成记录完整失败原因">{record.error}</pre>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
