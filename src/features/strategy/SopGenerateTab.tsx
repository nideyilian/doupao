import {
  Button,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  SelectField,
  StatusIndicator,
  TextArea,
} from '../../design-system'
import {
  CheckCircleIcon as CheckCircle2,
  CheckIcon as Check,
  CloseIcon as X,
  FileImageIcon as FileImage,
  HistoryIcon as History,
  LoaderCircleIcon as LoaderCircle,
  PencilIcon as Pencil,
  RefreshIcon as RefreshCw,
  SparklesIcon as Sparkles,
  XCircleIcon as XCircle,
} from '../../design-system/icons'
import { useStore } from '../../store'
import { MAX_SOP_REFERENCE_IMAGES, type SopReferenceImage } from './sopGeneration'
import type { SopGenerationRecord } from '../../types'
import type { SopGroup, SopMetaInstruction } from './types'

export type GenerationStepId = 'validate' | 'prepare' | 'request' | 'parse' | 'save'
export type GenerationJobState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  error?: string
  currentStep?: string
}
export type GenerationStepSpec = { id: string; label: string; description: string }
export type ReferenceImageEntry = SopReferenceImage & { id: string }

export type SopGenerateTabProps = {
  metaInstructions: SopMetaInstruction[]
  groups: SopGroup[]
  isPromptReverseGeneration: boolean
  generatorMetaId: string
  setGeneratorMetaId: (id: string) => void
  onClearMetaFallback: () => void
  generatorMetaFallbackName: string | null
  generatorGroupId: string
  setGeneratorGroupId: (id: string) => void
  generatorBrief: string
  setGeneratorBrief: (value: string) => void
  referenceImages: ReferenceImageEntry[]
  setReferenceImages: React.Dispatch<React.SetStateAction<ReferenceImageEntry[]>>
  referenceDragActive: boolean
  handleReferenceDragEnter: (event: React.DragEvent<HTMLLabelElement>) => void
  handleReferenceDragOver: (event: React.DragEvent<HTMLLabelElement>) => void
  handleReferenceDragLeave: (event: React.DragEvent<HTMLLabelElement>) => void
  handleReferenceDrop: (event: React.DragEvent<HTMLLabelElement>) => void
  addReferenceImages: (files: File[]) => Promise<void>
  setAssetPickerOpen: (open: boolean) => void
  job: GenerationJobState
  runGeneration: () => Promise<void>
  cancelGeneration: () => void
  setTab: (tab: 'library' | 'meta' | 'generate') => void
  generationPanel: 'status' | 'history' | 'detail'
  setGenerationPanel: (panel: 'status' | 'history' | 'detail') => void
  generationRecords: SopGenerationRecord[]
  generationRecordsLoading: boolean
  visibleGenerationRecords: SopGenerationRecord[]
  generationHistoryPage: number
  setGenerationHistoryPage: (page: number | ((current: number) => number)) => void
  generationHistoryPageCount: number
  editGenerationRecord: (record: SopGenerationRecord) => void
  regenerateFromRecord: (record: SopGenerationRecord) => Promise<void>
  setSelectedGenerationRecord: (record: SopGenerationRecord | null) => void
  elapsed: number
  generationProgress: number
  completedGenerationSteps: Set<string>
  steps: GenerationStepSpec[]
}

function formatGenerationRecordTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

/** SOP 管理中心「智能生成」标签页：生成表单 + 状态/历史面板。 */
export default function SopGenerateTab({
  metaInstructions,
  groups,
  isPromptReverseGeneration,
  generatorMetaId,
  setGeneratorMetaId,
  onClearMetaFallback,
  generatorMetaFallbackName,
  generatorGroupId,
  setGeneratorGroupId,
  generatorBrief,
  setGeneratorBrief,
  referenceImages,
  setReferenceImages,
  referenceDragActive,
  handleReferenceDragEnter,
  handleReferenceDragOver,
  handleReferenceDragLeave,
  handleReferenceDrop,
  addReferenceImages,
  setAssetPickerOpen,
  job,
  runGeneration,
  cancelGeneration,
  setTab,
  generationPanel,
  setGenerationPanel,
  generationRecords,
  generationRecordsLoading,
  visibleGenerationRecords,
  generationHistoryPage,
  setGenerationHistoryPage,
  generationHistoryPageCount,
  editGenerationRecord,
  regenerateFromRecord,
  setSelectedGenerationRecord,
  elapsed,
  generationProgress,
  completedGenerationSteps,
  steps,
}: SopGenerateTabProps) {
  const showToast = useStore((state) => state.showToast)

  return (
    <DialogWorkspace
      layout="split"
      className="sop-center-generate-grid min-h-0 flex-1"
      data-generation-one-screen="true"
    >
      <DialogPane tone="canvas" scroll={false} className="sop-center-editor-panel overflow-hidden">
        <div
          className={`sop-center-editor-card sop-center-generate-form${isPromptReverseGeneration ? ' sop-center-generate-form--prompt-reverse' : ''}`}
        >
          <div>
            <h3 className="font-semibold">{isPromptReverseGeneration ? '从提示词反推 SOP' : '生成新 SOP'}</h3>
            <p className="sop-center-quiet-text mt-1 text-xs">
              {isPromptReverseGeneration
                ? '粘贴一条或多条成品提示词，提取可复用的生成流程。'
                : '选择元指令，补充说明或参考图后生成并保存。'}
            </p>
          </div>
          <div className="sop-center-generate-selects">
            <SelectField
              label="生成元指令"
              value={generatorMetaId}
              onChange={(event) => {
                setGeneratorMetaId(event.target.value)
                onClearMetaFallback()
              }}
              options={[
                { value: '', label: '请选择' },
                ...metaInstructions.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            <SelectField
              label="保存到分组"
              value={generatorGroupId}
              onChange={(event) => setGeneratorGroupId(event.target.value)}
              options={[
                { value: '', label: '未分组' },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </div>
          {generatorMetaFallbackName && (
            <p
              role="status"
              className="sop-center-quiet-text rounded-lg border border-dashed border-ds-border bg-ds-surface-subtle px-3 py-2 text-xs leading-5"
            >
              已载入生成记录使用的元指令「{generatorMetaFallbackName}
              」（原元指令已从库中删除），重新生成时仍使用记录内保存的版本。
            </p>
          )}
          <TextArea
            label={isPromptReverseGeneration ? '样本提示词' : '生成说明'}
            aria-label={isPromptReverseGeneration ? '用于反推 SOP 的样本提示词' : 'SOP 生成说明'}
            value={generatorBrief}
            onChange={(event) => setGeneratorBrief(event.target.value)}
            placeholder={
              isPromptReverseGeneration
                ? '粘贴成品提示词；多条样本之间建议用空行或 --- 分隔'
                : '说明 SOP 的目标、输入、输出格式和禁止项'
            }
            containerClassName={`sop-center-generate-brief${isPromptReverseGeneration ? ' sop-center-generate-brief--prompt-reverse' : ''}`}
            className="leading-5"
          />
          {!isPromptReverseGeneration && (
            <div className="sop-center-reference-section">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-ds-muted">参考图片</span>
                  <span className="ml-2 text-xs text-ds-text-subtle">
                    多选、拖拽或 Ctrl+V 粘贴，最多 {MAX_SOP_REFERENCE_IMAGES} 张
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-ds-text-subtle">
                    {referenceImages.length}/{MAX_SOP_REFERENCE_IMAGES}
                  </span>
                  <button
                    type="button"
                    disabled={job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES}
                    onClick={() => setAssetPickerOpen(true)}
                    className="text-xs font-medium text-ds-primary hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    从素材库选择
                  </button>
                  {referenceImages.length > 0 && (
                    <button
                      type="button"
                      disabled={job.status === 'running'}
                      onClick={() => {
                        setReferenceImages([])
                        showToast('已清空全部参考图片', 'info')
                      }}
                      className="text-xs font-medium text-ds-muted hover:text-ds-danger disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      清空
                    </button>
                  )}
                </div>
              </div>
              <div className="sop-center-reference-grid" data-reference-count={referenceImages.length}>
                <label
                  className="sop-center-upload"
                  data-sop-reference-dropzone={true}
                  data-drag-active={referenceDragActive || undefined}
                  data-disabled={
                    job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES || undefined
                  }
                  onDragEnter={handleReferenceDragEnter}
                  onDragOver={handleReferenceDragOver}
                  onDragLeave={handleReferenceDragLeave}
                  onDrop={handleReferenceDrop}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    disabled={job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? [])
                      event.currentTarget.value = ''
                      void addReferenceImages(files)
                    }}
                  />
                  <span className="min-w-0">
                    <FileImage size={20} className="mx-auto" />
                    <span className="mt-1 block text-xs font-semibold">
                      {referenceDragActive
                        ? '松开添加'
                        : referenceImages.length >= MAX_SOP_REFERENCE_IMAGES
                          ? '已达上限'
                          : '添加图片'}
                    </span>
                    <span className="sop-center-quiet-text mt-0.5 block text-xs">支持 Ctrl+V 粘贴 · 单张 ≤ 10 MiB</span>
                  </span>
                </label>
                {referenceImages.map((image, index) => (
                  <div key={image.id} className="sop-center-thumb group relative min-w-0" title={image.name}>
                    <img
                      src={image.dataUrl}
                      alt={`参考图 ${index + 1}：${image.name}`}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1 left-1 rounded-md bg-ds-scrim/0.72 px-1.5 py-0.5 text-xs font-semibold text-white">
                      图 {index + 1}
                    </span>
                    <button
                      type="button"
                      disabled={job.status === 'running'}
                      onClick={() => {
                        setReferenceImages((current) => current.filter((item) => item.id !== image.id))
                        showToast('已移除参考图', 'info')
                      }}
                      aria-label={`移除${image.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-ds-scrim/0.72 text-white opacity-80 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Button
            onClick={() => void runGeneration()}
            loading={job.status === 'running'}
            className="sop-center-generate-submit w-full"
            size="lg"
            leadingIcon={<Sparkles size={17} />}
          >
            {job.status === 'running'
              ? isPromptReverseGeneration
                ? '正在反推 SOP'
                : '正在生成 SOP'
              : isPromptReverseGeneration
                ? '开始反推并保存'
                : '开始生成并保存'}
          </Button>
        </div>
      </DialogPane>
      <DialogPane as="aside" scroll={false} className="sop-center-editor-panel overflow-hidden">
        <div className="sop-center-editor-card sop-center-generate-side">
          <div className="sop-center-generate-panel-switch" role="tablist" aria-label="生成信息">
            <button
              type="button"
              role="tab"
              aria-selected={generationPanel === 'status'}
              data-active={generationPanel === 'status' || undefined}
              onClick={() => setGenerationPanel('status')}
            >
              <Sparkles size={14} />
              生成状态
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={generationPanel !== 'status'}
              data-active={generationPanel !== 'status' || undefined}
              onClick={() => setGenerationPanel('history')}
            >
              <History size={14} />
              生成记录
              {generationRecords.length > 0 && <span>{generationRecords.length}</span>}
            </button>
          </div>
          {generationPanel === 'status' ? (
            <div className="sop-center-generation-status-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">生成状态</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">进度会随实际请求实时更新。</p>
                </div>
                {job.status !== 'idle' && (
                  <span className="text-xs tabular-nums text-ds-text-subtle">{generationProgress}%</span>
                )}
              </div>
              <div aria-live="polite" className="sop-center-status" data-status={job.status}>
                <div className="flex items-center gap-3">
                  {job.status === 'running' ? (
                    <LoaderCircle className="sop-center-status-icon animate-spin" size={22} />
                  ) : job.status === 'success' ? (
                    <CheckCircle2 className="sop-center-status-icon" size={22} />
                  ) : job.status === 'error' ? (
                    <XCircle className="sop-center-status-icon" size={22} />
                  ) : (
                    <Sparkles className="sop-center-status-icon" size={22} />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{job.message}</p>
                    {job.status === 'running' && (
                      <p className="sop-center-quiet-text mt-1 text-xs">已运行 {elapsed} 秒，可关闭窗口在后台继续</p>
                    )}
                    {job.status === 'success' && (
                      <p className="sop-center-quiet-text mt-1 text-xs">用时 {elapsed} 秒，结果已安全保存</p>
                    )}
                  </div>
                </div>
                {job.status !== 'idle' && (
                  <div
                    className="sop-center-progress-track mt-3"
                    role="progressbar"
                    aria-label="SOP 生成进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={generationProgress}
                  >
                    <div
                      className="sop-center-progress-bar"
                      style={{ transform: `scaleX(${generationProgress / 100})` }}
                    />
                  </div>
                )}
                {job.error && (
                  <p role="alert" className="mt-2 whitespace-pre-wrap text-xs leading-5 text-ds-danger">
                    {job.error}
                  </p>
                )}
                {job.status === 'success' && (
                  <p className="sop-center-status-copy mt-2 text-xs leading-5">
                    结果已保存到 SOP 库，也已写入完整生成记录。
                  </p>
                )}
                {job.status === 'running' && (
                  <Button onClick={cancelGeneration} variant="secondary" size="sm" className="mt-3">
                    取消生成
                  </Button>
                )}
                {job.status === 'error' && (
                  <Button onClick={() => void runGeneration()} variant="secondary" size="sm" className="mt-3">
                    重新生成
                  </Button>
                )}
                {job.status === 'success' && (
                  <Button onClick={() => setTab('library')} variant="secondary" size="sm" className="mt-3">
                    查看生成结果
                  </Button>
                )}
              </div>
              <ol className="sop-center-step-list" aria-label="SOP 生成详细步骤">
                {steps.map((step, index) => {
                  const completed = completedGenerationSteps.has(step.id)
                  const active = job.status === 'running' && job.currentStep === step.id
                  const failed = job.status === 'error' && job.currentStep === step.id
                  const state = completed ? 'completed' : active ? 'active' : failed ? 'error' : 'pending'
                  return (
                    <li key={step.id} className="sop-center-step" data-state={state}>
                      <span className="sop-center-step-marker" aria-hidden="true">
                        {completed ? (
                          <Check size={13} />
                        ) : active ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{step.label}</span>
                        <span className="sop-center-quiet-text mt-0.5 block text-xs leading-5">{step.description}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : (
            <div className="sop-center-generation-history">
              <div>
                <h3 className="font-semibold">生成记录</h3>
                <p className="sop-center-quiet-text mt-1 text-xs">保留元指令、输入、参考图、结果或失败原因。</p>
              </div>
              {generationRecordsLoading ? (
                <div className="sop-center-generation-history-empty">
                  <LoaderCircle className="animate-spin" size={20} />
                  <span>正在读取记录</span>
                </div>
              ) : visibleGenerationRecords.length > 0 ? (
                <div className="sop-center-generation-history-list">
                  {visibleGenerationRecords.map((record) => {
                    const recordTitle = record.result?.name ?? record.metaInstruction.name
                    const statusTone =
                      record.status === 'success' ? 'success' : record.status === 'error' ? 'danger' : 'info'
                    const statusText =
                      record.status === 'success' ? '生成成功' : record.status === 'error' ? '生成失败' : '生成中'
                    const openDetail = () => {
                      setSelectedGenerationRecord(record)
                      setGenerationPanel('detail')
                    }
                    return (
                      <div key={record.id} className="sop-center-generation-history-item" data-status={record.status}>
                        <div className="sop-center-generation-history-header">
                          <button
                            type="button"
                            className="sop-center-generation-history-main"
                            onClick={openDetail}
                            aria-label={`查看生成记录 ${recordTitle}`}
                          >
                            <StatusIndicator tone={statusTone} pulse={record.status === 'running'}>
                              {statusText}
                            </StatusIndicator>
                            <span className="sop-center-generation-history-copy">
                              <span className="sop-center-generation-history-title">{recordTitle}</span>
                              <span className="sop-center-generation-history-brief">
                                {record.brief || '未填写生成说明'}
                              </span>
                              <span className="sop-center-generation-history-meta">
                                {formatGenerationRecordTime(record.createdAt)}
                                {record.targetGroup?.name ? ` · ${record.targetGroup.name}` : ''}
                                {record.elapsedMs !== undefined ? ` · ${(record.elapsedMs / 1000).toFixed(1)} 秒` : ''}
                                {` · ${record.referenceImages.length} 张参考图`}
                              </span>
                            </span>
                          </button>
                          <span
                            className="sop-center-generation-history-actions"
                            role="group"
                            aria-label={`${recordTitle} 记录操作`}
                          >
                            <IconButton
                              size="sm"
                              disabled={job.status === 'running'}
                              onClick={() => editGenerationRecord(record)}
                              aria-label={`编辑生成记录 ${recordTitle}`}
                              title="编辑输入后重新生成"
                              icon={<Pencil size={13} />}
                            />
                            <IconButton
                              size="sm"
                              disabled={job.status === 'running'}
                              onClick={() => void regenerateFromRecord(record)}
                              aria-label={`重新生成记录 ${recordTitle}`}
                              title="使用记录输入重新生成"
                              icon={<RefreshCw size={13} />}
                            />
                          </span>
                        </div>
                        <button
                          type="button"
                          className="sop-center-generation-history-thumbs"
                          onClick={openDetail}
                          aria-label={`查看生成记录缩略图 ${recordTitle}`}
                        >
                          {record.referenceImages.length > 0 ? (
                            record.referenceImages.map((image, index) => (
                              <span key={image.id} className="sop-center-generation-history-thumb" title={image.name}>
                                <img
                                  src={image.dataUrl}
                                  alt={`生成记录参考图 ${index + 1}：${image.name}`}
                                  loading="lazy"
                                />
                                <span className="sop-center-generation-history-thumb-index" aria-hidden="true">
                                  {index + 1}
                                </span>
                              </span>
                            ))
                          ) : (
                            <span className="sop-center-generation-history-thumbs-empty">本次未使用参考图片</span>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="sop-center-generation-history-empty">
                  <History size={20} />
                  <span>还没有生成记录</span>
                </div>
              )}
              <div className="sop-center-generation-history-pager">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={generationHistoryPage === 0}
                  onClick={() => setGenerationHistoryPage((page) => Math.max(0, page - 1))}
                >
                  上一页
                </Button>
                <span>
                  第 {generationHistoryPage + 1} / {generationHistoryPageCount} 页
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={generationHistoryPage >= generationHistoryPageCount - 1}
                  onClick={() => setGenerationHistoryPage((page) => Math.min(generationHistoryPageCount - 1, page + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogPane>
    </DialogWorkspace>
  )
}
