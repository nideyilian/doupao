import { describe, expect, it } from 'vitest'
import {
  allocateSopPromptCounts,
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  getMentionedSopSourceIndexes,
  getSopRunCounts,
  getSopPromptBatchSizes,
  getSopTotalImageCount,
  parseSopPromptBatchResponse,
  selectSopPromptSources,
  SOP_PROMPT_GENERATOR_INSTRUCTION,
} from './sopPromptBatch'
import type { SopLibraryItem } from './types'

const sop: SopLibraryItem = {
  id: 'sop-1',
  name: '测试 SOP',
  description: '测试批量提示词',
  content: '保持蓝色背景，每条提示词更换主体。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

describe('SOP prompt batch', () => {
  it('builds a strict request with an explicit SOP execution contract', () => {
    const request = buildSopPromptBatchRequest(sop, 3, '使用产品摄影风格', {
      sourceLabel: '图1',
      totalPromptCount: 10,
      existingPrompts: ['已有提示词 A', '已有提示词 B'],
    })
    expect(request).toContain('生成 3 条')
    expect(request).toContain('本轮总目标提示词数量：10 条')
    expect(request).toContain('当前参考图：图1')
    expect(request).toContain('使用产品摄影风格')
    expect(request).toContain(sop.content)
    expect(request).toContain('<SOP>')
    expect(request).toContain('</SOP>')
    expect(request).toContain('必要约束、建议项、示例和可变部分')
    expect(request).toContain('只有 SOP 明确标为必须、固定或禁止的规则才视为硬约束')
    expect(request).toContain('已有提示词 A')
    expect(request).toContain('不得与已有结果重复或仅做同义改写')
  })

  it('defines a silent planning and self-check instruction for the prompt model', () => {
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('先在内部理解')
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('不要输出分析过程')
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('传输封装')
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('逐条自检')
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('语言、详略、格式')
    expect(SOP_PROMPT_GENERATOR_INSTRUCTION).toContain('建议、示例或缺省字段')
  })

  it('allocates a global prompt count across selected sources', () => {
    expect(allocateSopPromptCounts(10, 3)).toEqual([4, 3, 3])
    expect(allocateSopPromptCounts(2, 3)).toEqual([1, 1, 0])
  })

  it('splits large prompt runs into small model requests', () => {
    expect(getSopPromptBatchSizes(30)).toEqual([10, 10, 10])
    expect(getSopPromptBatchSizes(23)).toEqual([10, 10, 3])
    const largeRun = getSopPromptBatchSizes(123)
    expect(largeRun).toHaveLength(13)
    expect(largeRun.reduce((total, count) => total + count, 0)).toBe(123)
    expect(Math.max(...largeRun)).toBe(10)
  })

  it('retries a malformed batch without discarding successful batches', async () => {
    const requests: number[] = []
    let failedOnce = false

    const prompts = await generateSopPromptBatches(12, async (count, existingPrompts) => {
      requests.push(count)
      if (!failedOnce) {
        failedOnce = true
        throw new Error('模型返回的提示词 JSON 格式不正确，请重试')
      }
      return Array.from({ length: count }, (_, index) => `提示词-${existingPrompts.length + index + 1}`)
    })

    expect(requests).toEqual([10, 10, 2])
    expect(prompts).toHaveLength(12)
    expect(new Set(prompts).size).toBe(12)
  })

  it('keeps requesting the remaining deficit when a model returns a partial batch', async () => {
    const requests: number[] = []

    const prompts = await generateSopPromptBatches(5, async (count, existingPrompts) => {
      requests.push(count)
      const returnedCount = requests.length === 1 ? 2 : count
      return Array.from({ length: returnedCount }, (_, index) => `提示词-${existingPrompts.length + index + 1}`)
    })

    expect(requests).toEqual([5, 3])
    expect(prompts).toEqual(['提示词-1', '提示词-2', '提示词-3', '提示词-4', '提示词-5'])
  })

  it('reports completed prompt progress after every successful model batch', async () => {
    const progress: Array<[number, number]> = []

    await generateSopPromptBatches(
      12,
      async (count, existingPrompts) =>
        Array.from({ length: count }, (_, index) => `提示词 ${existingPrompts.length + index + 1}`),
      { onProgress: (completed, total) => progress.push([completed, total]) },
    )

    expect(progress).toEqual([
      [10, 12],
      [12, 12],
    ])
  })

  it('awaits each generated prompt dispatch before generating the next one', async () => {
    const events: string[] = []

    const prompts = await generateSopPromptBatches(
      3,
      async (_count, existingPrompts) => {
        const index = existingPrompts.length + 1
        events.push(`generate-${index}`)
        return [`提示词 ${index}`]
      },
      {
        maxBatchSize: 1,
        onBatch: async ([prompt]) => {
          events.push(`dispatch-${prompt}`)
          await Promise.resolve()
          events.push(`dispatched-${prompt}`)
        },
      },
    )

    expect(prompts).toEqual(['提示词 1', '提示词 2', '提示词 3'])
    expect(events).toEqual([
      'generate-1',
      'dispatch-提示词 1',
      'dispatched-提示词 1',
      'generate-2',
      'dispatch-提示词 2',
      'dispatched-提示词 2',
      'generate-3',
      'dispatch-提示词 3',
      'dispatched-提示词 3',
    ])
  })

  it('waits for the pause gate before sending the next model batch', async () => {
    const events: string[] = []
    let release!: () => void
    let paused = false
    const pausePromise = new Promise<void>((resolve) => {
      release = resolve
    })

    const resultPromise = generateSopPromptBatches(
      2,
      async (_count, existingPrompts) => {
        events.push(`generate-${existingPrompts.length + 1}`)
        return [`提示词 ${existingPrompts.length + 1}`]
      },
      {
        maxBatchSize: 1,
        beforeBatch: async () => {
          if (!paused) return
          await pausePromise
        },
        onBatch: (_prompts, completed) => {
          if (completed === 1) paused = true
        },
      },
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['generate-1'])

    paused = false
    release()
    await expect(resultPromise).resolves.toEqual(['提示词 1', '提示词 2'])
    expect(events).toEqual(['generate-1', 'generate-2'])
  })

  it('stops immediately after cancellation without retrying the aborted batch', async () => {
    const controller = new AbortController()
    let calls = 0

    const resultPromise = generateSopPromptBatches(
      2,
      async () => {
        calls += 1
        controller.abort(new DOMException('提示词生成已取消', 'AbortError'))
        throw controller.signal.reason
      },
      { signal: controller.signal },
    )

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('keeps completed batches when a later batch still fails after retry', async () => {
    let calls = 0
    const prompts = await generateSopPromptBatches(
      25,
      async (count, existingPrompts) => {
        calls += 1
        if (existingPrompts.length >= 20) throw new Error('模型返回的提示词 JSON 格式不正确，请重试')
        return Array.from({ length: count }, (_, index) => `提示词-${existingPrompts.length + index + 1}`)
      },
      { exact: false },
    )

    expect(calls).toBe(4)
    expect(prompts).toHaveLength(20)
  })

  it('selects mentioned sources in mention order and limits by prompt count', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(getMentionedSopSourceIndexes('@图3 @图1 @图3', sources.length)).toEqual([2, 0])
    expect(selectSopPromptSources(sources, 1, '@图3 @图1')).toEqual([{ id: 'c' }])
  })

  it('uses one source per prompt without dropping later references', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    expect(selectSopPromptSources(sources, 10, '')).toEqual(sources)
    expect(selectSopPromptSources(sources, 2, '')).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('normalizes prompt and per-prompt image counts independently', () => {
    expect(getSopRunCounts(10, 2)).toEqual({ promptCount: 10, imagesPerPrompt: 2 })
    expect(getSopRunCounts(0, 0)).toEqual({ promptCount: 1, imagesPerPrompt: 1 })
    expect(getSopRunCounts(80, 50)).toEqual({ promptCount: 80, imagesPerPrompt: 20 })
    expect(getSopRunCounts(5_000, 1).promptCount).toBe(5_000)
    expect(getSopRunCounts(Number.POSITIVE_INFINITY, 1).promptCount).toBe(1)
    expect(getSopTotalImageCount(10, 2)).toBe(20)
  })

  it('parses an exact prompt list', () => {
    expect(parseSopPromptBatchResponse('{"prompts":["提示词一","提示词二"]}', 2)).toEqual(['提示词一', '提示词二'])
  })

  it('rejects an incomplete list', () => {
    expect(() => parseSopPromptBatchResponse('{"prompts":["只有一条"]}', 2)).toThrow('应返回 2 条提示词')
  })

  it('can keep partial unique prompts for source-level runs', () => {
    expect(
      parseSopPromptBatchResponse('{"prompts":["提示词一","提示词一","提示词二"]}', 3, {
        exact: false,
        existingPrompts: ['提示词二'],
      }),
    ).toEqual(['提示词一'])
  })

  it('accepts legacy SOP output keys and removes list labels', () => {
    expect(parseSopPromptBatchResponse('{"Ready_To_Use_Prompts":["Prompt 1: 提示词一","2、提示词二"]}', 2)).toEqual([
      '提示词一',
      '提示词二',
    ])
  })

  it('accepts top-level arrays, nested aliases, and prompt objects', () => {
    expect(parseSopPromptBatchResponse('```json\n["提示词一","提示词二"]\n```', 2)).toEqual(['提示词一', '提示词二'])
    expect(
      parseSopPromptBatchResponse('{"result":{"prompt_list":[{"prompt":"提示词三"},{"text":"提示词四"}]}}', 2),
    ).toEqual(['提示词三', '提示词四'])
  })

  it('repairs common harmless JSON mistakes', () => {
    expect(parseSopPromptBatchResponse('{prompts:["提示词一","提示词二",],}', 2)).toEqual(['提示词一', '提示词二'])
  })

  it('recognizes numbered, XML, and single plain-text prompt responses', () => {
    expect(parseSopPromptBatchResponse('以下是结果：\n1. 提示词一\n2、提示词二', 2)).toEqual(['提示词一', '提示词二'])
    expect(
      parseSopPromptBatchResponse('<prompts><prompt>提示词三</prompt><prompt>提示词四</prompt></prompts>', 2),
    ).toEqual(['提示词三', '提示词四'])
    expect(parseSopPromptBatchResponse('一条可直接生图的自然语言提示词', 1)).toEqual(['一条可直接生图的自然语言提示词'])
  })

  it('treats cosmetic numbering and punctuation changes as duplicates', () => {
    expect(
      parseSopPromptBatchResponse('{"prompts":["Prompt 2：蓝色 背景，白色产品。","红色背景，白色产品"]}', 2, {
        exact: false,
        existingPrompts: ['1. 蓝色背景、白色产品'],
      }),
    ).toEqual(['红色背景，白色产品'])
  })
})
