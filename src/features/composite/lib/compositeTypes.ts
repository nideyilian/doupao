export type CompositePickMode = 'random' | 'sequential'

export type CompositeLayerId = string

export type CompositeCanvas = {
  width: number
  height: number
}

export type CompositePaintStyle = {
  type: 'solid' | 'linear-gradient'
  color: string
  color2: string
}

export type CompositeStrokeStyle = {
  enabled: boolean
  position: 'inside' | 'center' | 'outside'
  width: number
  paint: CompositePaintStyle
}

export type CompositeGlowStyle = {
  enabled: boolean
  color: string
  size: number
  opacity: number
}

export type CompositeShadowStyle = {
  enabled: boolean
  color: string
  x: number
  y: number
  blur: number
  opacity: number
}

export type CompositeLayerStyle = {
  fill: CompositePaintStyle
  stroke: CompositeStrokeStyle
  innerGlow: CompositeGlowStyle
  outerGlow: CompositeGlowStyle
  shadow: CompositeShadowStyle
}

export type CompositeFsImage = {
  path: string
  name: string
  dataUrl?: string
  width?: number
  height?: number
}

export type CompositeLayerBase = {
  id: CompositeLayerId
  name: string
  type: string
  watermarkPresetId?: string
  enabled: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  opacity: number
  style?: CompositeLayerStyle
}

export type CompositeBackgroundLayer = CompositeLayerBase & {
  type: 'background'
  sourcePath: string
  sourceDataUrl?: string
  fit: 'cover' | 'contain' | 'stretch'
}

export type CompositeImageLayer = CompositeLayerBase & {
  type: 'image' | 'logo'
  sourcePath: string
  sourceName: string
  sourceDataUrl?: string
  sourceWidth?: number
  sourceHeight?: number
  mirrorX: boolean
  mirrorY: boolean
}

export type CompositeTextLayer = CompositeLayerBase & {
  type: 'text' | 'watermark'
  text: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  strokeColor: string
  strokeWidth: number
}

export type CompositeColorBlockLayer = CompositeLayerBase & {
  type: 'colorBlock'
  fill: string
  radius: number
}

export type CompositeLayer =
  CompositeBackgroundLayer | CompositeImageLayer | CompositeTextLayer | CompositeColorBlockLayer

export type CompositeMainOutputRule = {
  enabled: boolean
  outputPath: string
  namingTemplate: string
  maxSizeKb: number
  format: 'jpg'
}

export type CompositeCustomOutputRule = CompositeMainOutputRule & {
  id: string
  name: string
  width: number
  height: number
}

export type CompositePreset = {
  id: string
  name: string
  canvas: CompositeCanvas
  pickMode: CompositePickMode
  backgroundPath: string
  patchPaths: string
  layers: CompositeLayer[]
  output: {
    main: CompositeMainOutputRule
    custom: CompositeCustomOutputRule[]
  }
}

export type CompositePage = {
  id: string
  name: string
  enabled: boolean
  preset: CompositePreset
}

export type CompositeCategory = {
  id: string
  name: string
  enabled: boolean
  collapsed: boolean
  pages: CompositePage[]
}

export type CompositeExportRecord = {
  runId: string
  outputPath: string
  count: number
  createdAt: number
}

export type CompositeExportSummary = {
  outputPath: string
  count: number
}

export type CompositeWatermarkKind = 'text' | 'icon' | 'iconText' | 'custom'

export type CompositeWatermarkPreset = {
  id: string
  name: string
  kind: CompositeWatermarkKind
  enabled: boolean
  layers: CompositeLayer[]
  sizeRules: CompositeProductSizeRule[]
  namingTokens?: string[]
  distribution: {
    enabled: boolean
    outputPath: string
    count: number
  }
}

export type CompositeWatermarkGroup = {
  id: string
  name: string
  presetIds: string[]
}

export type CompositeProductSizeRule = {
  id: string
  name: string
  enabled: boolean
  width: number
  height: number
  outputPath: string
  namingTemplate: string
  maxSizeKb: number
  format: 'jpg'
}

export type CompositeSelectedOutputRule = CompositeProductSizeRule & {
  categoryName: string
}

export type CompositeOutputPresetGroup = {
  id: string
  name: string
  rules: CompositeProductSizeRule[]
}

export type CompositeProduct = {
  id: string
  name: string
  enabled: boolean
  inputPath: string
  outputRootPath: string
  pickMode: CompositePickMode
  templateCategoryId: string
  templatePageId: string
  selectedWatermarkPresetIds: string[]
  selectedWatermarkGroupIds: string[]
  sizeRules: CompositeProductSizeRule[]
}

export type CompositeWorkspaceStateSnapshot = {
  categories: CompositeCategory[]
  activeCategoryId: string
  activePageId: string
  products: CompositeProduct[]
  activeProductId: string
  watermarkPresets: CompositeWatermarkPreset[]
  watermarkGroups: CompositeWatermarkGroup[]
  outputPresetGroups: CompositeOutputPresetGroup[]
  iconLibraryPath: string
  iconLibraryAssets: CompositeFsImage[]
  exportRecords: CompositeExportRecord[]
}
