import { describe, expect, it } from 'vitest'
import { createBlankCompositeProduct, getEnabledCompositeProductSizeRules } from './compositeProducts'

describe('composite product helpers', () => {
  it('creates a product with an input folder and independent size rules', () => {
    const product = createBlankCompositeProduct('product-a', 'Product A')

    expect(product.name).toBe('Product A')
    expect(product.inputPath).toBe('')
    expect(product.sizeRules[0]).toMatchObject({
      name: '主尺寸输出',
      width: 1280,
      height: 720,
      maxSizeKb: 350,
      format: 'jpg',
    })
  })

  it('returns only enabled size rules with an output directory', () => {
    const product = createBlankCompositeProduct('product-a', 'Product A')
    product.sizeRules = [
      { ...product.sizeRules[0], id: 'main', enabled: true, outputPath: 'D:/out/main' },
      { ...product.sizeRules[0], id: 'disabled', enabled: false, outputPath: 'D:/out/disabled' },
      { ...product.sizeRules[0], id: 'missing-path', enabled: true, outputPath: '' },
    ]

    expect(getEnabledCompositeProductSizeRules(product).map((rule) => rule.id)).toEqual(['main'])
  })
})
