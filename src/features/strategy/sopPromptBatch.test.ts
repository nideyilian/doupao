import { describe, expect, it, vi } from 'vitest'
import {
  allocateSopPromptCounts,
  assembleSopSeriesPrompt,
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  getMentionedSopSourceIndexes,
  getSopRunCounts,
  getSopPromptBatchSizes,
  getSopSeriesCopyBlock,
  getSopSeriesFixedBlock,
  getSopTotalImageCount,
  parseSopPromptBatchResponse,
  parseSopSeriesPromptBatchResponse,
  selectSopPromptSources,
  SOP_PROMPT_GENERATOR_INSTRUCTION,
  stripSopSeriesFixedPrefix,
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

  it('skips retrying when the caller marks the error as non-retryable', async () => {
    const timeoutError = Object.assign(new Error('SOP 提示词生成超时：超过 600 秒仍未完成'), {
      name: 'TimeoutError',
    })
    const generateBatch = vi.fn().mockRejectedValue(timeoutError)

    await expect(
      generateSopPromptBatches(2, generateBatch, {
        isRetryable: (error) => !(error instanceof Error && error.name === 'TimeoutError'),
      }),
    ).rejects.toThrow('SOP 提示词生成超时：超过 600 秒仍未完成')

    expect(generateBatch).toHaveBeenCalledTimes(1)
  })

  it('retries twice by default when the caller does not classify the error', async () => {
    const generateBatch = vi.fn().mockRejectedValue(new Error('模型未返回新的可用提示词'))

    await expect(generateSopPromptBatches(1, generateBatch)).rejects.toThrow(
      '提示词批次生成失败，已自动尝试 2 次：模型未返回新的可用提示词',
    )

    expect(generateBatch).toHaveBeenCalledTimes(2)
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

  it('parses a series batch and pins every member to the group fixed block', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"蓝色背景","prompts":["图1","图2","图3"]},{"fixed":"红色背景","prompts":["图4","图5","图6"]}]}',
      2,
      3,
    )

    expect(groups.map((group) => group.groupIndex)).toEqual([0, 1])
    expect(groups.map((group) => group.fixed)).toEqual(['蓝色背景', '红色背景'])
    expect(groups[0].prompts).toEqual([
      '系列统一规范（非画面文字）：蓝色背景\n本张画面：图1',
      '系列统一规范（非画面文字）：蓝色背景\n本张画面：图2',
      '系列统一规范（非画面文字）：蓝色背景\n本张画面：图3',
    ])
    expect(groups[1].prompts[2]).toBe('系列统一规范（非画面文字）：红色背景\n本张画面：图6')
  })

  it('reuses the locked fixed block verbatim when one is supplied', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"模型自己改写的固定块","prompts":["图1","图2"]}]}',
      1,
      2,
      { fixedBlock: '蓝色背景，中心对称构图' },
    )

    expect(groups[0].fixed).toBe('蓝色背景，中心对称构图')
    expect(groups[0].prompts).toEqual([
      '系列统一规范（非画面文字）：蓝色背景，中心对称构图\n本张画面：图1',
      '系列统一规范（非画面文字）：蓝色背景，中心对称构图\n本张画面：图2',
    ])
  })

  it('prepends the user-locked fixed block ahead of the model block', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"构图方式：中心对称；光线：柔和顶光","prompts":["图1","图2"]}]}',
      1,
      2,
      { lockedFixedBlock: '视觉风格：3D 皮克斯风；色彩体系：莫兰迪低饱和' },
    )

    // 用户填的值必须逐字出现在固定块最前面，模型补的部分跟在后面
    expect(groups[0].fixed).toBe('视觉风格：3D 皮克斯风；色彩体系：莫兰迪低饱和；构图方式：中心对称；光线：柔和顶光')
    expect(groups[0].prompts[0]).toBe(
      '系列统一规范（非画面文字）：视觉风格：3D 皮克斯风；色彩体系：莫兰迪低饱和；构图方式：中心对称；光线：柔和顶光\n本张画面：图1',
    )
  })

  it('prefers the reused fixed block over the user-locked prefix to avoid duplication', () => {
    // 单成员重生成时固定块整段复用，用户锁定项已经在里面了，不能再拼一次
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"模型改写过的内容","prompts":["图1","图2"]}]}',
      1,
      2,
      { fixedBlock: '视觉风格：3D 皮克斯风；构图方式：中心对称', lockedFixedBlock: '视觉风格：3D 皮克斯风' },
    )

    expect(groups[0].fixed).toBe('视觉风格：3D 皮克斯风；构图方式：中心对称')
  })

  it('keeps the user-locked block when the model returns an empty fixed block', () => {
    const groups = parseSopSeriesPromptBatchResponse('{"series":[{"fixed":"","prompts":["图1","图2"]}]}', 1, 2, {
      lockedFixedBlock: '视觉风格：3D 皮克斯风',
    })

    expect(groups[0].fixed).toBe('视觉风格：3D 皮克斯风')
    expect(groups[0].prompts[0]).toBe('系列统一规范（非画面文字）：视觉风格：3D 皮克斯风\n本张画面：图1')
  })

  it('drops a fixed block the model repeated inside a member prompt', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"蓝色背景","prompts":["蓝色背景，主体是咖啡杯","蓝色背景 主体是茶杯"]}]}',
      1,
      2,
    )

    expect(groups[0].prompts).toEqual([
      '系列统一规范（非画面文字）：蓝色背景\n本张画面：主体是咖啡杯',
      '系列统一规范（非画面文字）：蓝色背景\n本张画面：主体是茶杯',
    ])
  })

  it('collapses a multi-line fixed block into a single reusable line', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      JSON.stringify({ series: [{ fixed: '蓝色背景\n中心对称构图', prompts: ['图1', '图2'] }] }),
      1,
      2,
    )

    expect(groups[0].fixed).toBe('蓝色背景 中心对称构图')
    expect(getSopSeriesFixedBlock(groups[0].prompts[0])).toBe('蓝色背景 中心对称构图')
  })

  it('extracts the fixed block from a generated series prompt', () => {
    expect(getSopSeriesFixedBlock('系列统一规范（非画面文字）：蓝色背景\n本张画面：图1')).toBe('蓝色背景')
    expect(getSopSeriesFixedBlock('普通提示词')).toBe('')
  })

  it('assembles the picture-copy segment between the fixed block and the member prompt', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"蓝色背景","fixedCopy":"限时 5 折","prompts":["图1","图2"]}]}',
      1,
      2,
    )

    expect(groups[0].copy).toBe('限时 5 折')
    expect(groups[0].prompts).toEqual([
      '系列统一规范（非画面文字）：蓝色背景\n画面文字（逐字绘制）：限时 5 折\n本张画面：图1',
      '系列统一规范（非画面文字）：蓝色背景\n画面文字（逐字绘制）：限时 5 折\n本张画面：图2',
    ])
    expect(getSopSeriesCopyBlock(groups[0].prompts[1])).toBe('限时 5 折')
  })

  it('omits the picture-copy segment when the model returns an empty fixedCopy', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"蓝色背景","fixedCopy":"","prompts":["图1","图2"]}]}',
      1,
      2,
    )

    expect(groups[0].copy).toBe('')
    expect(groups[0].prompts[0]).toBe('系列统一规范（非画面文字）：蓝色背景\n本张画面：图1')
  })

  it('prefers the user-filled copy over the model copy', () => {
    // 用户填了具体文案时由客户端逐字拼装，模型写的 fixedCopy 必须被丢弃
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"蓝色背景","fixedCopy":"模型自己编的文案","prompts":["图1","图2"]}]}',
      1,
      2,
      { lockedCopy: '限时 5 折，仅限今天' },
    )

    expect(groups[0].copy).toBe('限时 5 折，仅限今天')
    expect(groups[0].prompts[0]).toContain('画面文字（逐字绘制）：限时 5 折，仅限今天')
    expect(groups[0].prompts[0]).not.toContain('模型自己编的文案')
  })

  it('reuses the copy block verbatim on single-member regeneration', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      '{"series":[{"fixed":"模型改写过的固定块","fixedCopy":"模型换掉的文案","prompts":["图1"]}]}',
      1,
      1,
      {
        fixedBlock: '蓝色背景',
        copyBlock: '限时 5 折',
        lockedFixedBlock: '画风：3D 皮克斯风',
        lockedCopy: '用户填的文案',
      },
    )

    // 整段复用时固定块与画面文字都以后者为准，避免重生成的那一张从系列里拆出去
    expect(groups[0].fixed).toBe('蓝色背景')
    expect(groups[0].copy).toBe('限时 5 折')
    expect(groups[0].prompts[0]).toBe(
      '系列统一规范（非画面文字）：蓝色背景\n画面文字（逐字绘制）：限时 5 折\n本张画面：图1',
    )
  })

  it('collapses a multi-line picture-copy block into a single drawable line', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      JSON.stringify({ series: [{ fixed: '蓝色背景', fixedCopy: '限时 5 折\n仅限今天', prompts: ['图1', '图2'] }] }),
      1,
      2,
    )

    expect(groups[0].copy).toBe('限时 5 折 仅限今天')
    expect(getSopSeriesCopyBlock(groups[0].prompts[0])).toBe('限时 5 折 仅限今天')
  })

  it('reads the copy block out of a generated prompt and tolerates its absence', () => {
    expect(
      getSopSeriesCopyBlock('系列统一规范（非画面文字）：蓝\n画面文字（逐字绘制）：限时 5 折\n本张画面：图1'),
    ).toBe('限时 5 折')
    expect(getSopSeriesCopyBlock('系列统一规范（非画面文字）：蓝\n本张画面：图1')).toBe('')
    expect(getSopSeriesCopyBlock('普通提示词')).toBe('')
  })

  it('strips a loosely matching fixed prefix and assembles both ends', () => {
    expect(stripSopSeriesFixedPrefix('蓝色背景，主体是咖啡杯', '蓝色背景')).toBe('主体是咖啡杯')
    expect(stripSopSeriesFixedPrefix('蓝 色 背 景：主体是咖啡杯', '蓝色背景')).toBe('主体是咖啡杯')
    expect(stripSopSeriesFixedPrefix('主体是咖啡杯', '蓝色背景')).toBe('主体是咖啡杯')
    expect(assembleSopSeriesPrompt('', '图1')).toBe('图1')
    expect(assembleSopSeriesPrompt('蓝色背景', '')).toBe('系列统一规范（非画面文字）：蓝色背景')
    // 画面文字段永远夹在固定块与本张画面之间
    expect(assembleSopSeriesPrompt('蓝色背景', '图1', '限时 5 折')).toBe(
      '系列统一规范（非画面文字）：蓝色背景\n画面文字（逐字绘制）：限时 5 折\n本张画面：图1',
    )
    expect(assembleSopSeriesPrompt('', '图1', '限时 5 折')).toBe('画面文字（逐字绘制）：限时 5 折\n本张画面：图1')
    expect(assembleSopSeriesPrompt('蓝色背景', '', '限时 5 折')).toBe(
      '系列统一规范（非画面文字）：蓝色背景\n画面文字（逐字绘制）：限时 5 折',
    )
  })

  it('keeps fewer series groups than requested so the batch loop can fill the deficit', () => {
    const groups = parseSopSeriesPromptBatchResponse('{"series":[{"fixed":"蓝","prompts":["图1","图2","图3"]}]}', 2, 3)

    expect(groups.flatMap((group) => group.prompts)).toEqual([
      '系列统一规范（非画面文字）：蓝\n本张画面：图1',
      '系列统一规范（非画面文字）：蓝\n本张画面：图2',
      '系列统一规范（非画面文字）：蓝\n本张画面：图3',
    ])
  })

  it('truncates extra series groups and drops groups with too few members', () => {
    const groups = parseSopSeriesPromptBatchResponse(
      JSON.stringify({
        series: [
          { fixed: 'A', prompts: ['图1', '图2', '图3'] },
          { fixed: 'B', prompts: ['图4', '图5'] },
          { fixed: 'C', prompts: ['图6', '图7', '图8'] },
          { fixed: 'D', prompts: ['图9', '图10', '图11'] },
        ],
      }),
      2,
      3,
    )

    expect(groups.map((group) => group.fixed)).toEqual(['A', 'C'])
    expect(groups.map((group) => group.groupIndex)).toEqual([0, 2])
  })

  it('rejects a series batch without a complete group', () => {
    expect(() => parseSopSeriesPromptBatchResponse('{"series":[{"fixed":"A","prompts":["图1"]}]}', 2, 3)).toThrow(
      '模型未返回完整的一组系列提示词，每组需要 3 条',
    )
    expect(() => parseSopSeriesPromptBatchResponse('{"prompts":["图1"]}', 1, 2)).toThrow('系列提示词没有返回内容')
    expect(() => parseSopSeriesPromptBatchResponse('不是 JSON', 1, 2)).toThrow('系列提示词返回格式不正确')
  })

  it('locks user-filled fixed dimensions and leaves the rest to the model', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 3,
        fixedDimensions: ['视觉风格', '构图方式'],
        variableDimensions: ['主体'],
        fixedValues: { 视觉风格: '3D 皮克斯风' },
      },
    })

    // 用户填的值原样进请求，已锁定的维度不再要求模型重写
    expect(request).toContain('视觉风格：3D 皮克斯风')
    expect(request).toContain('固定块只写其余固定维度（构图方式）的完整视觉规则')
    expect(request).toContain('内容为主体')
  })

  it('asks the model for an empty fixed block when every fixed dimension is locked', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 2,
        fixedDimensions: ['视觉风格'],
        variableDimensions: ['主体', '背景'],
        fixedValues: { 视觉风格: '3D 皮克斯风' },
      },
    })

    expect(request).toContain('固定维度已全部被用户锁定，fixed 字段返回空字符串')
  })

  it('never emits a broken rule sentence for empty dimension lists', () => {
    const noFixed = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: { imageCount: 2, fixedDimensions: [], variableDimensions: ['主体'] },
    })
    expect(noFixed).toContain('本组没有需要写进固定块的视觉维度')
    expect(noFixed).not.toContain('固定块内容为的完整视觉规则')

    const noVariable = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: { imageCount: 2, fixedDimensions: ['视觉风格'], variableDimensions: [] },
    })
    expect(noVariable).toContain('本次未限定可变维度')
  })

  it('asks the model to author the group copy when 文案内容 is fixed but left blank', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 3,
        fixedDimensions: ['画风', '文案内容'],
        variableDimensions: ['主体', '背景'],
      },
    })

    expect(request).toContain('「文案内容」已固定：请在 fixedCopy 字段写出本组唯一的那一句画面文字')
    // 文案不能进固定块：那个块被标注为「非画面文字」
    expect(request).toContain('固定块内容为画风的完整视觉规则')
    expect(request).not.toContain('文案内容的完整视觉规则')
    expect(request).toContain('"fixedCopy":"本组画面文字，没有则空字符串"')
    // 变化部分要明确不再写文案
    expect(request).toContain('文案内容已整组固定，变化部分不得再写任何画面文字')
  })

  it('hands the user-filled copy to the client instead of asking the model for it', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 3,
        fixedDimensions: ['画风', '文案内容'],
        variableDimensions: ['主体'],
        fixedValues: { 文案内容: '限时 5 折，仅限今天' },
      },
    })

    // 文案由客户端逐字拼进画面文字段，模型只需返回空 fixedCopy
    expect(request).toContain('用户已逐字锁定画面文字')
    expect(request).not.toContain('限时 5 折，仅限今天')
  })

  it('asks for an empty fixedCopy when 文案内容 varies per image', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 3,
        fixedDimensions: ['画风'],
        variableDimensions: ['主体', '背景', '文案内容'],
      },
    })

    expect(request).toContain('「文案内容」每张变化：fixedCopy 字段返回空字符串')
    expect(request).not.toContain('文案内容已整组固定')
  })

  it('reuses the locked copy block on single-member regeneration', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 3,
        fixedDimensions: ['画风', '文案内容'],
        variableDimensions: ['主体'],
      },
      seriesFixedBlock: '画风：3D 皮克斯风',
      seriesCopyBlock: '限时 5 折',
      seriesMemberOnly: true,
    })

    expect(request).toContain('<COPY>\n限时 5 折\n</COPY>')
    expect(request).toContain('本组画面文字已锁定，必须逐字沿用')
  })

  it('keeps the locked fixed block instruction when the whole block is reused', () => {
    const request = buildSopPromptBatchRequest(sop, 1, '', {
      seriesConfig: {
        imageCount: 2,
        fixedDimensions: ['视觉风格'],
        variableDimensions: ['主体'],
        fixedValues: { 视觉风格: '3D 皮克斯风' },
      },
      seriesFixedBlock: '视觉风格：3D 皮克斯风；构图方式：中心对称',
    })

    // 整块复用时以 FIXED 为准，不再下发 LOCKED，避免同一段内容出现两次
    expect(request).toContain('<FIXED>')
    expect(request).not.toContain('<LOCKED>')
  })
})
