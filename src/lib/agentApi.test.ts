import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import {
  callAgentApi,
  callAgentConversationTitleApi,
  callAgentResponsesApi,
  generateDerivedWordEntries,
  parseBatchImageCallArguments,
  parseVariableOptionRevisionResult,
  reviseSopDocument,
  reviseSopMetaInstruction,
  reviseVariablePromptOptions,
  transformSopDocument,
} from './agentApi'

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams Agent text and requests configured partial images', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0].partial_images).toBe(2)
    expect(body.instructions).toContain('Information-flow ad negative constraints')
    expect(body.instructions).toContain(
      'Whenever 2 or more images are ready to generate, call generate_image_batch exactly once',
    )
    expect(body.instructions).toContain('Set requested_count to the exact number of images')
    expect(body.instructions).not.toContain('One image_generation call per distinct image')
    expect(body.instructions).toContain('不得生成色情裸露')
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'generate_image_batch',
          parameters: expect.objectContaining({
            required: ['requested_count', 'finalize_after_batch', 'shared_prompt', 'images'],
          }),
        }),
      ]),
    )
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/png;base64,ZmluYWw=' }],
    })
  })

  it('passes mask data to the Agent image tool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'OK' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].input_image_mask).toEqual({ image_url: 'data:image/png;base64,bWFzaw==' })
  })

  it('uses the custom image function in hybrid mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentApiConfigMode: 'hybrid' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'generate_image' })]),
    )
    expect(body.tools).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image_generation' })]))
  })

  it('uses Chat Completions tool calls in hybrid compatibility mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chat_1',
          choices: [
            {
              message: {
                content: '我来生成。',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'generate_image', arguments: '{"id":"hero","prompt":"blue cat"}' },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })

    const result = await callAgentApi({
      settings: {
        ...DEFAULT_SETTINGS,
        agentApiConfigMode: 'hybrid',
        agentTextProtocol: 'chat-completions',
      },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '生成蓝猫' }] }],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions')
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[1]).toEqual({ role: 'user', content: '生成蓝猫' })
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'generate_image' }),
        }),
      ]),
    )
    expect(result).toMatchObject({
      responseId: 'chat_1',
      text: '我来生成。',
      outputItems: [
        expect.objectContaining({ type: 'message' }),
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call_1',
          name: 'generate_image',
        }),
      ],
    })
  })

  it('assembles streamed Chat Completions text and tool arguments', async () => {
    const streamBody = [
      'data: {"id":"chat_stream","choices":[{"delta":{"content":"开始"}}]}',
      '',
      'data: {"id":"chat_stream","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream","function":{"name":"generate_image","arguments":"{\\"id\\":\\"hero\\","}}]}}]}',
      '',
      'data: {"id":"chat_stream","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"prompt\\":\\"cat\\"}"}}]}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const deltas: string[] = []

    const result = await callAgentApi({
      settings: {
        ...DEFAULT_SETTINGS,
        agentApiConfigMode: 'hybrid',
        agentTextProtocol: 'chat-completions',
      },
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true }),
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: '生成猫' }],
      onTextDelta: (delta) => deltas.push(delta),
    })

    expect(deltas).toEqual(['开始'])
    expect(result.outputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call_stream',
          arguments: '{"id":"hero","prompt":"cat"}',
        }),
      ]),
    )
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'image_generation_call',
              id: 'ig_base64',
              result: { base64: 'ZmlsZQ==' },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([
      {
        toolCallId: 'ig_base64',
        dataUrl: 'data:image/png;base64,ZmlsZQ==',
        actualParams: {},
      },
    ])
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = ['data: {"type":"response.output_text.delta","delta":"Hel"}', '', ''].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(streamBody))
            controller.close()
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    )
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(
      callAgentResponsesApi({
        settings: DEFAULT_SETTINGS,
        profile,
        params: DEFAULT_PARAMS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
        signal: abortController.signal,
        onTextDelta: (delta) => {
          textDeltas.push(delta)
          abortController.abort()
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('generates conversation titles through Chat Completions compatibility mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '<title>稳定生图</title>' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key' })

    const title = await callAgentConversationTitleApi({
      settings: {
        ...DEFAULT_SETTINGS,
        agentApiConfigMode: 'hybrid',
        agentTextProtocol: 'chat-completions',
      },
      profile,
      prompt: '分析接口稳定性',
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions')
    expect(title).toBe('稳定生图')
  })

  it('audits SOP documents through the configured Agent Chat Completions protocol', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '## 总体结论\n缺少验收标准。' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', model: 'agent-chat-model' })

    const result = await transformSopDocument({
      settings: {
        ...DEFAULT_SETTINGS,
        agentApiConfigMode: 'hybrid',
        agentTextProtocol: 'chat-completions',
      },
      profile,
      operation: 'audit',
      content: '执行导出。',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions')
    expect(body.model).toBe('agent-chat-model')
    expect(body.messages[0].content).toContain('meticulous SOP document editor')
    expect(body.messages[1].content).toContain('Do not rewrite it')
    expect(result).toContain('缺少验收标准')
  })

  it('creates a structured multi-turn SOP revision with the current document and prior proposal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    assistant_reply: '已保留约束并补充验收标准。',
                    change_summary: ['补充验收标准', '压缩重复说明'],
                    revised_sop: '# SOP\n\n1. 执行\n2. 验收',
                  }),
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'agent-sop-chat-model',
    })

    const result = await reviseSopDocument({
      settings: DEFAULT_SETTINGS,
      profile,
      content: '# 原 SOP\n\n执行导出。',
      conversation: [
        { role: 'user', text: '先精简' },
        { role: 'assistant', text: '已精简。', revisionContent: '# 精简版\n\n执行导出。' },
        { role: 'user', text: '再补验收标准' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.text.format.name).toBe('sop_revision')
    expect(body.input[0].content).toContain('<current_sop>')
    expect(body.input[2].content).toContain('<proposed_sop>')
    expect(body.input.at(-1).content).toBe('再补验收标准')
    expect(result).toEqual({
      reply: '已保留约束并补充验收标准。',
      content: '# SOP\n\n1. 执行\n2. 验收',
      changeSummary: ['补充验收标准', '压缩重复说明'],
    })
  })

  it('rejects a generalization revision that adds variable-prompt syntax', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    assistant_reply: '已泛化具体描述。',
                    change_summary: ['泛化具体词'],
                    revised_sop: '# SOP\n\n泛化后的描述。\n\n可变项：\n{{主体}}：猫 / 狗',
                  }),
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'agent-sop-chat-model',
    })

    await expect(
      reviseSopDocument({
        settings: DEFAULT_SETTINGS,
        profile,
        content: '# 元素池\n\n层级一：主体\n1. 具体主体\n\n层级二：背景\n1. 具体背景',
        conversation: [{ role: 'user', text: '将具体词泛化' }],
      }),
    ).rejects.toThrow('不允许新增可变项')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('Variable-prompt work is a separate feature')
  })

  it('falls back when a compatible provider rejects structured SOP revision output', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unsupported response format', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_reply: '已调整。',
                    change_summary: ['调整结构'],
                    revised_sop: '# 调整后 SOP',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', model: 'agent-chat-model' })

    const result = await reviseSopDocument({
      settings: { ...DEFAULT_SETTINGS, agentTextProtocol: 'chat-completions' },
      profile,
      content: '# SOP',
      conversation: [{ role: 'user', text: '调整结构' }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(secondBody.response_format).toBeUndefined()
    expect(result.content).toBe('# 调整后 SOP')
  })

  it('uses generation-meta-instruction context for a multi-turn revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    assistant_reply: '已增强输出约束。',
                    change_summary: ['补充输出格式约束'],
                    revised_sop: '分析输入并输出完整、可执行的 SOP。',
                  }),
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'agent-meta-chat-model',
    })

    const result = await reviseSopMetaInstruction({
      settings: DEFAULT_SETTINGS,
      profile,
      content: '分析输入并生成 SOP。',
      conversation: [
        { role: 'user', text: '补充输出格式约束' },
        { role: 'assistant', text: '已补充。', revisionContent: '分析输入并输出 SOP。' },
        { role: 'user', text: '确保结果可直接执行' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('generation meta-instruction editor')
    expect(body.text.format.name).toBe('sop_meta_instruction_revision')
    expect(body.text.format.schema.properties.revised_sop.description).toContain('generation meta-instruction')
    expect(body.input[0].content).toContain('<current_meta_instruction>')
    expect(body.input[2].content).toContain('<proposed_meta_instruction>')
    expect(result).toEqual({
      reply: '已增强输出约束。',
      content: '分析输入并输出完整、可执行的 SOP。',
      changeSummary: ['补充输出格式约束'],
    })
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_search',
          output: [
            {
              type: 'web_search_call',
              id: 'ws_1',
              status: 'completed',
              action: { type: 'search', query: 'OpenAI web search docs' },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'See OpenAI docs.',
                  annotations: [
                    {
                      type: 'url_citation',
                      start_index: 4,
                      end_index: 15,
                      url: 'https://platform.openai.com/docs',
                      title: 'OpenAI Docs',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })
})

describe('generateDerivedWordEntries', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reports a failed image tool without aborting the remaining stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', streamImages: true })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({ responseId: 'resp_1', text: '已跳过失败图片', images: [] })
  })

  it('does not duplicate an assistant item when the completed snapshot omits its id', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"},"output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', streamImages: true })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    })

    expect((result.outputItems ?? []).filter((item) => item.type === 'message')).toHaveLength(1)
    expect(result.text).toBe('hi!')
  })

  it('generates cleaned word entries with a text-only Agent request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '["红色背景","绿色背景","红色背景",""]' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    const result = await generateDerivedWordEntries({
      settings: DEFAULT_SETTINGS,
      profile,
      seedEntry: '黑色背景',
      similarity: 85,
      count: 3,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('gpt-5.5')
    expect(body.tools).toBeUndefined()
    expect(body.instructions).toContain('JSON array')
    expect(body.instructions).toContain('complete existing variable-entry set')
    expect(body.instructions).toContain('concrete instance → subtype/style school → upper-level category')
    expect(body.input[0].content[0].text).toContain('黑色背景')
    expect(body.input[0].content[0].text).toContain('85')
    expect(body.input[0].content[0].text).toContain('3')
    expect(result).toEqual(['红色背景', '绿色背景'])
  })

  it('includes the built-in semantic derivative rule in the request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '["green background"]' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    await generateDerivedWordEntries({
      settings: DEFAULT_SETTINGS,
      profile,
      seedEntry: 'red background',
      similarity: 85,
      count: 1,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input[0].content[0].text).toContain('Analyze the existing entries as one set')
    expect(body.input[0].content[0].text).toContain('red background')
  })

  it('provides the variable name and all current entries for analysis before derivation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '["发光行星"]' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    await generateDerivedWordEntries({
      settings: DEFAULT_SETTINGS,
      profile,
      variableName: '主视觉主体',
      seedEntry: '月球',
      contextEntries: ['月球', '新月', '满月'],
      similarity: 60,
      count: 1,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    const input = body.input[0].content[0].text
    expect(input).toContain('Variable name: 主视觉主体')
    expect(input).toContain('Existing variable entries to analyze before derivation:')
    expect(input).toContain('- 新月')
    expect(input).toContain('- 满月')
  })

  it('includes the custom global derivative rule in the request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '["绿色背景"]' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    await generateDerivedWordEntries({
      settings: {
        ...DEFAULT_SETTINGS,
        wordLibraryDerivativeRules: [
          {
            id: 'color',
            name: '颜色替换',
            content: '优先保留名词，只替换颜色形容词。',
            enabled: true,
          },
        ],
      },
      profile,
      seedEntry: '红色背景',
      similarity: 85,
      count: 1,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input[0].content[0].text).toContain('优先保留名词，只替换颜色形容词。')
  })

  it('combines multiple enabled derivative rules in multi-select mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '["绿色背景"]' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    await generateDerivedWordEntries({
      settings: {
        ...DEFAULT_SETTINGS,
        wordLibraryDerivativeRuleMode: 'multiple',
        wordLibraryDerivativeRules: [
          { id: 'color', name: '颜色替换', content: 'Replace color adjectives.', enabled: true },
          { id: 'style', name: '风格替换', content: 'Replace style adjectives.', enabled: true },
          { id: 'disabled', name: '停用规则', content: 'Do not include this.', enabled: false },
        ],
      },
      profile,
      seedEntry: 'red background',
      similarity: 85,
      count: 1,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input[0].content[0].text).toContain('Rule: 颜色替换')
    expect(body.input[0].content[0].text).toContain('Replace color adjectives.')
    expect(body.input[0].content[0].text).toContain('Rule: 风格替换')
    expect(body.input[0].content[0].text).toContain('Replace style adjectives.')
    expect(body.input[0].content[0].text).not.toContain('Do not include this.')
  })

  it('reports a clear timeout error when derived word generation times out', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal
          if (signal instanceof AbortSignal) {
            signal.addEventListener(
              'abort',
              () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              },
              { once: true },
            )
          }
        }),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
      timeout: 1,
    })

    const promise = generateDerivedWordEntries({
      settings: DEFAULT_SETTINGS,
      profile,
      seedEntry: '红色背景',
      similarity: 85,
      count: 3,
    })
    const assertion = expect(promise).rejects.toThrow('词条生成超时')
    await vi.advanceTimersByTimeAsync(1000)

    await assertion
  })
})

describe('reviseVariablePromptOptions', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const TEMPLATE = `图片比例为16:9。根据 {{主体}} 生成画面。

可变项：
{{主体}}：猫 / 狗 / 兔子`

  it('sends a derive request through the Responses protocol and parses the option pool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"reasoning":"围绕宠物日常补充同类选项","options":["金毛犬","布偶猫","垂耳兔","奶牛猫","橘猫"]}',
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', model: 'gpt-5.5' })

    const result = await reviseVariablePromptOptions({
      settings: DEFAULT_SETTINGS,
      profile,
      content: TEMPLATE,
      variableName: '主体',
      theme: '宠物日常',
      type: '实物',
      count: 5,
      mode: 'derive',
    })

    expect(result).toEqual({
      options: ['金毛犬', '布偶猫', '垂耳兔', '奶牛猫', '橘猫'],
      reasoning: '围绕宠物日常补充同类选项',
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('derive mode')
    expect(body.text.format.name).toBe('variable_option_revision')
    expect(body.input[0].content[0].text).toContain('Target variable: {{主体}}')
    expect(body.input[0].content[0].text).toContain('Theme: 宠物日常')
    expect(body.input[0].content[0].text).toContain('Type: 实物')
    expect(body.input[0].content[0].text).toContain('Target count: 5')
    expect(body.input[0].content[0].text).toContain('Existing options of this variable (3)')
    expect(body.input[0].content[0].text).toContain('Mode: derive')
  })

  it('sends a rewrite request through chat completions with the JSON schema format', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"options":["高级丝绒礼盒","鎏金浮雕款","珍珠缎面款"],"reasoning":"按高端美妆重写"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      model: 'gpt-5.5',
    })

    const result = await reviseVariablePromptOptions({
      settings: { ...DEFAULT_SETTINGS, agentTextProtocol: 'chat-completions' },
      profile,
      content: TEMPLATE,
      variableName: '主体',
      theme: '高端美妆',
      type: '文案联动',
      count: 3,
      mode: 'rewrite',
    })

    expect(result.options).toHaveLength(3)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toContain('Mode: rewrite')
    expect(body.response_format.json_schema.name).toBe('variable_option_revision')
  })

  it('parses option results tolerantly: fences, extra keys, duplicates and count capping', () => {
    const result = parseVariableOptionRevisionResult(
      '```json\n{"options":["A","A","B","C","D","E"],"reasoning":"r","extra":1}\n```',
      4,
    )
    expect(result).toEqual({ options: ['A', 'B', 'C', 'D'], reasoning: 'r' })
  })

  it('rejects results without any usable option', () => {
    expect(() => parseVariableOptionRevisionResult('{"reasoning":"无"}', 3)).toThrow('可用的可变项选项')
    expect(() => parseVariableOptionRevisionResult('不是 JSON', 3)).toThrow('可解析的可变项选项结果')
  })

  it('fails with a timeout error when the Agent exceeds the configured timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          }, 1000)
        }),
    )
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
      timeout: 1,
    })

    const promise = reviseVariablePromptOptions({
      settings: DEFAULT_SETTINGS,
      profile,
      content: TEMPLATE,
      variableName: '主体',
      theme: '',
      type: '',
      count: 5,
      mode: 'derive',
    })
    const assertion = expect(promise).rejects.toThrow('可变项选项生成超时')
    await vi.advanceTimersByTimeAsync(1000)

    await assertion
  })
})

describe('parseBatchImageCallArguments', () => {
  it('parses a validated terminal batch plan', () => {
    expect(
      parseBatchImageCallArguments(
        JSON.stringify({
          requested_count: 2,
          finalize_after_batch: true,
          shared_prompt: '  shared style  ',
          images: [
            { id: 'first', prompt: ' first prompt ' },
            { id: 'second', prompt: 'second prompt' },
          ],
        }),
      ),
    ).toEqual({
      requestedCount: 2,
      finalizeAfterBatch: true,
      sharedPrompt: 'shared style',
      images: [
        { id: 'first', prompt: 'first prompt' },
        { id: 'second', prompt: 'second prompt' },
      ],
    })
  })

  it('rejects count mismatches and duplicate ids', () => {
    expect(
      parseBatchImageCallArguments(
        JSON.stringify({
          requested_count: 2,
          images: [{ id: 'only', prompt: 'prompt' }],
        }),
      ),
    ).toBeNull()
    expect(
      parseBatchImageCallArguments(
        JSON.stringify({
          requested_count: 2,
          images: [
            { id: 'duplicate', prompt: 'first' },
            { id: 'duplicate', prompt: 'second' },
          ],
        }),
      ),
    ).toBeNull()
  })
})
