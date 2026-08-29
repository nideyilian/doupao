import { describe, expect, it } from 'vitest'
import { buildProfileSummary, parseVisualProfiles } from './visualProfile'

describe('visual profile', () => {
  it('解析多图 JSON 数组档案', () => {
    const text = JSON.stringify([
      {
        subject: '柴犬，坐姿',
        subjectCategory: '犬科动物',
        style: '日系水彩',
        composition: '中心构图',
        color: '暖橙主色',
        scene: '室内客厅',
        lighting: '柔光',
        material: '纸质纹理',
        mood: '温馨',
        textElements: ['WELCOME'],
        coreVisualMechanism: '主体与背景负形融合',
        derivableDimensions: ['主体', '风格', '场景'],
        lockedFacts: ['WELCOME 文字'],
      },
    ])
    const profiles = parseVisualProfiles(text)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].subject).toBe('柴犬，坐姿')
    expect(profiles[0].textElements).toEqual(['WELCOME'])
    expect(profiles[0].derivableDimensions).toContain('主体')
  })

  it('容忍 markdown 代码围栏', () => {
    const text = '```json\n[{"subject":"猫","style":"油画"}]\n```'
    const profiles = parseVisualProfiles(text)
    expect(profiles[0].subject).toBe('猫')
  })

  it('单个对象也兼容解析', () => {
    const profiles = parseVisualProfiles('{"subject":"猫","style":"油画"}')
    expect(profiles).toHaveLength(1)
    expect(profiles[0].subject).toBe('猫')
    expect(profiles[0].textElements).toEqual([])
  })

  it('非法输入抛错', () => {
    expect(() => parseVisualProfiles('不是 JSON')).toThrow('视觉档案解析失败')
  })

  it('档案摘要只包含关键字段', () => {
    const profiles = parseVisualProfiles(
      JSON.stringify([{ subject: '猫', subjectCategory: '猫科', style: '油画', lockedFacts: ['品牌'] }]),
    )
    const summary = buildProfileSummary(profiles)
    expect(summary).toContain('参考图 1')
    expect(summary).toContain('主体：猫（上位类别：猫科）')
    expect(summary).toContain('必须锁定的事实：品牌')
  })
})
