import { describe, expect, it } from 'vitest'
import { planRequirementOrder } from './planner'
import { seedRequirementCatalog } from './seed'

describe('planRequirementOrder', () => {
  it('multiplies products, channels, ratios, material types and quantity', () => {
    const catalog = seedRequirementCatalog()
    const result = planRequirementOrder(
      {
        productIds: catalog.products.slice(0, 2).map((item) => item.id),
        channels: [{ channelId: catalog.channels[0].id, ratios: ['16:9', '9:16'] }],
        materialTypeIds: catalog.materialTypes.slice(0, 2).map((item) => item.id),
        quantity: 50,
        urgentRequested: false,
      },
      catalog,
      { maxImagesPerOrder: 500, remainingDailyQuota: 2000 },
    )

    expect(result.units).toHaveLength(8)
    expect(result.totalImages).toBe(400)
    expect(result.valid).toBe(true)
  })

  it('blocks requests above the configured order limit', () => {
    const catalog = seedRequirementCatalog()
    const result = planRequirementOrder(
      {
        productIds: catalog.products.map((item) => item.id),
        channels: catalog.channels.map((item) => ({ channelId: item.id, ratios: ['16:9', '9:16'] as const })),
        materialTypeIds: catalog.materialTypes.map((item) => item.id),
        quantity: 50,
        urgentRequested: false,
      },
      catalog,
      { maxImagesPerOrder: 500, remainingDailyQuota: 2000 },
    )

    expect(result.totalImages).toBe(4500)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('超过单张需求上限')
  })

  it('excludes only the fixed-rule ratio that is not supported', () => {
    const catalog = seedRequirementCatalog()
    catalog.materialTypes[3] = { ...catalog.materialTypes[3], supportedRatios: ['9:16'] }
    const result = planRequirementOrder(
      {
        productIds: [catalog.products[0].id],
        channels: [{ channelId: catalog.channels[0].id, ratios: ['16:9', '9:16'] }],
        materialTypeIds: [catalog.materialTypes[3].id],
        quantity: 50,
        urgentRequested: false,
      },
      catalog,
      { maxImagesPerOrder: 500, remainingDailyQuota: 2000 },
    )

    expect(result.units).toHaveLength(1)
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reason).toContain('固定规则缺少')
  })
})
