import { useState } from 'react'
import {
  AlignCenterIcon as AlignCenter,
  AlignLeftIcon as AlignLeft,
  AlignRightIcon as AlignRight,
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
  EyeIcon as Eye,
  EyeOffIcon as EyeOff,
  LockIcon as Lock,
  LockOpenIcon as LockOpen,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { useAppDialog } from '../../../hooks/useAppDialog'
import { useStore } from '../../../store'
import { fitCompositeTextLayer } from '../lib/compositeTextLayout'
import type { CompositeV2Layer, CompositeV2Preset } from '../lib/compositeV2Types'

type Props = {
  preset: CompositeV2Preset | null
  selectedLayerId: string
  onSelectLayer: (layerId: string) => void
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
}

const fieldClass =
  'mt-1 h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-surface px-2 text-xs leading-tight text-ds-text outline-none transition-colors focus:border-ds-primary focus:ring-1 focus:ring-ds-focus disabled:cursor-not-allowed disabled:bg-ds-surface disabled:text-ds-text-subtle dark:border-ds-border dark:bg-ds-scrim dark:text-ds-text-subtle dark:disabled:bg-ds-surface'
const iconButtonClass =
  'inline-flex h-ds-control-sm w-ds-control-sm shrink-0 cursor-pointer items-center justify-center rounded-md text-ds-muted hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-ds-surface'
const alignButtonClass =
  'inline-flex h-ds-control-sm w-8 items-center justify-center rounded-md border text-ds-muted transition-colors'
const groupClass = 'min-w-0 px-4 py-3 first:pl-3 last:pr-3'
const labelClass = 'block text-xs leading-none text-ds-muted'
const defaultStroke = { enabled: false, color: '#111827', width: 0 }

function getAssetLabel(layer: CompositeV2Layer) {
  if (layer.type === 'text') return ''
  if (!layer.asset) return '尚未选择图片素材'
  if (layer.asset.kind === 'path' || layer.asset.kind === 'internal') {
    return layer.asset.path.split(/[\\/]/).pop() || layer.asset.path
  }
  if (layer.asset.kind === 'dataUrl') return layer.asset.name ?? 'Base64 图片'
  if (layer.asset.kind === 'stored') return layer.asset.name ?? '项目图片'
  return '项目 LOGO'
}

export function PresetLayerPanel({ preset, selectedLayerId, onSelectLayer, onUpdatePreset }: Props) {
  const selectedLayer = preset?.layers.find((layer) => layer.id === selectedLayerId) ?? null
  const { openInfoDialog } = useAppDialog()

  const [editingLayerId, setEditingLayerId] = useState('')
  const [editingLayerName, setEditingLayerName] = useState('')

  function beginLayerRename(layerId: string, name: string) {
    setEditingLayerId(layerId)
    setEditingLayerName(name)
  }

  function finishLayerRename() {
    if (editingLayerId) {
      updateLayer(editingLayerId, { name: editingLayerName })
      useStore.getState().showToast(`已重命名为「${editingLayerName}」`, 'success')
    }
    setEditingLayerId('')
    setEditingLayerName('')
  }

  function updateLayer(layerId: string, patch: Partial<CompositeV2Layer>) {
    if (!preset) return
    onUpdatePreset({
      layers: preset.layers.map((layer) => {
        if (layer.id !== layerId) return layer
        const nextLayer = { ...layer, ...patch } as CompositeV2Layer
        return nextLayer.type === 'text' ? fitCompositeTextLayer(nextLayer) : nextLayer
      }),
    })
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    if (!preset) return
    const index = preset.layers.findIndex((layer) => layer.id === layerId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= preset.layers.length) return
    const layers = [...preset.layers]
    ;[layers[index], layers[target]] = [layers[target]!, layers[index]!]
    onUpdatePreset({ layers })
    useStore.getState().showToast(direction === -1 ? '已上移图层' : '已下移图层', 'success')
  }

  function removeLayer(layerId: string) {
    if (!preset) return
    onUpdatePreset({ layers: preset.layers.filter((layer) => layer.id !== layerId) })
    if (selectedLayerId === layerId) onSelectLayer('')
    useStore.getState().showToast('已删除图层', 'success')
  }

  async function selectMediaAsset(layer: Extract<CompositeV2Layer, { type: 'image' | 'logo' }>) {
    if (!window.electronAPI?.selectFile) {
      openInfoDialog({
        title: '当前环境不支持',
        message: '请在桌面客户端中选择本地文件。',
      })
      return
    }
    try {
      const path = await window.electronAPI.selectFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
      if (!path) return
      const payload = await window.electronAPI.readImageFile(path)
      if (!payload?.dataUrl) return
      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height
        if (preset && (width > preset.baseCanvas.width || height > preset.baseCanvas.height)) {
          const scale = Math.min(preset.baseCanvas.width / width, preset.baseCanvas.height / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        updateLayer(layer.id, {
          asset: { kind: 'path', path },
          position: { ...layer.position, width, height },
        })
        useStore.getState().showToast('已替换图片素材', 'success')
      }
      img.src = payload.dataUrl
    } catch {
      useStore.getState().showToast('读取图片失败，请重试', 'error')
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim">
      <header className="flex h-ds-control-lg shrink-0 items-center justify-between border-b border-ds-border px-3 dark:border-ds-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">图层信息</h2>
          <span className="text-xs text-ds-muted">{preset?.layers.length ?? 0} 层</span>
        </div>
        <span className="text-xs text-ds-muted">列表从上到下对应画面从顶到底</span>
      </header>

      {!preset ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ds-muted">选择预设后查看图层信息</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <div className="overflow-y-auto border-r border-ds-border p-2 dark:border-ds-border">
            {preset.layers.length ? (
              preset.layers.map((layer, index) => (
                <div
                  data-layer-row="true"
                  key={layer.id}
                  className={`mb-1 flex h-ds-12 items-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-2 ${selectedLayerId === layer.id ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary' : 'hover:bg-ds-subtle dark:hover:bg-ds-surface'}`}
                >
                  <button
                    type="button"
                    title={layer.visible ? '隐藏图层' : '显示图层'}
                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                    className={iconButtonClass}
                  >
                    {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    title={layer.locked ? '解锁图层' : '锁定图层'}
                    onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                    className={iconButtonClass}
                  >
                    {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  </button>
                  {editingLayerId === layer.id ? (
                    <input
                      autoFocus
                      value={editingLayerName}
                      onChange={(e) => setEditingLayerName(e.target.value)}
                      onBlur={finishLayerRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          finishLayerRename()
                        }
                        if (e.key === 'Escape') {
                          setEditingLayerId('')
                          setEditingLayerName('')
                        }
                      }}
                      className="min-w-0 flex-1 cursor-text rounded border border-ds-primary/35 bg-ds-surface px-1 py-0.5 text-xs text-ds-text outline-none dark:bg-ds-scrim dark:text-ds-text-subtle"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectLayer(layer.id)}
                      onDoubleClick={() => beginLayerRename(layer.id, layer.name)}
                      className="min-w-0 flex-1 cursor-pointer overflow-hidden text-left"
                    >
                      <div className="truncate text-xs font-medium">
                        {index + 1}. {layer.name}
                      </div>
                      <div className="truncate text-xs opacity-60">
                        {layer.type === 'text' ? '文字' : layer.type === 'logo' ? 'LOGO' : '图片'} ·{' '}
                        {layer.position.mode === 'free' ? '自由坐标' : '九宫格'}
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    title="上移图层"
                    disabled={index === 0}
                    onClick={() => moveLayer(layer.id, -1)}
                    className={iconButtonClass}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="下移图层"
                    disabled={index === preset.layers.length - 1}
                    onClick={() => moveLayer(layer.id, 1)}
                    className={iconButtonClass}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="删除图层"
                    onClick={() => removeLayer(layer.id)}
                    className={`${iconButtonClass} text-ds-danger`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-ds-muted">
                使用画布左侧工具栏添加文字或图片图层
              </div>
            )}
          </div>

          <div data-layout="layer-properties" className="min-w-0 overflow-hidden">
            {selectedLayer ? (
              <div>
                <div className="flex h-ds-control-lg items-center justify-between border-b border-ds-border px-4 dark:border-ds-border">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ds-text dark:text-ds-text-subtle">
                      {selectedLayer.name}
                    </span>
                    <span className="rounded bg-ds-primary-subtle px-2 py-0.5 text-xs font-medium text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary">
                      {selectedLayer.type === 'text' ? '文字' : selectedLayer.type === 'logo' ? 'LOGO' : '图片'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ds-muted">
                      <input
                        type="checkbox"
                        checked={selectedLayer.visible}
                        onChange={(event) => updateLayer(selectedLayer.id, { visible: event.target.checked })}
                      />
                      显示
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ds-muted">
                      <input
                        type="checkbox"
                        checked={selectedLayer.locked}
                        onChange={(event) => updateLayer(selectedLayer.id, { locked: event.target.checked })}
                      />
                      锁定
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.4fr)] divide-x divide-gray-100 dark:divide-white/[0.08]">
                  <section data-property-group="content" className={groupClass}>
                    <h3 className="mb-3 text-xs font-semibold text-ds-text dark:text-ds-text-subtle">内容</h3>
                    {selectedLayer.type === 'text' ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className={`${labelClass} min-w-[150px] flex-1`}>
                          文字
                          <input
                            value={selectedLayer.text}
                            onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })}
                            className={fieldClass}
                          />
                        </label>
                        <label className={`${labelClass} w-24`}>
                          字体
                          <input
                            value={selectedLayer.fontFamily}
                            onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.target.value })}
                            className={fieldClass}
                          />
                        </label>
                        <label className={`${labelClass} w-14`}>
                          字号
                          <input
                            type="number"
                            value={selectedLayer.fontSize}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })
                            }
                            className={fieldClass}
                          />
                        </label>
                        <label className={`${labelClass} w-14`}>
                          字重
                          <input
                            type="number"
                            value={selectedLayer.fontWeight}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, { fontWeight: Number(event.target.value) })
                            }
                            className={fieldClass}
                          />
                        </label>
                        <label className={`${labelClass} w-12`}>
                          颜色
                          <input
                            type="color"
                            value={selectedLayer.color}
                            onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })}
                            className="mt-1 h-ds-control-sm w-full cursor-pointer rounded border border-ds-border bg-ds-surface p-0.5"
                          />
                        </label>
                        <div className={labelClass}>
                          文字对齐
                          <div className="mt-1 flex gap-1">
                            {[
                              { value: 'left' as const, label: '左对齐', icon: AlignLeft },
                              { value: 'center' as const, label: '居中对齐', icon: AlignCenter },
                              { value: 'right' as const, label: '右对齐', icon: AlignRight },
                            ].map((option) => {
                              const Icon = option.icon
                              const active = selectedLayer.align === option.value
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-label={option.label}
                                  aria-pressed={active}
                                  title={option.label}
                                  onClick={() => updateLayer(selectedLayer.id, { align: option.value })}
                                  className={`${alignButtonClass} ${active ? 'border-ds-primary/35 bg-ds-primary-subtle text-ds-primary' : 'border-ds-border bg-ds-surface hover:bg-ds-subtle'}`}
                                >
                                  <Icon className="h-4 w-4" />
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-end gap-2">
                        <label className={`${labelClass} min-w-0 flex-1`}>
                          文件
                          <div className="mt-1 flex h-ds-control-sm min-w-0 items-center overflow-hidden rounded-md border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim">
                            <span
                              className="min-w-0 flex-1 truncate px-2 text-xs text-ds-muted dark:text-ds-muted"
                              title={
                                selectedLayer.asset && 'path' in selectedLayer.asset
                                  ? selectedLayer.asset.path
                                  : undefined
                              }
                            >
                              {getAssetLabel(selectedLayer)}
                            </span>
                            <button
                              type="button"
                              onClick={() => selectMediaAsset(selectedLayer)}
                              className="h-full shrink-0 border-l border-ds-border px-2.5 text-xs text-ds-primary hover:bg-ds-primary-subtle dark:border-ds-border"
                            >
                              替换
                            </button>
                          </div>
                        </label>
                      </div>
                    )}
                  </section>

                  <section data-property-group="position-size" className={groupClass}>
                    <h3 className="mb-3 text-xs font-semibold text-ds-text dark:text-ds-text-subtle">位置与尺寸</h3>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className={`${labelClass} w-24`} title="定位模式">
                        定位
                        <select
                          value={selectedLayer.position.mode}
                          onChange={(event) =>
                            updateLayer(selectedLayer.id, {
                              position:
                                event.target.value === 'free'
                                  ? {
                                      mode: 'free',
                                      x: 100,
                                      y: 100,
                                      width: selectedLayer.position.width,
                                      height: selectedLayer.position.height,
                                    }
                                  : {
                                      mode: 'anchor',
                                      anchor: 'center',
                                      marginX: 0,
                                      marginY: 0,
                                      offsetX: 0,
                                      offsetY: 0,
                                      width: selectedLayer.position.width,
                                      height: selectedLayer.position.height,
                                    },
                            })
                          }
                          className={`${fieldClass} cursor-pointer`}
                        >
                          <option value="free">自由坐标</option>
                          <option value="anchor">九宫格</option>
                        </select>
                      </label>
                      {selectedLayer.position.mode === 'anchor' ? (
                        <>
                          <label className={`${labelClass} w-24`}>
                            锚点
                            <select
                              value={selectedLayer.position.anchor}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'anchor')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, anchor: event.target.value as typeof position.anchor },
                                  })
                              }}
                              className={`${fieldClass} cursor-pointer`}
                            >
                              <option value="top-left">左上</option>
                              <option value="top-center">上中</option>
                              <option value="top-right">右上</option>
                              <option value="center-left">左中</option>
                              <option value="center">居中</option>
                              <option value="center-right">右中</option>
                              <option value="bottom-left">左下</option>
                              <option value="bottom-center">下中</option>
                              <option value="bottom-right">右下</option>
                            </select>
                          </label>
                          <label className={`${labelClass} w-16`} title="基础水平边距">
                            边距 X
                            <input
                              type="number"
                              value={selectedLayer.position.marginX}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'anchor')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, marginX: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                          <label className={`${labelClass} w-16`} title="基础垂直边距">
                            边距 Y
                            <input
                              type="number"
                              value={selectedLayer.position.marginY}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'anchor')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, marginY: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                          <label className={`${labelClass} w-16`} title="额外水平偏移">
                            偏移 X
                            <input
                              type="number"
                              value={selectedLayer.position.offsetX}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'anchor')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, offsetX: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                          <label className={`${labelClass} w-16`} title="额外垂直偏移">
                            偏移 Y
                            <input
                              type="number"
                              value={selectedLayer.position.offsetY}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'anchor')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, offsetY: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label className={`${labelClass} w-16`}>
                            坐标 X
                            <input
                              type="number"
                              value={selectedLayer.position.x}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'free')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, x: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                          <label className={`${labelClass} w-16`}>
                            坐标 Y
                            <input
                              type="number"
                              value={selectedLayer.position.y}
                              onChange={(event) => {
                                const position = selectedLayer.position
                                if (position.mode === 'free')
                                  updateLayer(selectedLayer.id, {
                                    position: { ...position, y: Number(event.target.value) },
                                  })
                              }}
                              className={fieldClass}
                            />
                          </label>
                        </>
                      )}
                      <label className={`${labelClass} w-16`}>
                        尺寸 W
                        <input
                          type="number"
                          min={1}
                          value={selectedLayer.position.width}
                          onChange={(event) =>
                            updateLayer(selectedLayer.id, {
                              position: { ...selectedLayer.position, width: Math.max(1, Number(event.target.value)) },
                            })
                          }
                          className={fieldClass}
                        />
                      </label>
                      <label className={`${labelClass} w-16`}>
                        尺寸 H
                        <input
                          type="number"
                          min={1}
                          value={selectedLayer.position.height}
                          onChange={(event) =>
                            updateLayer(selectedLayer.id, {
                              position: { ...selectedLayer.position, height: Math.max(1, Number(event.target.value)) },
                            })
                          }
                          className={fieldClass}
                        />
                      </label>
                    </div>
                  </section>

                  <section data-property-group="appearance" className={groupClass}>
                    <h3 className="mb-3 text-xs font-semibold text-ds-text dark:text-ds-text-subtle">外观</h3>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className={`${labelClass} w-16`}>
                        透明度
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(selectedLayer.opacity * 100)}
                          onChange={(event) =>
                            updateLayer(selectedLayer.id, {
                              opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                            })
                          }
                          className={fieldClass}
                        />
                      </label>
                      <label className={`${labelClass} w-16`}>
                        旋转
                        <input
                          type="number"
                          value={selectedLayer.rotation}
                          onChange={(event) => updateLayer(selectedLayer.id, { rotation: Number(event.target.value) })}
                          className={fieldClass}
                        />
                      </label>
                      {selectedLayer.type === 'text' ? (
                        <label className={`${labelClass} w-16`}>
                          内边距
                          <input
                            type="number"
                            min={0}
                            value={selectedLayer.padding ?? 5}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, { padding: Math.max(0, Number(event.target.value)) })
                            }
                            className={fieldClass}
                          />
                        </label>
                      ) : (
                        <>
                          <label className={`${labelClass} w-16`}>
                            圆角
                            <input
                              type="number"
                              min={0}
                              value={selectedLayer.radius}
                              onChange={(event) =>
                                updateLayer(selectedLayer.id, { radius: Math.max(0, Number(event.target.value)) })
                              }
                              className={fieldClass}
                            />
                          </label>
                          <label className="flex h-ds-control-sm cursor-pointer items-center gap-1.5 text-xs text-ds-muted">
                            <input
                              type="checkbox"
                              checked={selectedLayer.clip}
                              onChange={(event) => updateLayer(selectedLayer.id, { clip: event.target.checked })}
                            />
                            裁切
                          </label>
                        </>
                      )}
                    </div>
                  </section>

                  <section data-property-group="effects" className={groupClass}>
                    <h3 className="mb-3 text-xs font-semibold text-ds-text dark:text-ds-text-subtle">效果</h3>
                    <div className="flex flex-wrap items-start gap-2">
                      <div
                        className={`flex items-end gap-2 rounded-md p-2 ${selectedLayer.stroke?.enabled ? 'bg-ds-primary-subtle/80 dark:bg-ds-primary/10' : 'bg-ds-surface dark:bg-ds-surface'}`}
                      >
                        <label className="flex h-ds-control-sm cursor-pointer items-center gap-1.5 text-xs font-medium text-ds-muted dark:text-ds-muted">
                          <input
                            type="checkbox"
                            checked={selectedLayer.stroke?.enabled ?? false}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, {
                                stroke: { ...(selectedLayer.stroke ?? defaultStroke), enabled: event.target.checked },
                              })
                            }
                          />
                          描边
                        </label>
                        <label className={`${labelClass} w-14`}>
                          描边颜色
                          <input
                            type="color"
                            value={selectedLayer.stroke?.color ?? defaultStroke.color}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, {
                                stroke: { ...(selectedLayer.stroke ?? defaultStroke), color: event.target.value },
                              })
                            }
                            disabled={!selectedLayer.stroke?.enabled}
                            className="mt-1 h-ds-control-sm w-full cursor-pointer rounded border border-ds-border bg-ds-surface p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </label>
                        <label className={`${labelClass} w-14`}>
                          描边宽度
                          <input
                            type="number"
                            min={0}
                            value={selectedLayer.stroke?.width ?? 0}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, {
                                stroke: {
                                  ...(selectedLayer.stroke ?? defaultStroke),
                                  width: Math.max(0, Number(event.target.value)),
                                },
                              })
                            }
                            disabled={!selectedLayer.stroke?.enabled}
                            className={fieldClass}
                          />
                        </label>
                      </div>

                      <div
                        className={`flex flex-wrap items-end gap-2 rounded-md p-2 ${selectedLayer.shadow.enabled ? 'bg-ds-primary-subtle/80 dark:bg-ds-primary/10' : 'bg-ds-surface dark:bg-ds-surface'}`}
                      >
                        <label className="flex h-ds-control-sm cursor-pointer items-center gap-1.5 text-xs font-medium text-ds-muted dark:text-ds-muted">
                          <input
                            type="checkbox"
                            checked={selectedLayer.shadow.enabled}
                            onChange={(event) =>
                              updateLayer(selectedLayer.id, {
                                shadow: { ...selectedLayer.shadow, enabled: event.target.checked },
                              })
                            }
                          />
                          阴影
                        </label>
                        {selectedLayer.shadow.enabled && (
                          <>
                            <label className={`${labelClass} w-12`}>
                              颜色
                              <input
                                type="color"
                                value={selectedLayer.shadow.color}
                                onChange={(event) =>
                                  updateLayer(selectedLayer.id, {
                                    shadow: { ...selectedLayer.shadow, color: event.target.value },
                                  })
                                }
                                className="mt-1 h-ds-control-sm w-full cursor-pointer rounded border border-ds-border bg-ds-surface p-0.5"
                              />
                            </label>
                            <label className={`${labelClass} w-12`}>
                              X
                              <input
                                type="number"
                                value={selectedLayer.shadow.x}
                                onChange={(event) =>
                                  updateLayer(selectedLayer.id, {
                                    shadow: { ...selectedLayer.shadow, x: Number(event.target.value) },
                                  })
                                }
                                className={fieldClass}
                              />
                            </label>
                            <label className={`${labelClass} w-12`}>
                              Y
                              <input
                                type="number"
                                value={selectedLayer.shadow.y}
                                onChange={(event) =>
                                  updateLayer(selectedLayer.id, {
                                    shadow: { ...selectedLayer.shadow, y: Number(event.target.value) },
                                  })
                                }
                                className={fieldClass}
                              />
                            </label>
                            <label className={`${labelClass} w-12`}>
                              模糊
                              <input
                                type="number"
                                min={0}
                                value={selectedLayer.shadow.blur}
                                onChange={(event) =>
                                  updateLayer(selectedLayer.id, {
                                    shadow: { ...selectedLayer.shadow, blur: Math.max(0, Number(event.target.value)) },
                                  })
                                }
                                className={fieldClass}
                              />
                            </label>
                            <label className={`${labelClass} w-14`}>
                              不透明度
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={Math.round(selectedLayer.shadow.opacity * 100)}
                                onChange={(event) =>
                                  updateLayer(selectedLayer.id, {
                                    shadow: {
                                      ...selectedLayer.shadow,
                                      opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                                    },
                                  })
                                }
                                className={fieldClass}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ds-muted">
                {preset.layers.length ? '从左侧列表选择一个图层进行精调' : '当前预设还没有图层'}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
