import { describe, expect, it } from 'vitest'
import {
  SOP_SERIES_COPY_DIMENSION,
  SOP_SERIES_DEFAULT_FIXED_DIMENSIONS,
  SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS,
  SOP_SERIES_DIMENSIONS,
  buildSopSeriesConfig,
  buildSopSeriesLockedCopy,
  buildSopSeriesLockedFixedBlock,
  getSopSeriesFreeFixedDimensions,
  getSopSeriesVariableDimensions,
  isSopSeriesCopyFixed,
  mergeSopSeriesFixedBlock,
} from './sopSeriesDimensions'
import type { SopSeriesConfig } from './types'

const seriesConfig = (patch: Partial<SopSeriesConfig> = {}): SopSeriesConfig => ({
  imageCount: 3,
  fixedDimensions: ['画风', '构图'],
  variableDimensions: ['色彩', '光线', '视角', '主体', '背景', SOP_SERIES_COPY_DIMENSION],
  ...patch,
})

describe('SOP series dimensions', () => {
  it('ships a duplicate-free library that covers both default lists', () => {
    expect(new Set(SOP_SERIES_DIMENSIONS).size).toBe(SOP_SERIES_DIMENSIONS.length)
    for (const dimension of [...SOP_SERIES_DEFAULT_FIXED_DIMENSIONS, ...SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS]) {
      expect(SOP_SERIES_DIMENSIONS).toContain(dimension)
    }
    // 默认的固定与变化维度不能重叠，否则同一个维度会同时出现在两边
    expect(
      SOP_SERIES_DEFAULT_FIXED_DIMENSIONS.filter((dimension) =>
        SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS.includes(dimension),
      ),
    ).toEqual([])
    // 默认两个列表加起来必须覆盖整个维度库，否则会有维度既没固定也没变化
    expect(SOP_SERIES_DIMENSIONS.length).toBe(
      SOP_SERIES_DEFAULT_FIXED_DIMENSIONS.length + SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS.length,
    )
  })

  it('derives the variable dimensions as the complement of the fixed ones', () => {
    expect(getSopSeriesVariableDimensions(SOP_SERIES_DEFAULT_FIXED_DIMENSIONS)).toEqual(
      SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS,
    )
    expect(getSopSeriesVariableDimensions(['画风', '主体'])).toEqual([
      '构图',
      '色彩',
      '光线',
      '视角',
      '背景',
      '文案内容',
    ])
    // 全部固定时变化维度为空；此时模型改为逐条写完整画面描述，不会出现空规则
    expect(getSopSeriesVariableDimensions(SOP_SERIES_DIMENSIONS)).toEqual([])
  })

  it('builds the per-run series config from the fixed list and the filled values', () => {
    expect(buildSopSeriesConfig({ imageCount: 2, fixedDimensions: ['画风', '主体'] })).toEqual({
      imageCount: 2,
      fixedDimensions: ['画风', '主体'],
      variableDimensions: ['构图', '色彩', '光线', '视角', '背景', '文案内容'],
    })
    expect(
      buildSopSeriesConfig({
        imageCount: 3,
        fixedDimensions: ['画风', '构图'],
        fixedValues: { 画风: '3D 皮克斯风', 构图: '', 背景: '不该保留' },
      }),
    ).toEqual({
      imageCount: 3,
      fixedDimensions: ['画风', '构图'],
      variableDimensions: ['色彩', '光线', '视角', '主体', '背景', '文案内容'],
      // 只保留固定维度里填了值的项；空串与非固定维度都不进配置
      fixedValues: { 画风: '3D 皮克斯风' },
    })
    // 一个值都没填时不下发 fixedValues，避免把空对象写进运行配置
    expect(buildSopSeriesConfig({ imageCount: 3, fixedDimensions: ['画风'] })).not.toHaveProperty('fixedValues')
  })

  it('builds the locked fixed block from the filled fixed dimensions only', () => {
    expect(buildSopSeriesLockedFixedBlock(seriesConfig({ fixedValues: { 画风: '3D 皮克斯风' } }))).toBe(
      '画风：3D 皮克斯风',
    )
    // 顺序跟随 fixedDimensions，值两端空白被 trim
    expect(
      buildSopSeriesLockedFixedBlock(seriesConfig({ fixedValues: { 构图: '  中心对称  ', 画风: '3D 皮克斯风' } })),
    ).toBe('画风：3D 皮克斯风；构图：中心对称')
    // 纯空白与未填的维度都不进固定块
    expect(buildSopSeriesLockedFixedBlock(seriesConfig({ fixedValues: { 画风: '   ' } }))).toBe('')
    expect(buildSopSeriesLockedFixedBlock(seriesConfig())).toBe('')
    // 变化维度的值即使存在也不会被拼进去
    expect(buildSopSeriesLockedFixedBlock(seriesConfig({ fixedValues: { 主体: '咖啡杯' } }))).toBe('')
  })

  it('lists the fixed dimensions still left to the model', () => {
    expect(getSopSeriesFreeFixedDimensions(seriesConfig())).toEqual(['画风', '构图'])
    expect(getSopSeriesFreeFixedDimensions(seriesConfig({ fixedValues: { 画风: '3D 皮克斯风' } }))).toEqual(['构图'])
    expect(getSopSeriesFreeFixedDimensions(seriesConfig({ fixedValues: { 画风: '   ' } }))).toEqual(['画风', '构图'])
  })

  it('keeps 文案内容 out of the fixed block because that block is declared non-picture text', () => {
    const config = seriesConfig({
      fixedDimensions: ['画风', SOP_SERIES_COPY_DIMENSION],
      variableDimensions: ['构图', '色彩', '光线', '视角', '主体', '背景'],
      fixedValues: { 画风: '3D 皮克斯风', 文案内容: '限时 5 折' },
    })

    // 文案走独立的画面文字通道，不能混进「非画面文字」的固定块
    expect(buildSopSeriesLockedFixedBlock(config)).toBe('画风：3D 皮克斯风')
    expect(getSopSeriesFreeFixedDimensions(config)).toEqual([])
    // 固定但留空时也不该交给模型写进固定块，否则又会被当成非画面文字
    expect(getSopSeriesFreeFixedDimensions(seriesConfig({ fixedDimensions: ['文案内容'] }))).toEqual([])
  })

  it('reports whether the group shares one set of on-image copy', () => {
    expect(isSopSeriesCopyFixed(seriesConfig())).toBe(false)
    expect(isSopSeriesCopyFixed(seriesConfig({ fixedDimensions: ['画风', '文案内容'] }))).toBe(true)
    // 默认配置里文案每张变化
    expect(isSopSeriesCopyFixed({ ...seriesConfig(), fixedDimensions: SOP_SERIES_DEFAULT_FIXED_DIMENSIONS })).toBe(
      false,
    )
  })

  it('reads the user-filled copy only when 文案内容 is actually fixed', () => {
    expect(buildSopSeriesLockedCopy(seriesConfig({ fixedValues: { 文案内容: '  限时 5 折  ' } }))).toBe('')
    expect(
      buildSopSeriesLockedCopy(
        seriesConfig({ fixedDimensions: ['画风', '文案内容'], fixedValues: { 文案内容: '  限时 5 折  ' } }),
      ),
    ).toBe('限时 5 折')
    // 固定但留空 → 交给模型写进 fixedCopy
    expect(buildSopSeriesLockedCopy(seriesConfig({ fixedDimensions: ['文案内容'] }))).toBe('')
  })

  it('merges the locked block ahead of the model block', () => {
    expect(mergeSopSeriesFixedBlock('画风：3D 皮克斯风', '构图：中心对称')).toBe('画风：3D 皮克斯风；构图：中心对称')
    expect(mergeSopSeriesFixedBlock('', '构图：中心对称')).toBe('构图：中心对称')
    expect(mergeSopSeriesFixedBlock('画风：3D 皮克斯风', '')).toBe('画风：3D 皮克斯风')
    expect(mergeSopSeriesFixedBlock('  ', '  ')).toBe('')
  })
})
