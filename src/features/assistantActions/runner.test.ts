import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile, AppSettings, TaskParams } from '../../types'
import { callAgentResponsesApi } from '../../lib/agentApi'
import { runAssistantAction } from './runner'
import { getDefaultBuiltInSkillSettings, normalizeAssistantActionPreferences } from './matcher'
import { DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES } from './builtInActions'
import type { AssistantCustomSkill, AssistantInputContext } from './types'

vi.mock('../../lib/agentApi', () => ({
  callAgentResponsesApi: vi.fn(),
}))

const mockedCallAgentResponsesApi = vi.mocked(callAgentResponsesApi)

const settings = {} as AppSettings
const profile = { apiKey: 'test-key' } as ApiProfile
const params = {} as TaskParams

function context(patch: Partial<AssistantInputContext> = {}): AssistantInputContext {
  return {
    text: '生成一张信息流广告图',
    hasText: true,
    images: [],
    hasImage: false,
    imageCount: 0,
    ...patch,
  }
}

/** Helper that captures the model input JSON string for an action. */
function lastInputText(): string {
  const input = mockedCallAgentResponsesApi.mock.calls[0]?.[0].input as Array<{ content: Array<{ text: string }> }>
  return input[0].content[0].text
}

function preferencesWithWordEntryCount(skillId: 'super-derive' | 'wild-derive', count = 1) {
  const builtInSkillSettings = getDefaultBuiltInSkillSettings()
  builtInSkillSettings[skillId] = {
    ...builtInSkillSettings[skillId],
    wordEntries: { ...builtInSkillSettings[skillId].wordEntries, count },
  }
  return normalizeAssistantActionPreferences({ builtInSkillSettings })
}

describe('assistant runner', () => {
  beforeEach(() => {
    mockedCallAgentResponsesApi.mockReset()
  })

  it('injects the shared visual-semantic base into every request', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({ text: JSON.stringify({ prompt: '客观展示产品' }) } as Awaited<
      ReturnType<typeof callAgentResponsesApi>
    >)
    await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(lastInputText()).toContain('共享 AI 视觉语义转换底座')
    expect(lastInputText()).toContain('所有字段值必须只使用简体中文')
    expect(lastInputText()).toContain('不得出现英文字母、英文单词、英文缩写或中英混写')
    expect(lastInputText()).toContain('第一步 · 输入事实识别')
    expect(lastInputText()).toContain('具体实例 → 子类/风格流派 → 上位类别 → 形态或功能原型')
    expect(lastInputText()).toContain('复合属性概念提炼（信息流广告专用，内部分析）')
    expect(lastInputText()).toContain('风格、主体、排版、装饰元素、配色、背景、文案')
    expect(lastInputText()).toContain('基础属性 → 复合概念 → 高级概念')
    expect(lastInputText()).toContain('文案维度默认关闭')
    expect(lastInputText()).toContain('信息流广告合规')
  })

  it('requires Chinese output for prompts, upper-level alternatives, and word entries', async () => {
    const upperConcepts = DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES.map(
      (category) => `${category}：上位概念`,
    ).join('\n')
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，中文信息流广告',
        alternativePrompt: upperConcepts,
        wordEntries: [{ category: '主体', entries: ['产品特写'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context(), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })

    expect(result.alternativePrompt).toBe(upperConcepts)
    expect(lastInputText()).toContain('所有技能都输出一条提示词和一条分维度上位概念描述')
    expect(lastInputText()).toContain('每个启用维度恰好一行')
    expect(lastInputText()).toContain('变量分类名、占位符和全部变量词条必须使用中文')
    expect(lastInputText()).toContain('最终字段值只能包含中文、数字及必要标点')
  })

  it('ships a JSON schema example that is itself valid JSON', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({ text: JSON.stringify({ prompt: 'x' }) } as Awaited<
      ReturnType<typeof callAgentResponsesApi>
    >)
    await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    const textLine = lastInputText()
    const marker = 'JSON 结构'
    const after = textLine.slice(textLine.indexOf(marker))
    const braceStart = after.indexOf('{')
    let depth = 0
    let end = -1
    for (let i = braceStart; i < after.length; i += 1) {
      if (after[i] === '{') depth += 1
      else if (after[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const schemaText = after.slice(braceStart, end + 1)
    expect(() => JSON.parse(schemaText)).not.toThrow()
  })

  it('returns exactly one prompt and derives legacy fields from it', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({ text: JSON.stringify({ prompt: '一条完整提示词' }) } as Awaited<
      ReturnType<typeof callAgentResponsesApi>
    >)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('一条完整提示词')
    expect(result.content).toBe(result.prompt)
    expect(result.primaryText).toBe(result.prompt)
    expect(result.wordEntries).toBeUndefined()
    expect(result.variablePrompt).toBeUndefined()
  })

  it('returns an upper-level alternative prompt for a skill without word entries', async () => {
    const upperConcepts = [
      '风格：亲和手绘传播语言',
      '主体：陪伴型动物角色',
      '排版：单中心信息组织',
      '装饰元素：轻量情绪符号系统',
      '配色：温暖柔和的亲和倾向',
      '背景：低干扰留白空间',
    ].join('\n')
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '一只柴犬，日系手绘风格',
        alternativePrompt: upperConcepts,
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('prompt-optimize', context({ text: '一只柴犬，日系手绘风格' }), {
      settings,
      profile,
      params,
    })

    expect(result.prompt).toBe('一只柴犬，日系手绘风格')
    expect(result.alternativePrompt).toBe(upperConcepts)
    expect(lastInputText()).toContain('必须同时生成 prompt 和 alternativePrompt')
    expect(lastInputText()).toContain('启用的上位概念维度：风格、主体、排版、装饰元素、配色、背景')
    expect(lastInputText()).toContain('每个启用维度恰好一行')
    expect(lastInputText()).toContain('不得把七个维度合并为一个笼统概念')
    expect(lastInputText()).toContain('不得逐句改写 prompt')
    expect(lastInputText()).toContain('主体可提升为“亲和型数字角色系统”')
  })

  it('asks atomic word-entry skills to derive through upper-level categories', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，置于深空背景',
        wordEntries: [{ category: '主体', entries: ['发光行星'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    await runAssistantAction('super-derive', context({ text: '月球', hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })

    expect(lastInputText()).toContain('先识别原始内容的上位类别')
    expect(lastInputText()).toContain('禁止把同一具体对象仅改成不同颜色、天气、光线、材质或氛围')
  })

  it('keeps only word entries whose category is referenced by a placeholder', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，突出卖点',
        wordEntries: [
          { category: '主体', entries: ['产品特写'] },
          { category: '无关分类', entries: ['丢弃'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })
    expect(result.wordEntries).toEqual([{ category: '主体', entries: ['产品特写'] }])
    expect(result.prompt).toBe('{{主体}}，突出卖点')
  })

  it('cleans only the illegal placeholder, keeping the mapped one', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，搭配{{未知变量}}',
        wordEntries: [{ category: '主体', entries: ['产品特写'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，搭配未知变量',
        wordEntries: [{ category: '主体', entries: ['产品特写'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })
    expect(result.prompt).toBe('{{主体}}，搭配未知变量')
    expect(result.wordEntries).toEqual([{ category: '主体', entries: ['产品特写'] }])
    expect(result.qualityState).toBe('repaired')
  })

  it('caps word entries per category to the configured count and dedupes', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}',
        wordEntries: [{ category: '主体', entries: ['A', 'A', 'B', 'C', 'D', 'E'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const prefs = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...getDefaultBuiltInSkillSettings(),
        'super-derive': {
          wordEntries: { enabled: true, count: 3, categories: ['主体'], strategy: 'atomic' },
          autoSave: true,
          applyMode: 'replace',
          targetGroupMode: 'new',
          targetGroupId: null,
        },
        'wild-derive': getDefaultBuiltInSkillSettings()['wild-derive'],
      },
    })
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: prefs,
    })
    expect(result.wordEntries?.[0].entries).toEqual(['A', 'B', 'C'])
  })

  it('repairs malformed JSON once (without re-uploading images)', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '{ prompt: "缺少引号" ' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({ text: JSON.stringify({ prompt: '修复后的提示词' }) } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('修复后的提示词')
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
  })

  it('falls back to a single prompt when JSON cannot be repaired', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '完全不是 JSON 的一段描述文字' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
      .mockResolvedValueOnce({ text: '仍然不是 JSON' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('仍然不是 JSON')
    expect(result.qualityState).toBe('repaired')
  })

  it('keeps only the first item when the model returns multiple numbered directions', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '完全不是 JSON 的多方向文字' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
      .mockResolvedValueOnce({ text: '1. 金色宝箱打开，金币飞向镜头\n2. 蓝色数据阶梯，冷静专业风' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('金色宝箱打开，金币飞向镜头')
    expect(result.qualityNote).toContain('保留第一条')
  })

  it('keeps only the first inline numbered direction when fallback text contains multiple prompts', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '不是 JSON' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({ text: '1. 金色宝箱打开，金币飞向镜头 2. 蓝色数据阶梯，冷静专业风' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('金色宝箱打开，金币飞向镜头')
  })

  it('extracts a prompt from a Markdown code fence', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '不是 JSON' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({ text: '```json\n{"prompt":"来自代码块的提示词"}\n```' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })
    expect(result.prompt).toBe('来自代码块的提示词')
  })

  it('triggers one repair when super-derive returns no word entries', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: JSON.stringify({ prompt: '一条没有词条的提示词' }) } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '{{主体}}，突出卖点',
          wordEntries: [{ category: '主体', entries: ['产品特写'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(result.wordEntries).toEqual([{ category: '主体', entries: ['产品特写'] }])
  })

  it('triggers one repair when wild-derive has no {{创意方向}} placeholder', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '一条没有占位符的提示词',
          wordEntries: [{ category: '创意方向', entries: ['金色宝箱爆发式开启'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '{{创意方向}}，高能促销',
          wordEntries: [{ category: '创意方向', entries: ['金色宝箱爆发式开启'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('wild-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('wild-derive'),
    })
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(result.prompt).toBe('{{创意方向}}，高能促销')
  })

  it('triggers one repair when wild-derive has a placeholder but no usable direction entries', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: JSON.stringify({ prompt: '{{创意方向}}' }) } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '{{创意方向}}',
          wordEntries: [{ category: '创意方向', entries: ['金色宝箱爆发式开启'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('wild-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('wild-derive'),
    })
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(result.wordEntries?.[0].entries).toEqual(['金色宝箱爆发式开启'])
  })

  it('uses at most one repair request across the whole run', async () => {
    // First response is malformed JSON AND a variable skill with no mapping;
    // the single repair returns valid JSON but still no word entries -> degrade.
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '{ prompt: "缺少引号且缺词条" ' } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
      .mockResolvedValueOnce({ text: JSON.stringify({ prompt: '修复后仍然无词条' }) } as Awaited<
        ReturnType<typeof callAgentResponsesApi>
      >)
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(result.wordEntries).toBeUndefined()
    expect(result.qualityState).toBe('repaired')
  })

  it('fills missing word-entry categories for placeholders instead of flattening them', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '{{缺失变量}}，突出卖点',
          wordEntries: [],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          prompt: '{{缺失变量}}，突出卖点',
          wordEntries: [],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })

    expect(result.prompt).toBe('{{缺失变量}}，突出卖点')
    expect(result.wordEntries).toEqual([{ category: '缺失变量', entries: ['缺失变量'] }])
    expect(result.qualityState).toBe('repaired')
  })

  it('keeps placeholder mapping intact after compliance cleaning', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{主体}}，客观展示产品卖点',
        wordEntries: [{ category: '主体', entries: ['产品特写'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('super-derive'),
    })
    expect(result.prompt).toBe('{{主体}}，客观展示产品卖点')
    expect(result.wordEntries).toEqual([{ category: '主体', entries: ['产品特写'] }])
  })

  it('image-describe never receives an instruction to add non-existent ad elements', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({ prompt: '忠实描述的提示词' }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    await runAssistantAction('image-describe', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
    })
    const input = lastInputText()
    expect(input).toContain('不得添加图片中不存在的主体、装饰、卖点、人物、CTA 或商业符号')
    expect(input).not.toContain('商业展示方式')
  })

  it('wild-derive uses direction-pack and only keeps the 创意方向 category', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        prompt: '{{创意方向}}，高能促销',
        wordEntries: [
          { category: '创意方向', entries: ['金色宝箱爆发式开启，金币飞向镜头'] },
          { category: '错误分类', entries: ['丢弃'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('wild-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      preferences: preferencesWithWordEntryCount('wild-derive'),
    })
    expect(result.wordEntries?.map((group) => group.category)).toEqual(['创意方向'])
  })

  it('custom skills inherit the shared base and emit a single prompt', async () => {
    const custom: AssistantCustomSkill = {
      id: 'custom-1',
      name: '自定义',
      icon: 'sparkles',
      priority: 65,
      enabled: true,
      source: 'custom',
      isCustom: true,
      instruction: '把输入变成可爱风格提示词',
      inputMode: 'text',
      intensity: 'controlled',
      when: { text: 'optional', image: 'optional' },
      outputMode: 'replace-input',
      preserveRules: ['原始意图'],
      editableRules: ['风格'],
      forbiddenRules: ['虚构事实'],
      wordEntries: { enabled: false, count: 0, categories: [], strategy: 'atomic' },
    }
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({ prompt: '可爱风格的提示词' }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
    const result = await runAssistantAction('custom-1', context(), { settings, profile, params, skill: custom })
    expect(result.prompt).toBe('可爱风格的提示词')
    expect(lastInputText()).toContain('共享 AI 视觉语义转换底座')
    expect(lastInputText()).toContain('把输入变成可爱风格提示词')
  })

  it('rejects an action when its required input is missing before calling the API', async () => {
    await expect(runAssistantAction('image-describe', context(), { settings, profile, params })).rejects.toThrow(
      '当前输入不满足该技能要求',
    )
    expect(mockedCallAgentResponsesApi).not.toHaveBeenCalled()
  })
})

describe('default built-in skill settings', () => {
  it('super-derive defaults to six enabled ad dimensions / 8 entries each', () => {
    const builtInSettings = getDefaultBuiltInSkillSettings()
    expect(builtInSettings['super-derive'].wordEntries.count).toBe(8)
    expect(builtInSettings['super-derive'].wordEntries.categories).toEqual([
      '风格',
      '主体',
      '排版',
      '装饰元素',
      '配色',
      '背景',
    ])
    expect(builtInSettings['super-derive'].wordEntries.categories).not.toContain('文案')
    expect(builtInSettings['super-derive'].autoSave).toBe(true)
  })

  it('wild-derive defaults to 12 direction entries, direction-pack strategy', () => {
    const builtInSettings = getDefaultBuiltInSkillSettings()
    expect(builtInSettings['wild-derive'].wordEntries.count).toBe(12)
    expect(builtInSettings['wild-derive'].wordEntries.categories).toEqual(['创意方向'])
    expect(builtInSettings['wild-derive'].wordEntries.strategy).toBe('direction-pack')
  })
})
