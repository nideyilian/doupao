import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDialog } from '../../../hooks/useAppDialog'
import { mapLayerPositionToCanvas } from '../lib/compositeRenderPlan'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import { fitCompositeTextLayer } from '../lib/compositeTextLayout'
import type { CompositeV2Layer, CompositeV2Preset, CompositeV2TextLayer } from '../lib/compositeV2Types'
import { FloatingLayerToolbar } from './FloatingLayerToolbar'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'

type Props = {
  preset: CompositeV2Preset | null
  selectedLayerId?: string
  onSelectLayer?: (layerId: string) => void
  onAddText: () => void
  onAddImage: () => void
  onAddLogo: () => void
  onUpdatePreset?: (patch: Partial<CompositeV2Preset>) => void
}

type PreviewBackdropMode = 'white' | 'transparent' | 'black'

const previewBackdropOrder: PreviewBackdropMode[] = ['white', 'transparent', 'black']

function getPreviewBackdropLabel(mode: PreviewBackdropMode) {
  if (mode === 'white') return '白色背景'
  if (mode === 'transparent') return '透明背景'
  return '黑色背景'
}

function getPreviewBackdropClasses(mode: PreviewBackdropMode) {
  if (mode === 'white') return 'bg-ds-surface'
  if (mode === 'black') return 'bg-black'
  return 'bg-ds-surface dark:bg-ds-scrim'
}

function getPreviewBackdropStyle(mode: PreviewBackdropMode) {
  if (mode !== 'transparent') return undefined
  return {
    backgroundImage: `
      linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%)
    `,
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
  }
}

function getLayerStyle(layer: CompositeV2Layer, preset: CompositeV2Preset) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, preset.baseCanvas)
  return {
    left: `${(rect.x / preset.baseCanvas.width) * 100}%`,
    top: `${(rect.y / preset.baseCanvas.height) * 100}%`,
    width: `${(rect.width / preset.baseCanvas.width) * 100}%`,
    height: `${(rect.height / preset.baseCanvas.height) * 100}%`,
    transform: `rotate(${layer.rotation}deg)`,
  }
}

function getCenteredFreePosition(baseCanvas: CompositeV2Preset['baseCanvas'], size: { width: number; height: number }) {
  return {
    mode: 'free' as const,
    x: Math.round((baseCanvas.width - size.width) / 2),
    y: Math.round((baseCanvas.height - size.height) / 2),
    width: size.width,
    height: size.height,
  }
}

function preserveFreeLayerCenter(
  position: Extract<CompositeV2Layer['position'], { mode: 'free' }>,
  size: { width: number; height: number },
) {
  const centerX = position.x + position.width / 2
  const centerY = position.y + position.height / 2
  return {
    ...position,
    x: Math.round(centerX - size.width / 2),
    y: Math.round(centerY - size.height / 2),
    width: size.width,
    height: size.height,
  }
}

export function PresetCanvasEditor(props: Props) {
  const { preset } = props
  const { openInfoDialog } = useAppDialog()
  const [internalSelectedLayerId, setInternalSelectedLayerId] = useState('')
  const [backgroundDataUrl, setBackgroundDataUrl] = useState('')
  const [editingTextLayerId, setEditingTextLayerId] = useState('')
  const [editingStartText, setEditingStartText] = useState('')
  const [editingScale, setEditingScale] = useState(1)
  const [scale, setScale] = useState<number | 'fit'>('fit')
  const [fitScale, setFitScale] = useState(1)
  const [previewBackdropMode, setPreviewBackdropMode] = useState<PreviewBackdropMode>('transparent')
  const selectedLayerId = props.selectedLayerId ?? internalSelectedLayerId
  const stageRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const store = useCompositeV2Store()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderVersionRef = useRef(0)
  const dragRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const visibleLayers = useMemo(() => preset?.layers.filter((layer) => layer.visible) ?? [], [preset])
  const editingTextLayer =
    preset?.layers.find(
      (layer): layer is CompositeV2TextLayer => layer.id === editingTextLayerId && layer.type === 'text',
    ) ?? null

  function selectLayer(layerId: string) {
    setInternalSelectedLayerId(layerId)
    props.onSelectLayer?.(layerId)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return

      const target = e.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
        return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId && preset) {
          const nextLayers = preset.layers.filter((l) => l.id !== selectedLayerId)
          if (nextLayers.length !== preset.layers.length && props.onUpdatePreset) {
            props.onUpdatePreset({ layers: nextLayers })
            if (selectedLayerId === internalSelectedLayerId) {
              setInternalSelectedLayerId('')
            }
            props.onSelectLayer?.('')
            useStore.getState().showToast('已删除图层', 'success')
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedLayerId && preset) {
          store.copyLayer(preset.id, selectedLayerId)
          useStore.getState().showToast('已复制图层', 'success')
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (preset) {
          if (!store.clipboardLayer) {
            useStore.getState().showToast('剪贴板中没有可粘贴的图层', 'error')
          } else {
            store.pasteLayer(preset.id)
            useStore.getState().showToast('已粘贴图层', 'success')
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        if (selectedLayerId && preset) {
          e.preventDefault()
          store.duplicateLayer(preset.id, selectedLayerId)
          useStore.getState().showToast('已复制图层', 'success')
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '[' || e.key === ']') {
          if (selectedLayerId && preset) {
            e.preventDefault()
            const index = preset.layers.findIndex((l) => l.id === selectedLayerId)
            if (index >= 0) {
              const direction = e.key === '[' ? -1 : 1
              const targetIndex = index + direction
              if (targetIndex >= 0 && targetIndex < preset.layers.length) {
                const layers = [...preset.layers]
                const [item] = layers.splice(index, 1)
                layers.splice(targetIndex, 0, item!)
                props.onUpdatePreset?.({ layers })
              }
            }
          }
        }
      }

      // Nudge coordinates
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedLayerId && preset) {
          e.preventDefault()
          const layer = preset.layers.find((l) => l.id === selectedLayerId)
          if (layer && layer.position.mode === 'free') {
            const step = e.shiftKey ? 10 : 1
            let dx = 0
            let dy = 0
            if (e.key === 'ArrowUp') dy = -step
            if (e.key === 'ArrowDown') dy = step
            if (e.key === 'ArrowLeft') dx = -step
            if (e.key === 'ArrowRight') dx = step
            const nextLayers = preset.layers.map((l) => {
              if (l.id === selectedLayerId && l.position.mode === 'free') {
                return { ...l, position: { ...l.position, x: l.position.x + dx, y: l.position.y + dy } }
              }
              return l
            })
            props.onUpdatePreset?.({ layers: nextLayers })
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedLayerId, preset, props, internalSelectedLayerId, store])

  useEffect(() => {
    let active = true
    if (!preset?.sampleBackgroundPath) {
      setBackgroundDataUrl('')
      return
    }
    void window.electronAPI?.readImageFile?.(preset.sampleBackgroundPath).then((payload) => {
      if (active) setBackgroundDataUrl(payload?.dataUrl ?? '')
    })
    return () => {
      active = false
    }
  }, [preset?.sampleBackgroundPath])

  useEffect(() => {
    if (!preset || !canvasRef.current) return
    const version = ++renderVersionRef.current
    void renderCompositeV2ToCanvas(
      {
        backgroundDataUrl: backgroundDataUrl || undefined,
        preset,
        targetSize: preset.baseCanvas,
        fitMode: 'crop-fill',
      },
      canvasRef.current,
      { isStale: () => version !== renderVersionRef.current },
    ).catch((error) => {
      console.error('合成预览渲染失败:', error)
      useStore.getState().showToast('画布预览渲染失败，请检查图层素材', 'error')
    })
    return () => {
      renderVersionRef.current += 1
    }
  }, [backgroundDataUrl, preset])

  useEffect(() => {
    if (!stageRef.current || !preset) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        const availableWidth = Math.max(100, width - 80)
        const availableHeight = Math.max(100, height - 80)
        const scaleX = availableWidth / preset.baseCanvas.width
        const scaleY = availableHeight / preset.baseCanvas.height
        setFitScale(Math.min(scaleX, scaleY))
      }
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [preset?.baseCanvas.width, preset?.baseCanvas.height])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale((prev) => {
          const current = prev === 'fit' ? fitScale : prev
          return Math.max(0.1, Math.min(5, current + delta))
        })
      }
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [fitScale])

  const currentScale = scale === 'fit' ? fitScale : scale
  const previewBackdropLabel = getPreviewBackdropLabel(previewBackdropMode)

  function updateLayer(layerId: string, patch: Partial<CompositeV2Layer>) {
    if (!preset || !props.onUpdatePreset) return
    props.onUpdatePreset({
      layers: preset.layers.map((layer) => {
        if (layer.id !== layerId) return layer
        const nextLayer = { ...layer, ...patch } as CompositeV2Layer
        return nextLayer.type === 'text' ? fitCompositeTextLayer(nextLayer) : nextLayer
      }),
    })
  }

  function beginTextEdit(layer: CompositeV2Layer, event: React.MouseEvent<HTMLButtonElement>) {
    if (layer.type !== 'text' || layer.locked) return
    event.stopPropagation()
    dragRef.current = null
    selectLayer(layer.id)
    setEditingStartText(layer.text)
    const host = event.currentTarget.parentElement?.getBoundingClientRect()
    setEditingScale(host?.width ? host.width / preset!.baseCanvas.width : 1)
    setEditingTextLayerId(layer.id)
  }

  async function openImagePicker(layer: CompositeV2Layer, event?: React.MouseEvent<HTMLButtonElement>) {
    if (!preset || layer.type !== 'image' || layer.locked) return
    event?.stopPropagation()
    dragRef.current = null
    selectLayer(layer.id)
    if (!window.electronAPI?.selectFile || !window.electronAPI?.readImageFile) {
      openInfoDialog({
        title: '当前环境不支持',
        message: '请在桌面客户端中选择本地图片。',
      })
      return
    }
    try {
      const path = await window.electronAPI.selectFile([
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
      ])
      if (!path) return
      const payload = await window.electronAPI.readImageFile(path)
      if (!payload?.dataUrl) return

      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height
        if (width > preset.baseCanvas.width || height > preset.baseCanvas.height) {
          const scale = Math.min(preset.baseCanvas.width / width, preset.baseCanvas.height / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        updateLayer(layer.id, {
          asset: { kind: 'path', path },
          position:
            layer.position.mode === 'free'
              ? preserveFreeLayerCenter(layer.position, { width, height })
              : getCenteredFreePosition(preset.baseCanvas, { width, height }),
        })
        useStore.getState().showToast('已更换图片素材', 'success')
      }
      img.src = payload.dataUrl
    } catch {
      useStore.getState().showToast('读取图片失败，请重试', 'error')
    }
  }

  function finishTextEdit() {
    setEditingTextLayerId('')
    setEditingStartText('')
  }

  function cancelTextEdit() {
    if (editingTextLayer) updateLayer(editingTextLayer.id, { text: editingStartText })
    finishTextEdit()
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!preset || !dragRef.current) return
    const layer = preset.layers.find((item) => item.id === dragRef.current?.id)
    const host = event.currentTarget.getBoundingClientRect()
    if (!layer || layer.locked || host.width <= 0 || host.height <= 0) return
    const dx = ((event.clientX - dragRef.current.x) / host.width) * preset.baseCanvas.width
    const dy = ((event.clientY - dragRef.current.y) / host.height) * preset.baseCanvas.height
    dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
    if (layer.position.mode === 'free') {
      updateLayer(layer.id, { position: { ...layer.position, x: layer.position.x + dx, y: layer.position.y + dy } })
    } else {
      updateLayer(layer.id, {
        position: { ...layer.position, offsetX: layer.position.offsetX + dx, offsetY: layer.position.offsetY + dy },
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim">
      <div ref={stageRef} data-layout="preset-canvas-stage" className="relative min-h-0 flex-1 overflow-hidden">
        <FloatingLayerToolbar
          onAddText={props.onAddText}
          onAddImage={props.onAddImage}
          onAddLogo={props.onAddLogo}
          disabled={!preset}
        />
        {preset && (
          <div
            data-layout="preset-title"
            className="absolute left-3 top-2 z-10 rounded bg-ds-surface/85 px-2 py-1 text-xs font-medium dark:bg-ds-scrim/85"
          >
            {preset.name}
          </div>
        )}

        <div ref={containerRef} className="h-full w-full overflow-auto">
          <div className="flex min-h-full min-w-full p-8">
            <div
              data-layout="preset-canvas"
              data-preview-backdrop={previewBackdropMode}
              className={`relative m-auto overflow-hidden rounded-md border border-ds-border shadow-inner dark:border-ds-border ${getPreviewBackdropClasses(previewBackdropMode)}`}
              style={{
                width: preset ? preset.baseCanvas.width * currentScale : 800,
                height: preset ? preset.baseCanvas.height * currentScale : 450,
                ...getPreviewBackdropStyle(previewBackdropMode),
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={() => {
                dragRef.current = null
              }}
            >
              {preset && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
              {!preset && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-ds-muted">
                  请选择预设
                </div>
              )}
              {preset &&
                visibleLayers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    title={layer.name}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      selectLayer(layer.id)
                      dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
                    }}
                    onDoubleClick={(event) => {
                      if (layer.type === 'text') {
                        beginTextEdit(layer, event)
                        return
                      }
                      if (layer.type === 'image') {
                        void openImagePicker(layer, event)
                      }
                    }}
                    className={`absolute border ${selectedLayerId === layer.id ? 'border-ds-primary bg-ds-primary/10' : 'border-transparent hover:border-ds-primary/35'}`}
                    style={getLayerStyle(layer, preset)}
                  />
                ))}
              {preset && editingTextLayer && (
                <textarea
                  autoFocus
                  aria-label={`Edit text ${editingTextLayer.name}`}
                  value={editingTextLayer.text}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateLayer(editingTextLayer.id, { text: event.target.value })}
                  onBlur={finishTextEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelTextEdit()
                    } else if (event.key === 'Enter' && event.ctrlKey) {
                      event.preventDefault()
                      finishTextEdit()
                    }
                  }}
                  className="absolute z-30 resize-none overflow-hidden border border-ds-primary bg-ds-surface/90 text-ds-text outline-none ring-2 ring-ds-focus/20"
                  style={{
                    ...getLayerStyle(editingTextLayer, preset),
                    fontFamily: editingTextLayer.fontFamily,
                    fontSize: `${Math.max(10, editingTextLayer.fontSize * editingScale)}px`,
                    fontWeight: editingTextLayer.fontWeight,
                    lineHeight: editingTextLayer.lineHeight,
                    letterSpacing: `${editingTextLayer.letterSpacing * editingScale}px`,
                    padding: `${(editingTextLayer.padding ?? 5) * editingScale}px`,
                    textAlign: editingTextLayer.align,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Zoom Controls Bar */}
      <div className="flex h-ds-control-lg shrink-0 items-center justify-between border-t border-ds-border bg-ds-surface px-4 dark:border-ds-border dark:bg-ds-scrim">
        <div className="text-xs text-ds-muted">
          {preset ? `画布大小: ${preset.baseCanvas.width} × ${preset.baseCanvas.height}` : ''}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={`切换预览背景，当前为${previewBackdropLabel}`}
            aria-label={`切换预览背景，当前为${previewBackdropLabel}`}
            onClick={() =>
              setPreviewBackdropMode(
                (current) =>
                  previewBackdropOrder[(previewBackdropOrder.indexOf(current) + 1) % previewBackdropOrder.length]!,
              )
            }
            className="mr-2 rounded-md border border-ds-border px-2 py-1 text-xs text-ds-muted transition hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text"
          >
            {previewBackdropLabel}
          </button>
          <button
            type="button"
            title="缩小"
            onClick={() => setScale((s) => (s === 'fit' ? Math.max(0.1, fitScale - 0.1) : Math.max(0.1, s - 0.1)))}
            className="flex h-6 w-6 items-center justify-center rounded text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-subtle dark:hover:text-ds-text"
          >
            -
          </button>
          <button
            type="button"
            title="适应屏幕"
            onClick={() => setScale('fit')}
            className="min-w-[60px] text-center text-xs font-medium text-ds-text hover:text-ds-primary dark:text-ds-text-subtle dark:hover:text-ds-primary"
          >
            {scale === 'fit' ? '自适应' : `${Math.round(scale * 100)}%`}
          </button>
          <button
            type="button"
            title="放大"
            onClick={() => setScale((s) => (s === 'fit' ? Math.min(5, fitScale + 0.1) : Math.min(5, s + 0.1)))}
            className="flex h-6 w-6 items-center justify-center rounded text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-subtle dark:hover:text-ds-text"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
