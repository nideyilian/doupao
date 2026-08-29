import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateSopFromStore,
  generateVariablePromptTwoPhase,
  generateVariablePromptsFromSopStore,
  getSopPromptGenerationModelFromStore,
  testSopRevisionFromStore,
} from './storeSopGeneration'
import {
  DEFAULT_DERIVE_DIMENSION_POLICY,
  buildCopyModeInstruction,
  buildDerivePolicyInstruction,
} from '../derivePolicy'

const storeMocks = vi.hoisted(() => ({
  submitTaskWithData: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    apiMode: 'responses',
    name: 'Agent 测试',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiProxy: false,
  }),
  validateApiProfile: () => null,
}))

vi.mock('../../../lib/devProxy', () => ({
  buildApiUrl: () => 'https://api.example.com/v1/responses',
  readClientDevProxyConfig: () => ({}),
  shouldUseApiProxy: () => false,
}))

vi.mock('../../../store', () => ({
  submitTaskWithData: storeMocks.submitTaskWithData,
  useStore: {
    getState: () => ({
      settings: { model: 'gpt-test' },
      workspaceTabs: [{ id: 'tab-1', name: '测试画廊' }],
      activeWorkspaceTabId: 'tab-1',
      inputImages: [{ id: 'reference-1', dataUrl: 'data:image/png;base64,AAA' }],
      inputImageFolder: null,
      params: { n: 4, size: '1024x1024' },
      customOutputPath: '',
      showToast: storeMocks.showToast,
    }),
  },
}))

function responsePayload(text: string) {
  return {
    output: [{ content: [{ type: 'output_text', text }] }],
  }
}

function mockResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(responsePayload(text)),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('store SOP generation', () => {
  it('reports the actual text model used for prompt generation', () => {
    expect(getSopPromptGenerationModelFromStore()).toBe('gpt-test')
  })

  it('sends all reference images with strict structured output and reports real phases', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"name":"多图 SOP","description":"说明","sop":"# 正文"}'))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    await expect(
      generateSopFromStore(
        '',
        {},
        [
          { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
          { name: 'B.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
        ],
        'image-prompt',
        undefined,
        {
          onProgress: (item) => progress.push(item.stage),
        },
      ),
    ).resolves.toEqual({ name: '多图 SOP', description: '说明', sop: '# 正文' })

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(request.text.format.schema.required).toEqual(['name', 'description', 'sop'])
    expect(request.input[0].content).toEqual(
      expect.arrayContaining([
        { type: 'input_text', text: '参考图 1/2：A.png' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
        { type: 'input_text', text: '参考图 2/2：B.jpg' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,BBB' },
      ]),
    )
    expect(progress).toEqual(['validate', 'prepare', 'request', 'parse'])
  })

  it('automatically retries an incomplete model response before surfacing an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse('{"name":"缺少正文"}'))
      .mockResolvedValueOnce(mockResponse('{"name":"修复后的 SOP","description":"说明","sop":"# 完整正文"}'))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    await expect(
      generateSopFromStore('生成 SOP', {}, [], 'general', undefined, {
        onProgress: (item) => progress.push(item.stage),
      }),
    ).resolves.toEqual({ name: '修复后的 SOP', description: '说明', sop: '# 完整正文' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(progress).toContain('repair')
    expect(progress.at(-1)).toBe('parse')
  })

  it('turns a revision proposal into one prompt and submits one image with current gallery context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"prompts":["测试商品图提示词"]}'))
    vi.stubGlobal('fetch', fetchMock)
    storeMocks.submitTaskWithData.mockResolvedValue('task-test-1')

    await testSopRevisionFromStore({
      id: 'sop-1',
      name: '商品图 SOP',
      description: '',
      content: '# 修订 SOP',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '测试商品图提示词',
        inputImages: [{ id: 'reference-1', dataUrl: 'data:image/png;base64,AAA' }],
        params: expect.objectContaining({ n: 1 }),
        maskDraft: null,
        targetTabId: 'tab-1',
        scheduledOutputSubFolder: '测试画廊',
      }),
      { silentSuccess: true },
    )
    expect(storeMocks.showToast).toHaveBeenCalledWith('测试任务已提交，可在当前画廊查看生成结果', 'success')
  })

  it('generates a variable prompt asset with the variablePrompt schema and applies the no-text policy', async () => {
    const generated = JSON.stringify({
      name: '嵌套防护',
      description: '结构策略',
      variablePrompt: '图片比例为16:9。生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗',
    })
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(generated))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSopFromStore(
      '从参考图反推变量提示词',
      {},
      [{ name: 'A.png', dataUrl: 'data:image/png;base64,AAA' }],
      'variable-prompt-skill',
      undefined,
      { excludeText: true },
    )

    expect(result.name).toBe('嵌套防护')
    expect(result.sop).toContain('忽略参考图中的所有文字与文案排版')
    expect(result.sop).toContain('{{主体}}：猫 / 狗')

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.text.format.schema.required).toEqual(['name', 'description', 'variablePrompt'])
    expect(request.instructions).toContain('排除文字')
  })

  it('repairs an invalid generated variable prompt once before surfacing an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          '{"name":"错误模板","description":"说明","variablePrompt":"生成{{主体}}。\\n可变项：{{主体}}：猫 / 狗"}',
        ),
      )
      .mockResolvedValueOnce(
        mockResponse(
          '{"name":"修复模板","description":"说明","variablePrompt":"生成{{主体}}。\\n\\n可变项：\\n{{主体}}：猫 / 狗"}',
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateSopFromStore(
        '从参考图反推变量提示词',
        {},
        [{ name: 'A.png', dataUrl: 'data:image/png;base64,AAA' }],
        'variable-prompt-skill',
        undefined,
        { excludeText: false },
      ),
    ).resolves.toMatchObject({ name: '修复模板' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces an exclude-text violation without retrying', async () => {
    const generated = JSON.stringify({
      name: '带文案模板',
      description: '说明',
      variablePrompt: '生成{{主标题}}。\n\n可变项：\n{{主标题}}：好味道 / 清爽',
    })
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(generated))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateSopFromStore(
        '从参考图反推变量提示词',
        {},
        [{ name: 'A.png', dataUrl: 'data:image/png;base64,AAA' }],
        'variable-prompt-skill',
        undefined,
        { excludeText: true },
      ),
    ).rejects.toThrow('开启“排除文字”后')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('generateVariablePromptsFromSopStore（变量提示词模式）', () => {
    const variableSop = {
      id: 'sop-var-1',
      name: '柴犬衍生',
      description: '从参考图反推的变量提示词模板',
      content: '一只{{主体}}，{{风格}}风格。\n\n可变项：\n{{主体}}：柴犬 / 柯基\n{{风格}}：水彩 / 油画 / 卡通',
      source: 'generated' as const,
      executionMode: 'variable-prompt' as const,
      createdBy: 'test',
      createdAt: 0,
      updatedAt: 0,
    }

    it('组合充足时本地展开全部提示词，不调用 AI', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const onBatch = vi.fn()

      const result = await generateVariablePromptsFromSopStore(variableSop, 6, '', {
        onBatch,
        exact: false,
      })

      expect(result).toHaveLength(6)
      // 展开结果互不重复（组合 2×3=6 恰好全部覆盖）
      expect(new Set(result).size).toBe(6)
      expect(result.every((prompt) => prompt.includes('一只') && prompt.includes('风格'))).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(onBatch).toHaveBeenCalledWith(expect.any(Array), 6, 6)
    })

    it('组合不足时自动调 AI 扩词条后再展开', async () => {
      const expanded = JSON.stringify({
        variablePrompt:
          '一只{{主体}}，{{风格}}风格。\n\n可变项：\n{{主体}}：柴犬 / 柯基 / 金毛 / 萨摩耶 / 边牧\n{{风格}}：水彩 / 油画 / 卡通 / 素描 / 3D',
      })
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(expanded))
      vi.stubGlobal('fetch', fetchMock)

      const result = await generateVariablePromptsFromSopStore(variableSop, 20, '', {
        exact: false,
      })

      expect(result).toHaveLength(20)
      expect(new Set(result).size).toBe(20)
      // 至少发起一次扩词条请求
      expect(fetchMock).toHaveBeenCalled()
      const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      expect(request.instructions).toContain('词条扩充')
    })

    it('模板格式错误时直接报错', async () => {
      const brokenSop = {
        ...variableSop,
        content: '没有可变项的普通提示词',
      }
      await expect(generateVariablePromptsFromSopStore(brokenSop, 3, '')).rejects.toThrow('变量提示词模板格式有误')
    })
  })

  describe('generateVariablePromptTwoPhase（两阶段衍生）', () => {
    const referenceImages = [{ name: 'A.png', dataUrl: 'data:image/png;base64,AAA' }]

    const profileJson = JSON.stringify({
      profiles: [
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
          textElements: [],
          coreVisualMechanism: '主体居中留白',
          derivableDimensions: ['主体', '风格', '场景'],
          lockedFacts: [],
        },
      ],
    })

    const templateJson = JSON.stringify({
      name: '柴犬衍生模板',
      description: '从参考图反推',
      variablePrompt:
        '一只{{主体}}，{{风格}}风格。\n\n可变项：\n{{主体}}：柴犬 / 柯基 / 金毛 / 萨摩耶 / 边牧 / 二哈 / 泰迪 / 拉布拉多\n{{风格}}：水彩 / 油画 / 卡通 / 素描 / 3D / 国画 / 版画 / 铅笔稿',
    })

    it('两阶段：先档案后模板，两次请求', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockResponse(profileJson))
        .mockResolvedValueOnce(mockResponse(templateJson))
      vi.stubGlobal('fetch', fetchMock)

      const result = await generateVariablePromptTwoPhase('柴犬衍生', referenceImages, {
        dimensionPolicyInstruction: buildDerivePolicyInstruction(DEFAULT_DERIVE_DIMENSION_POLICY),
      })

      expect(result.sop).toContain('可变项')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      // 第一次请求带图片，第二次不带
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
      expect(JSON.stringify(firstBody.input)).toContain('input_image')
      expect(JSON.stringify(secondBody.input)).not.toContain('input_image')
      expect(secondBody.instructions).toContain('视觉档案')
    })

    it('质量校验不合格时自动重试一次', async () => {
      // 第一次模板：主体变量只有 2 个选项（不达标）；重试后达标
      const poorTemplate = JSON.stringify({
        name: '劣质模板',
        description: 'x',
        variablePrompt: '一只{{主体}}。\n\n可变项：\n{{主体}}：柴犬 / 柯基',
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockResponse(profileJson))
        .mockResolvedValueOnce(mockResponse(poorTemplate))
        .mockResolvedValueOnce(mockResponse(templateJson))
      vi.stubGlobal('fetch', fetchMock)

      const result = await generateVariablePromptTwoPhase('柴犬衍生', referenceImages, {
        dimensionPolicyInstruction: buildDerivePolicyInstruction(DEFAULT_DERIVE_DIMENSION_POLICY),
      })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(result.sop).toContain('柯基 / 金毛')
    })

    it('无参考图时报错', async () => {
      await expect(generateVariablePromptTwoPhase('x', [])).rejects.toThrow('至少需要一张参考图片')
    })

    it('文案衍生模式：指令明确要求文案变成变量，不使用 APP_COPY 保留指令', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockResponse(profileJson))
        .mockResolvedValueOnce(mockResponse(templateJson))
      vi.stubGlobal('fetch', fetchMock)

      await generateVariablePromptTwoPhase('柴犬衍生', referenceImages, {
        excludeText: false,
        copyModeInstruction: buildCopyModeInstruction('derive'),
        dimensionPolicyInstruction: buildDerivePolicyInstruction(DEFAULT_DERIVE_DIMENSION_POLICY),
      })

      const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
      // 系统指令：文案衍生专用基础指令 + 「画面文字是衍生素材」声明
      expect(secondBody.instructions).toContain('带文案变量提示词生成器')
      expect(secondBody.instructions).toContain('画面文字」是必须衍生的素材')
      // 用户消息：文案必须变成变量
      expect(JSON.stringify(secondBody.input)).toContain('【文案处理】')
      expect(JSON.stringify(secondBody.input)).toContain('变成模板的可变项')
      // 不得再出现 APP_COPY 的「精确文案必须进入提示词」
      expect(secondBody.instructions).not.toContain('精确文案必须进入提示词')
    })
  })
})
