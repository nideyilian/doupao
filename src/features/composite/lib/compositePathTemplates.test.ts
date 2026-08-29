import { describe, expect, it } from 'vitest'
import * as pathTemplates from './compositePathTemplates'

const { buildCompositeOutputPathParts, sanitizePathSegment, stripTemplateIndex, withCollisionSuffix } = pathTemplates

describe('composite path templates', () => {
  it('replaces output variables and sanitizes path segments', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品:A',
      index: 3,
      source: '背景/1',
      sourceDir: 'A/B',
      custom: '投放1',
      customVariables: { project: '快手极速版' },
      namingTemplate: '{date}-{project}-{size}-{channel}',
      filenameTemplate: '{preset}-{source}-{index}',
      preserveSourceDir: true,
    })

    expect(parts).toEqual({
      subfolders: ['20260627-快手极速版-1080x1920-百度', 'A', 'B'],
      filename: '产品_A-背景_1-3.jpg',
    })
  })

  it('sanitizes reserved filename characters', () => {
    expect(sanitizePathSegment('a:b*c?d<e>f|g')).toBe('a_b_c_d_e_f_g')
  })

  it('rewrites dot-only path segments to safe visible folders', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品A',
      index: 1,
      source: '背景1',
      sourceDir: '',
      custom: '..\\outside',
      namingTemplate: '{custom}',
      filenameTemplate: '{preset}',
      preserveSourceDir: false,
    })

    expect(parts.subfolders).toEqual(['_', 'outside'])
    expect(parts.subfolders).not.toContain('..')
  })

  it('sanitizes Windows reserved device names and trailing dots', () => {
    expect(sanitizePathSegment('CON')).toBe('_CON')
    expect(sanitizePathSegment('com1.txt')).toBe('_com1.txt')
    expect(sanitizePathSegment('name.')).toBe('name_')
  })

  it('omits empty subfolder path segments', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品A',
      index: 1,
      source: '背景1',
      sourceDir: '',
      custom: '',
      namingTemplate: '',
      filenameTemplate: '{preset}',
      preserveSourceDir: true,
    })

    expect(parts.subfolders).toEqual([])
  })

  it('appends collision suffix before extension', () => {
    expect(withCollisionSuffix('image.jpg', 2)).toBe('image-2.jpg')
  })

  it('strips the index field and its trailing separator from a template', () => {
    expect(stripTemplateIndex('{date}-{channel}-{size}-{preset}-{index}')).toBe('{date}-{channel}-{size}-{preset}')
    expect(stripTemplateIndex('{date}-{channel}-{size}-{preset}')).toBe('{date}-{channel}-{size}-{preset}')
    expect(stripTemplateIndex('{index}')).toBe('')
    expect(stripTemplateIndex('{date}-{index}')).toBe('{date}')
    expect(stripTemplateIndex('{index}-{date}')).toBe('{date}')
  })

  it('resolves root variables without changing absolute path syntax or unknown variables', () => {
    const resolveCompositeTemplate = (
      pathTemplates as typeof pathTemplates & {
        resolveCompositeTemplate: (template: string, values: Record<string, unknown>) => string
      }
    ).resolveCompositeTemplate

    expect(
      resolveCompositeTemplate('D:\\Exports\\{date}\\{project}\\{unknown}', {
        date: '20260702',
        channel: '快手',
        size: '1280x720',
        preset: '横版',
        index: 1,
        source: 'image',
        sourceDir: 'source',
        custom: '自定义',
        customVariables: { project: '项目A' },
      }),
    ).toBe('D:\\Exports\\20260702\\项目A\\{unknown}')
  })
})
