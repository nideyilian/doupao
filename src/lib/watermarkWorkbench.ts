export interface WatermarkLogoSource {
  id: string
  name: string
  dataUrl: string
}

export interface WatermarkImageInput {
  id: string
  name: string
  dataUrl: string
}

interface WatermarkLayerBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
}

export interface WatermarkImageLayer extends WatermarkLayerBase {
  type: 'image'
  sourceId: string
  sourceName: string
  sourceDataUrl: string
}

export interface WatermarkTextLayer extends WatermarkLayerBase {
  type: 'text'
  text: string
  fontSize: number
  color: string
  fontFamily?: string
  fontWeight?: 400 | 500 | 600 | 700 | 800
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  strokeColor?: string
  strokeWidth?: number
}

export interface WatermarkShapeLayer extends WatermarkLayerBase {
  type: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  fill: string
  strokeColor: string
  strokeWidth: number
  radius: number
}

export type WatermarkLayer = WatermarkImageLayer | WatermarkTextLayer | WatermarkShapeLayer

export interface WatermarkPreset {
  id: string
  name: string
  layers: WatermarkLayer[]
  selected: boolean
}

export interface WatermarkExportJob {
  image: WatermarkImageInput
  preset: WatermarkPreset
}

export function replaceLogoLayer(layer: WatermarkLayer, logo: WatermarkLogoSource): WatermarkLayer {
  if (layer.type !== 'image') return layer
  return {
    ...layer,
    sourceId: logo.id,
    sourceName: logo.name,
    sourceDataUrl: logo.dataUrl,
  }
}

export function buildWatermarkExportJobs(
  images: WatermarkImageInput[],
  presets: WatermarkPreset[],
): WatermarkExportJob[] {
  const selectedPresets = presets.filter((preset) => preset.selected)
  return images.flatMap((image) => selectedPresets.map((preset) => ({ image, preset })))
}

export function createWatermarkTextLayer(id: string, text: string): WatermarkTextLayer {
  return {
    id,
    type: 'text',
    x: 24,
    y: 78,
    width: 52,
    height: 9,
    opacity: 1,
    text,
    fontSize: 24,
    color: '#111827',
    fontFamily: 'sans-serif',
    fontWeight: 700,
    italic: false,
    align: 'center',
    strokeColor: '#ffffff',
    strokeWidth: 0,
  }
}

export function createWatermarkShapeLayer(id: string, shape: WatermarkShapeLayer['shape']): WatermarkShapeLayer {
  return {
    id,
    type: 'shape',
    shape,
    x: 22,
    y: 76,
    width: 56,
    height: 12,
    opacity: 0.35,
    fill: '#ffffff',
    strokeColor: '#111827',
    strokeWidth: 0,
    radius: 0,
  }
}

export function createDistributedFileName({
  pattern,
  imageName,
  presetName,
  date,
  extension,
}: {
  pattern: string
  imageName: string
  presetName: string
  date: Date
  extension: string
}) {
  const base = pattern
    .replaceAll('{date}', formatDateToken(date))
    .replaceAll('{image}', stripExtension(imageName))
    .replaceAll('{preset}', presetName)
  const normalizedExtension = extension.replace(/^\.+/, '') || 'png'
  return `${sanitizeFileName(base)}.${normalizedExtension}`
}

function formatDateToken(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function stripExtension(value: string) {
  return value.replace(/\.[^.\\/]+$/, '')
}

function sanitizeFileName(value: string) {
  return (
    value
      // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .trim()
      .replace(/^\.+|\.+$/g, '') || 'image'
  )
}
