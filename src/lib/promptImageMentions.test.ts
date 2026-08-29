import { describe, expect, it } from 'vitest'
import type { InputImage, WordLibraryEntry } from '../types'
import {
  convertVariableMentionAtVisibleOffsetToText,
  createVariableMention,
  escapePromptHtmlAttribute,
  escapePromptHtmlText,
  getAtImageQuery,
  getPromptMentionParts,
  getSelectedImageMentionLabel,
  getSelectedTextMentionLabel,
  insertImageMention,
  insertTextMentionAtVisibleRange,
  isCursorInSelectedImageMention,
  moveVariableMentionInPrompt,
  remapImageMentionsForOrder,
  replaceImageMentionsForApi,
  resolveVariableMentionEntry,
  VAR_END,
  VAR_START,
} from './promptImageMentions'

const images: InputImage[] = [
  { id: 'image-a', dataUrl: 'data:image/png;base64,a' },
  { id: 'image-b', dataUrl: 'data:image/png;base64,b' },
]

const variableMention = (name: string) => `${VAR_START}${name}${VAR_END}`
const wordEntry = (
  entry: Partial<WordLibraryEntry> & Pick<WordLibraryEntry, 'id' | 'groupId' | 'key' | 'entries'>,
): WordLibraryEntry => ({
  label: entry.key,
  draw_count: 1,
  sortOrder: 0,
  isPinned: false,
  isFavorite: false,
  tags: [],
  deletedAt: null,
  createdAt: 0,
  updatedAt: 0,
  usageCount: 0,
  ...entry,
})

describe('prompt image mentions', () => {
  it('detects @ query after the cursor', () => {
    expect(getAtImageQuery('参考 @图', 5, images)).toEqual({ start: 3, query: '图' })
  })

  it('ignores @ query when there are no current reference images', () => {
    expect(getAtImageQuery('参考 @图', 5, [])).toBeNull()
  })

  it('keeps a completed image mention query selectable', () => {
    expect(getAtImageQuery('参考 @图2', 6, images)).toEqual({ start: 3, query: '图2' })
  })

  it('detects @ query in the middle of text without requiring whitespace prefix', () => {
    expect(getAtImageQuery('参考@', 3, images)).toEqual({ start: 2, query: '' })
  })

  it('replaces middle-text @ query with selected current reference image mention', () => {
    expect(insertImageMention('参考@生成', 2, 3, 1)).toEqual({
      prompt: `参考${getSelectedImageMentionLabel(1)}生成`,
      cursor: 5,
    })
  })

  it('does not add extra spaces around line breaks when inserting mentions', () => {
    expect(insertImageMention('参考\n@\n生成', 3, 4, 0)).toEqual({
      prompt: `参考\n${getSelectedImageMentionLabel(0)}\n生成`,
      cursor: 6,
    })
  })

  it('inserts selected agent round image mentions', () => {
    expect(insertTextMentionAtVisibleRange('参考@生成', 2, 3, '@第1轮图2')).toEqual({
      prompt: `参考${getSelectedTextMentionLabel('@第1轮图2')}生成`,
      cursor: 8,
    })
  })

  it('splits valid image mentions for tag rendering', () => {
    expect(getPromptMentionParts(`用${getSelectedImageMentionLabel(1)}的方式生成@图9`, images)).toEqual([
      { type: 'text', text: '用' },
      { type: 'mention', text: '@图2', imageIndex: 1 },
      { type: 'text', text: '的方式生成@图9' },
    ])
  })

  it('keeps manually typed mentions as plain text', () => {
    expect(getPromptMentionParts('用@图2的方式生成', images)).toEqual([{ type: 'text', text: '用@图2的方式生成' }])
  })

  it('splits selected agent round image mentions for tag rendering', () => {
    expect(getPromptMentionParts(`用${getSelectedTextMentionLabel('@第2轮图4')}生成`, images)).toEqual([
      { type: 'text', text: '用' },
      { type: 'mention', text: '@第2轮图4', mentionText: getSelectedTextMentionLabel('@第2轮图4') },
      { type: 'text', text: '生成' },
    ])
  })

  it('detects cursor inside selected image mentions', () => {
    const prompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    expect(isCursorInSelectedImageMention(prompt, 6)).toBe(true)
    expect(isCursorInSelectedImageMention(prompt, 3)).toBe(false)
    expect(isCursorInSelectedImageMention(prompt, 7)).toBe(false)
    expect(isCursorInSelectedImageMention('参考 @图2 生成', 6)).toBe(false)
  })

  it('detects cursor inside selected agent round image mentions', () => {
    const prompt = `参考 ${getSelectedTextMentionLabel('@第1轮图2')} 生成`

    expect(isCursorInSelectedImageMention(prompt, 9)).toBe(true)
    expect(isCursorInSelectedImageMention(prompt, 3)).toBe(false)
    expect(isCursorInSelectedImageMention(prompt, 10)).toBe(false)
  })

  it('escapes prompt HTML text and attributes before contentEditable rendering', () => {
    expect(escapePromptHtmlText(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror="alert(\'x\')"&gt;&amp;',
    )
    expect(escapePromptHtmlAttribute(`" data-x='1' & <tag>`)).toBe('&quot; data-x=&#39;1&#39; &amp; &lt;tag&gt;')
  })

  describe('remapImageMentionsForOrder', () => {
    it('keeps mentions attached to the same image after reordering', () => {
      expect(
        remapImageMentionsForOrder(
          `用 ${getSelectedImageMentionLabel(1)} 参考 ${getSelectedImageMentionLabel(0)}`,
          images,
          [images[1], images[0]],
        ),
      ).toBe(`用 ${getSelectedImageMentionLabel(0)} 参考 ${getSelectedImageMentionLabel(1)}`)
    })

    it('marks removed image mentions as unavailable', () => {
      expect(remapImageMentionsForOrder(`用 ${getSelectedImageMentionLabel(1)}`, images, [images[0]])).toBe(
        '用 @已移除图片',
      )
    })

    it('keeps mentions attached when an image id is replaced with an equivalent id', () => {
      const replacement = { id: 'image-b-replacement', dataUrl: images[1].dataUrl }

      expect(
        remapImageMentionsForOrder(`用 ${getSelectedImageMentionLabel(1)}`, images, [images[0], replacement], {
          [images[1].id]: replacement.id,
        }),
      ).toBe(`用 ${getSelectedImageMentionLabel(1)}`)
    })
  })

  describe('replaceImageMentionsForApi', () => {
    it('replaces single mention', () => {
      expect(replaceImageMentionsForApi(`把 ${getSelectedImageMentionLabel(0)} 变蓝`)).toBe('把 [image 1] 变蓝')
    })

    it('replaces multiple mentions', () => {
      expect(
        replaceImageMentionsForApi(
          `把 ${getSelectedImageMentionLabel(1)} 的背景换到 ${getSelectedImageMentionLabel(0)} 上`,
        ),
      ).toBe('把 [image 2] 的背景换到 [image 1] 上')
    })

    it('does not replace manually typed mentions', () => {
      expect(replaceImageMentionsForApi('把 @图1 变蓝')).toBe('把 @图1 变蓝')
    })

    it('returns prompt unchanged when no mentions', () => {
      expect(replaceImageMentionsForApi('生成一只猫')).toBe('生成一只猫')
    })

    it('does not replace mentions outside the current image range', () => {
      expect(replaceImageMentionsForApi(`把 ${getSelectedImageMentionLabel(2)} 变蓝`, 2)).toBe('把 @图3 变蓝')
    })

    it('keeps deleted variable mentions as plain text when resolving for api', () => {
      expect(
        replaceImageMentionsForApi(`生成${variableMention('背景')}`, undefined, undefined, { wordLibraryEntries: [] }),
      ).toBe('生成背景')
    })

    it('resolves a name-only variable mention to the only substantive duplicate entry', () => {
      const entries = [
        wordEntry({ id: 'default-entry', groupId: 'default', key: 'hero', entries: ['hero'] }),
        wordEntry({ id: 'skill-entry', groupId: 'skill-group', key: 'hero', entries: ['young founder'] }),
      ]

      expect(
        replaceImageMentionsForApi(`make ${createVariableMention('hero')}`, undefined, undefined, {
          wordLibraryEntries: entries,
        }),
      ).toBe('make young founder')
    })

    it('uses an embedded variable entry id even when duplicate names exist', () => {
      const entries = [
        wordEntry({ id: 'default-entry', groupId: 'default', key: 'hero', entries: ['hero'] }),
        wordEntry({ id: 'skill-entry', groupId: 'skill-group', key: 'hero', entries: ['young founder'] }),
      ]

      expect(resolveVariableMentionEntry('hero', 'skill-entry', entries)?.id).toBe('skill-entry')
    })

    it('resolves a manually typed template variable from the word library', () => {
      const entries = [wordEntry({ id: 'style-entry', groupId: 'default', key: '风格', entries: ['水彩插画'] })]

      expect(
        replaceImageMentionsForApi('生成{{ 风格 }}海报', undefined, undefined, { wordLibraryEntries: entries }),
      ).toBe('生成水彩插画海报')
    })

    it('keeps an unknown manually typed template variable visible', () => {
      expect(replaceImageMentionsForApi('生成{{不存在}}海报', undefined, undefined, { wordLibraryEntries: [] })).toBe(
        '生成{{不存在}}海报',
      )
    })

    it('does not select blank word library entries', () => {
      const entries = [
        wordEntry({ id: 'style-entry', groupId: 'default', key: 'style', entries: ['', '  ', 'watercolor'] }),
      ]

      expect(
        replaceImageMentionsForApi(`make ${createVariableMention('style', 'style-entry')}`, undefined, undefined, {
          wordLibraryEntries: entries,
        }),
      ).toBe('make watercolor')
    })
  })

  describe('prompt variable mention editing', () => {
    it('converts the variable mention at the visible offset into plain text', () => {
      expect(convertVariableMentionAtVisibleOffsetToText(`make ${variableMention('style')} portrait`, 6)).toBe(
        'make style portrait',
      )
    })

    it('moves a variable mention before another visible position', () => {
      expect(
        moveVariableMentionInPrompt(`make ${variableMention('style')} with ${variableMention('lighting')}`, 18, 5),
      ).toBe(`make ${variableMention('lighting')}${variableMention('style')} with `)
    })

    it('moves a variable mention after text when dropped at the end', () => {
      expect(
        moveVariableMentionInPrompt(`${variableMention('style')} portrait with ${variableMention('lighting')}`, 1, 28),
      ).toBe(` portrait with ${variableMention('lighting')}${variableMention('style')}`)
    })
  })
})
