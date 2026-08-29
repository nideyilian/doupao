import type {
  CompositeCategory,
  CompositeColorBlockLayer,
  CompositeImageLayer,
  CompositeLayerStyle,
  CompositePage,
  CompositeProduct,
  CompositePreset,
  CompositeTextLayer,
  CompositeWorkspaceStateSnapshot,
} from './compositeTypes'
import { createDefaultCompositeOutputPresetGroups } from './compositeOutputPresets'

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultCompositeLayerStyle(fillColor = '#ffffff'): CompositeLayerStyle {
  return {
    fill: { type: 'solid', color: fillColor, color2: '#f3f4f6' },
    stroke: {
      enabled: false,
      position: 'center',
      width: 0,
      paint: { type: 'solid', color: '#ffffff', color2: '#93c5fd' },
    },
    innerGlow: { enabled: false, color: '#ffffff', size: 8, opacity: 0.35 },
    outerGlow: { enabled: false, color: '#ffffff', size: 12, opacity: 0.45 },
    shadow: { enabled: false, color: '#000000', x: 0, y: 6, blur: 12, opacity: 0.25 },
  }
}

export function createCompositeTextLayer(id = createId('text'), name = '主文字'): CompositeTextLayer {
  return {
    id,
    name,
    type: 'text',
    enabled: true,
    locked: false,
    x: 20,
    y: 72,
    width: 60,
    height: 10,
    opacity: 1,
    style: createDefaultCompositeLayerStyle('#111827'),
    text: '产品标题',
    fontSize: 42,
    fontFamily: 'sans-serif',
    fontWeight: 700,
    color: '#111827',
    align: 'center',
    strokeColor: '#ffffff',
    strokeWidth: 0,
  }
}

export function createCompositeWatermarkLayer(id = createId('watermark')): CompositeTextLayer {
  return {
    ...createCompositeTextLayer(id, '水印文字'),
    type: 'watermark',
    x: 66,
    y: 88,
    width: 28,
    height: 6,
    opacity: 0.72,
    text: 'DOUPAO',
    fontSize: 18,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,
  }
}

export function createCompositeLogoLayer(id = createId('logo')): CompositeImageLayer {
  return {
    id,
    name: 'Logo',
    type: 'logo',
    enabled: true,
    locked: false,
    x: 6,
    y: 6,
    width: 12,
    height: 12,
    opacity: 1,
    sourcePath: '',
    sourceName: 'Logo',
    sourceDataUrl: './app-icon.png',
    style: createDefaultCompositeLayerStyle('#ffffff'),
    mirrorX: false,
    mirrorY: false,
  }
}

export function createCompositeImageLayer(id = createId('image'), name = '贴片'): CompositeImageLayer {
  return {
    id,
    name,
    type: 'image',
    enabled: true,
    locked: false,
    x: 32,
    y: 24,
    width: 36,
    height: 36,
    opacity: 1,
    sourcePath: '',
    sourceName: name,
    style: createDefaultCompositeLayerStyle('#ffffff'),
    mirrorX: false,
    mirrorY: false,
  }
}

export function createCompositeColorBlockLayer(id = createId('block')): CompositeColorBlockLayer {
  return {
    id,
    name: '色块',
    type: 'colorBlock',
    enabled: true,
    locked: false,
    x: 14,
    y: 68,
    width: 72,
    height: 18,
    opacity: 0.28,
    style: createDefaultCompositeLayerStyle('#ffffff'),
    fill: '#ffffff',
    radius: 24,
  }
}

export function createCompositeVectorShapeLayer(id = createId('shape')): CompositeColorBlockLayer {
  return {
    ...createCompositeColorBlockLayer(id),
    name: '矢量形状',
    opacity: 1,
    fill: '#ffffff',
    style: createDefaultCompositeLayerStyle('#ffffff'),
  }
}

export function createBlankCompositePreset(id = createId('preset'), name = '默认合成'): CompositePreset {
  return {
    id,
    name,
    canvas: { width: 1280, height: 720 },
    pickMode: 'random',
    backgroundPath: '',
    patchPaths: '',
    layers: [
      {
        id: 'background',
        name: '背景',
        type: 'background',
        enabled: true,
        locked: true,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 1,
        sourcePath: '',
        fit: 'cover',
      },
    ],
    output: {
      main: {
        enabled: true,
        outputPath: '',
        namingTemplate: '{date}-{page}-{index}',
        maxSizeKb: 350,
        format: 'jpg',
      },
      custom: [],
    },
  }
}

export function createBlankCompositePage(id = createId('page'), name = '页面 1'): CompositePage {
  return {
    id,
    name,
    enabled: true,
    preset: createBlankCompositePreset(`preset-${id}`, name),
  }
}

export function createBlankCompositeCategory(id = createId('category'), name = '默认类目'): CompositeCategory {
  return {
    id,
    name,
    enabled: true,
    collapsed: false,
    pages: [createBlankCompositePage('page-default', '默认页面')],
  }
}

export function createDefaultCompositeWorkspaceState(): CompositeWorkspaceStateSnapshot {
  const category = createBlankCompositeCategory('category-default', '默认合成')
  const page = category.pages[0]
  const product: CompositeProduct = {
    id: 'product-default',
    name: '默认产品',
    enabled: true,
    inputPath: '',
    outputRootPath: '',
    pickMode: 'random',
    templateCategoryId: category.id,
    templatePageId: page.id,
    selectedWatermarkPresetIds: [],
    selectedWatermarkGroupIds: [],
    sizeRules: [
      {
        id: 'product-default-main',
        name: '主尺寸输出',
        enabled: true,
        width: 1280,
        height: 720,
        outputPath: '',
        namingTemplate: '{date}-{product}-{index}',
        maxSizeKb: 350,
        format: 'jpg',
      },
    ],
  }
  return {
    categories: [category],
    activeCategoryId: category.id,
    activePageId: page.id,
    products: [product],
    activeProductId: product.id,
    watermarkPresets: [],
    watermarkGroups: [],
    outputPresetGroups: createDefaultCompositeOutputPresetGroups(),
    iconLibraryPath: '',
    iconLibraryAssets: [],
    exportRecords: [],
  }
}
