import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calculateImageSize,
  calculatePostprocessImageSize,
  isRecommendedSize,
  normalizeImageSize,
  parseRatio,
  type SizeTier,
} from '../lib/size'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useDialogFocusTrap } from '../design-system'
import Select from './Select'
import ViewportTooltip from './ViewportTooltip'

const TIERS: SizeTier[] = ['1K', '2K', '4K']
const SIZE_LIMIT_TEXT =
  '生成请求会自动规整到合法尺寸：\n常规尺寸宽高均为 16 的倍数，1K 9:16 中转请求尺寸为 720x1280，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。服务商实际输出尺寸以返回结果为准。'
const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

interface Props {
  currentSize: string
  onSelect: (size: string, postprocessSize?: string) => void
  onClose: () => void
  allowAuto?: boolean
  postprocessSettings?: {
    resizeEnabled: boolean
    compressEnabled: boolean
    format: 'png' | 'jpeg' | 'webp'
    maxSizeInput: string
    onResizeEnabledChange: (enabled: boolean, size?: string) => void
    onCompressEnabledChange: (enabled: boolean) => void
    onFormatChange: (format: 'png' | 'jpeg' | 'webp') => void
    onMaxSizeInputChange: (value: string) => void
    onMaxSizeBlur: () => void
  }
}

type Mode = 'auto' | 'ratio' | 'resolution'

function parseSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!match) return null
  return { width: match[1], height: match[2] }
}

function findPresetForSize(size: string) {
  const normalized = normalizeImageSize(size)
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === normalized) {
        return { tier, ratio: ratio.value }
      }
    }
  }
  return null
}

export default function SizePickerModal({
  currentSize,
  onSelect,
  onClose,
  allowAuto = true,
  postprocessSettings,
}: Props) {
  usePreventBackgroundScroll(true)

  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  useDialogFocusTrap(true, modalRef)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const mouseDownTarget = mouseDownTargetRef.current
    const mouseUpTarget = e.target

    if (
      modalRef.current &&
      mouseDownTarget &&
      !modalRef.current.contains(mouseDownTarget as Node) &&
      mouseUpTarget &&
      !modalRef.current.contains(mouseUpTarget as Node)
    ) {
      onClose()
    }
    mouseDownTargetRef.current = null
  }

  const currentPreset = findPresetForSize(currentSize)
  const currentParsedSize = parseSize(currentSize)
  const [mode, setMode] = useState<Mode>(() => {
    if (!currentSize || currentSize === 'auto') return allowAuto ? 'auto' : 'ratio'
    if (currentPreset) return 'ratio'
    return 'resolution'
  })

  // Ratio mode state
  const [tier, setTier] = useState<SizeTier>(currentPreset?.tier ?? '1K')
  const [ratio, setRatio] = useState(currentPreset?.ratio ?? (allowAuto ? '1:1' : '4:3'))
  const [customRatio, setCustomRatio] = useState('16:9')

  // Resolution mode state
  const [customW, setCustomW] = useState(currentParsedSize?.width ?? '1024')
  const [customH, setCustomH] = useState(currentParsedSize?.height ?? '1024')

  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
    },
    [],
  )

  const activeRatio = ratio === 'custom' ? customRatio : ratio
  const parsedCustomRatio = parseRatio(customRatio)
  const customRatioValid = ratio !== 'custom' || Boolean(parsedCustomRatio)
  const customRatioClamped = Boolean(
    ratio === 'custom' &&
    parsedCustomRatio &&
    Math.max(parsedCustomRatio.width, parsedCustomRatio.height) /
      Math.min(parsedCustomRatio.width, parsedCustomRatio.height) >
      3,
  )

  const previewSize = useMemo(() => {
    if (mode === 'auto') return 'auto'

    if (mode === 'ratio') {
      const size = calculateImageSize(tier, activeRatio)
      return size ? normalizeImageSize(size) : ''
    }

    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return normalizeImageSize(`${w}x${h}`)
      }
      return ''
    }

    return ''
  }, [mode, tier, activeRatio, customW, customH])

  const postprocessPreviewSize = useMemo(() => {
    if (mode !== 'ratio') return previewSize
    const size = calculatePostprocessImageSize(tier, activeRatio)
    return size || previewSize
  }, [mode, tier, activeRatio, previewSize])

  const isClamped = useMemo(() => {
    if (!previewSize || previewSize === 'auto') return false
    if (mode === 'ratio' && ratio === 'custom') return customRatioClamped
    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `${w}x${h}` !== previewSize
      }
    }
    return false
  }, [mode, ratio, customRatioClamped, customW, customH, previewSize])

  const showHint = () => setHintVisible(true)
  const hideHint = () => {
    setHintVisible(false)
    clearHintTimer()
  }
  const clearHintTimer = () => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
  }
  const startHintTouch = () => {
    hintTimerRef.current = window.setTimeout(() => {
      setHintVisible(true)
      hintTimerRef.current = null
    }, 450)
  }

  const applySize = () => {
    if (!previewSize) return
    onSelect(previewSize, postprocessPreviewSize)
    onClose()
  }

  const postprocessResizeAvailable = Boolean(previewSize && previewSize !== 'auto')

  const buttonClass = (active: boolean) => {
    return `rounded-ds-lg border px-3 py-2 text-sm transition ${
      active
        ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/50 dark:bg-ds-primary/10 dark:text-ds-primary'
        : 'border-ds-border/70 bg-ds-surface/60 text-ds-muted hover:bg-ds-subtle dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface'
    }`
  }

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-picker-dialog-title"
        className="ds-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="size-picker-dialog-title" className="text-base font-semibold text-ds-text dark:text-ds-text-subtle">
              设置图像尺寸
            </h2>
            <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">当前：{currentSize || 'auto'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ds-muted transition hover:bg-ds-subtle hover:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <div className="flex rounded-ds-lg bg-ds-surface/80 p-1 dark:bg-ds-surface">
            {allowAuto && (
              <button
                onClick={() => setMode('auto')}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'auto' ? 'bg-ds-surface text-ds-text shadow-sm dark:bg-ds-subtle dark:text-ds-text-subtle' : 'text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text'}`}
              >
                自动
              </button>
            )}
            <button
              onClick={() => setMode('ratio')}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'ratio' ? 'bg-ds-surface text-ds-text shadow-sm dark:bg-ds-subtle dark:text-ds-text-subtle' : 'text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text'}`}
            >
              按比例
            </button>
            <button
              onClick={() => setMode('resolution')}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'resolution' ? 'bg-ds-surface text-ds-text shadow-sm dark:bg-ds-subtle dark:text-ds-text-subtle' : 'text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text'}`}
            >
              自定义宽高
            </button>
          </div>

          <div className="h-[380px] max-h-[55vh] overflow-y-auto custom-scrollbar pr-1 -mr-1 pb-2">
            {mode === 'auto' && (
              <div className="flex h-full animate-fade-in items-center justify-center pt-8 pb-4 text-center">
                <div>
                  <div className="mb-4 inline-flex h-ds-16 w-ds-16 items-center justify-center rounded-full bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10">
                    <svg
                      className="h-ds-control-sm w-ds-control-sm"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <h4 className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">自动尺寸</h4>
                  <p className="mt-2 text-xs text-ds-muted leading-relaxed dark:text-ds-muted">
                    不向模型传递具体的分辨率参数
                    <br />
                    由模型自己决定生成尺寸
                  </p>
                </div>
              </div>
            )}

            {mode === 'ratio' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-2 text-xs font-medium text-ds-muted dark:text-ds-muted">基准分辨率</div>
                  <div className="grid grid-cols-3 gap-2">
                    {TIERS.map((item) => (
                      <button key={item} className={buttonClass(tier === item)} onClick={() => setTier(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-ds-muted dark:text-ds-muted">图像比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {RATIOS.map((item) => {
                      const [w, h] = item.value.split(':').map(Number)
                      const isHorizontal = w > h
                      const isSquare = w === h
                      const sizeForRatio = calculateImageSize(tier, item.value)
                      const recommended = sizeForRatio ? isRecommendedSize(sizeForRatio) : false
                      return (
                        <button
                          key={item.value}
                          className={`${buttonClass(ratio === item.value)} flex flex-col items-center justify-center gap-1 !py-2 relative`}
                          onClick={() => setRatio(item.value)}
                        >
                          {recommended && (
                            <span className="absolute top-0.5 right-0.5 text-xs leading-none px-1 py-0.5 rounded bg-ds-success text-ds-text-inverse font-medium">
                              推荐
                            </span>
                          )}
                          <div className="flex h-5 w-5 items-center justify-center">
                            <div
                              className="border-[1.5px] border-current rounded-[3px] opacity-60"
                              style={{
                                width: isHorizontal || isSquare ? '100%' : `${(w / h) * 100}%`,
                                height: !isHorizontal || isSquare ? '100%' : `${(h / w) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs">{item.label}</span>
                        </button>
                      )
                    })}
                    <button
                      className={`${buttonClass(ratio === 'custom')} col-span-4`}
                      onClick={() => setRatio('custom')}
                    >
                      自定义比例
                    </button>
                  </div>
                </section>

                {ratio === 'custom' && (
                  <label className="block animate-fade-in">
                    <span className="mb-2 block text-xs font-medium text-ds-muted dark:text-ds-muted">
                      输入自定义比例
                    </span>
                    <input
                      value={customRatio}
                      onChange={(e) => setCustomRatio(e.target.value)}
                      placeholder="例如 5:4 / 2.39:1"
                      className={`w-full rounded-ds-lg border px-3 py-2 text-sm outline-none transition ${
                        customRatioValid
                          ? 'border-ds-border/70 bg-ds-surface/60 text-ds-text focus:border-ds-primary/35 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/50'
                          : 'border-ds-danger/35 bg-ds-surface/60 text-ds-text focus:border-ds-danger dark:border-ds-danger/40 dark:bg-ds-surface dark:text-ds-text-subtle'
                      }`}
                    />
                  </label>
                )}
              </div>
            )}

            {mode === 'resolution' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-4 text-xs font-medium text-ds-muted dark:text-ds-muted">输入具体像素值</div>
                  <div className="flex items-center gap-4">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-ds-muted dark:text-ds-muted">宽度 (Width)</span>
                      <input
                        type="number"
                        value={customW}
                        onChange={(e) => setCustomW(e.target.value)}
                        className="w-full rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-sm text-ds-text outline-none transition focus:border-ds-primary/35 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/50"
                        placeholder="例如 1024"
                      />
                    </label>
                    <div className="mt-5 text-ds-text-subtle dark:text-ds-muted">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-ds-muted dark:text-ds-muted">高度 (Height)</span>
                      <input
                        type="number"
                        value={customH}
                        onChange={(e) => setCustomH(e.target.value)}
                        className="w-full rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-sm text-ds-text outline-none transition focus:border-ds-primary/35 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/50"
                        placeholder="例如 1024"
                      />
                    </label>
                  </div>
                </section>
                <div className="rounded-ds-lg border border-ds-border/80 bg-ds-surface/80 p-3 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted">
                  <div className="flex items-start gap-2">
                    <svg
                      className="mt-[2px] h-4 w-4 flex-shrink-0 text-ds-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="whitespace-pre-line leading-relaxed">{SIZE_LIMIT_TEXT}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-ds-xl bg-ds-surface px-4 py-3 dark:bg-ds-surface">
            <div className="text-xs text-ds-muted dark:text-ds-muted">将使用</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-ds-text dark:text-ds-text-subtle">
                {previewSize || '尺寸无效'}
              </span>
              {isClamped && (
                <div
                  className="relative flex items-center"
                  onMouseEnter={showHint}
                  onMouseLeave={hideHint}
                  onTouchStart={startHintTouch}
                  onTouchEnd={clearHintTimer}
                  onTouchCancel={hideHint}
                  onClick={showHint}
                >
                  <svg
                    className="w-5 h-5 text-ds-warning cursor-pointer"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <ViewportTooltip visible={hintVisible} className="w-56 whitespace-pre-line text-center">
                    {SIZE_LIMIT_TEXT}
                  </ViewportTooltip>
                </div>
              )}
            </div>
          </div>
          {postprocessSettings && (
            <section className="rounded-ds-xl border border-ds-border/70 bg-ds-surface/60 p-4 dark:border-ds-border dark:bg-ds-surface">
              <div className="mb-3">
                <div className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">生成后处理</div>
                <div className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
                  仅处理返回后的最终图片，不改变接口请求参数
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ds-text dark:text-ds-text-subtle">后处理尺寸</div>
                    <div className="mt-0.5 text-xs text-ds-muted dark:text-ds-muted">
                      {postprocessResizeAvailable ? `保存为 ${postprocessPreviewSize}` : '请先选择具体尺寸'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!postprocessResizeAvailable && !postprocessSettings.resizeEnabled}
                    onClick={() =>
                      postprocessSettings.onResizeEnabledChange(
                        !postprocessSettings.resizeEnabled,
                        postprocessPreviewSize,
                      )
                    }
                    className={`shrink-0 rounded-ds-lg border px-3 py-1.5 text-xs transition ${
                      postprocessSettings.resizeEnabled
                        ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/50 dark:bg-ds-primary/10 dark:text-ds-primary'
                        : 'border-ds-border/70 bg-ds-surface/60 text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {postprocessSettings.resizeEnabled ? '开启' : '关闭'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ds-text dark:text-ds-text-subtle">压缩不缩放</div>
                    <div className="mt-0.5 text-xs text-ds-muted dark:text-ds-muted">限制最终文件体积，不缩放尺寸</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextEnabled = !postprocessSettings.compressEnabled
                      postprocessSettings.onCompressEnabledChange(nextEnabled)
                      // PNG 为无损格式，压缩到目标体积时必然失败（超出即报错）。
                      // 开启压缩时自动切到 JPEG，避免"必失败"组合。
                      if (nextEnabled && postprocessSettings.format === 'png') {
                        postprocessSettings.onFormatChange('jpeg')
                      }
                    }}
                    className={`shrink-0 rounded-ds-lg border px-3 py-1.5 text-xs transition ${
                      postprocessSettings.compressEnabled
                        ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/50 dark:bg-ds-primary/10 dark:text-ds-primary'
                        : 'border-ds-border/70 bg-ds-surface/60 text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'
                    }`}
                  >
                    {postprocessSettings.compressEnabled ? '开启' : '关闭'}
                  </button>
                </div>

                {postprocessSettings.compressEnabled && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <label className="min-w-0">
                      <span className="mb-1.5 block text-xs text-ds-muted dark:text-ds-muted">输出格式</span>
                      <Select
                        value={postprocessSettings.format}
                        onChange={(value) => postprocessSettings.onFormatChange(value as 'png' | 'jpeg' | 'webp')}
                        options={
                          postprocessSettings.compressEnabled
                            ? [
                                { label: 'JPEG', value: 'jpeg' },
                                { label: 'WebP', value: 'webp' },
                              ]
                            : [
                                { label: 'PNG', value: 'png' },
                                { label: 'JPEG', value: 'jpeg' },
                                { label: 'WebP', value: 'webp' },
                              ]
                        }
                        className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-text dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1.5 block text-xs text-ds-muted dark:text-ds-muted">最大体积(KB)</span>
                      <input
                        value={postprocessSettings.maxSizeInput}
                        onChange={(e) => postprocessSettings.onMaxSizeInputChange(e.target.value)}
                        onBlur={postprocessSettings.onMaxSizeBlur}
                        type="number"
                        min={1}
                        placeholder="例如 399"
                        className="w-full rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-text outline-none transition focus:border-ds-primary/35 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/50"
                      />
                    </label>
                  </div>
                )}
                {postprocessSettings.compressEnabled && (
                  <p className="pt-2 text-xs text-ds-warning dark:text-ds-warning">
                    PNG 为无损格式，无法压缩到目标体积，开启压缩时不可选。
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-ds-lg bg-ds-surface px-4 py-2.5 text-sm text-ds-muted transition hover:bg-ds-subtle dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface"
          >
            取消
          </button>
          <button
            onClick={applySize}
            disabled={!previewSize}
            className="flex-1 rounded-ds-lg bg-ds-primary px-4 py-2.5 text-sm font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
