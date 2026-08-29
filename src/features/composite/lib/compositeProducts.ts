import type { CompositeProduct, CompositeProductSizeRule } from './compositeTypes'

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBlankCompositeProduct(id = createId('product'), name = '产品 1'): CompositeProduct {
  return {
    id,
    name,
    enabled: true,
    inputPath: '',
    outputRootPath: '',
    pickMode: 'random',
    templateCategoryId: '',
    templatePageId: '',
    selectedWatermarkPresetIds: [],
    selectedWatermarkGroupIds: [],
    sizeRules: [
      {
        id: `${id}-main`,
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
}

export function createCompositeProductSizeRule(id = createId('size'), name = '自定义尺寸'): CompositeProductSizeRule {
  return {
    id,
    name,
    enabled: true,
    width: 800,
    height: 800,
    outputPath: '',
    namingTemplate: '{date}-{product}-{index}-{size}',
    maxSizeKb: 350,
    format: 'jpg',
  }
}

export function getEnabledCompositeProductSizeRules(product: CompositeProduct) {
  return product.sizeRules.filter((rule) => rule.enabled && rule.outputPath.trim())
}
