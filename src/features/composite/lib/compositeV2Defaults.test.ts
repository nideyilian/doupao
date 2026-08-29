import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups } from './compositeV2Defaults'

describe('composite v2 defaults', () => {
  it('creates the confirmed disabled output-size catalog', () => {
    const groups = createDefaultCompositeV2OutputRuleGroups()

    expect(
      groups.map((group) => ({
        name: group.name,
        rules: group.rules.map(({ width, height, maxSizeKb, enabled }) => ({
          width,
          height,
          maxSizeKb,
          enabled,
        })),
      })),
    ).toEqual([
      {
        name: '广点通',
        rules: [
          { width: 1280, height: 720, maxSizeKb: 399, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
        ],
      },
      {
        name: '百度',
        rules: [
          { width: 1140, height: 640, maxSizeKb: 299, enabled: false },
          { width: 370, height: 245, maxSizeKb: 299, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
        ],
      },
      {
        name: '厂商',
        rules: [
          { width: 1280, height: 720, maxSizeKb: 99, enabled: false },
          { width: 1080, height: 1920, maxSizeKb: 99, enabled: false },
          { width: 320, height: 211, maxSizeKb: 80, enabled: false },
          { width: 320, height: 210, maxSizeKb: 80, enabled: false },
          { width: 720, height: 1280, maxSizeKb: 99, enabled: false },
          { width: 720, height: 498, maxSizeKb: 99, enabled: false },
          { width: 474, height: 768, maxSizeKb: 99, enabled: false },
          { width: 1080, height: 528, maxSizeKb: 99, enabled: false },
        ],
      },
      {
        name: '头条',
        rules: [
          { width: 1080, height: 1920, maxSizeKb: 399, enabled: false },
          { width: 1280, height: 720, maxSizeKb: 399, enabled: false },
        ],
      },
    ])
  })
})
