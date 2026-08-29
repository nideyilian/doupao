import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { GeneratedAssetOrigin } from '../../types'
import { DEFAULT_PARAMS } from '../../types'
import AssetParamBreakdown from './AssetParamBreakdown'

function makeOrigin(overrides: Partial<GeneratedAssetOrigin> = {}): GeneratedAssetOrigin {
  return {
    key: 'task-1:0',
    taskId: 'task-1',
    outputSlot: 0,
    taskCreatedAt: 1000,
    taskFinishedAt: 2000,
    sourceMode: 'sop',
    prompt: 'a cat',
    requestedParams: DEFAULT_PARAMS,
    apiProvider: 'openai',
    apiProfileName: '主配置',
    apiModel: 'gpt-image-1',
    inputImageIds: [],
    ...overrides,
  }
}

async function render(origin: GeneratedAssetOrigin | undefined): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<AssetParamBreakdown origin={origin} />)
  })
  return renderer
}

function texts(renderer: ReactTestRenderer): string[] {
  const result: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      result.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (value && typeof value === 'object' && 'props' in value) {
      walk((value as { props: { children?: unknown } }).props.children)
    }
  }
  for (const node of renderer.root.findAll((item) => item.props && 'children' in item.props)) {
    walk(node.props.children)
  }
  return result
}

describe('AssetParamBreakdown', () => {
  it('shows shared task-level params with model and requested values', async () => {
    const renderer = await render(makeOrigin())
    const text = texts(renderer)
    expect(text.some((item) => item.includes('生成参数'))).toBe(true)
    expect(text.some((item) => item.includes('任务级共享'))).toBe(true)
    expect(text.some((item) => item.includes('主配置 · gpt-image-1'))).toBe(true)
    expect(text.some((item) => item.includes('自动'))).toBe(true) // size auto
    expect(text.some((item) => item.includes('循环参考'))).toBe(true)
    expect(text.some((item) => item.includes('1'))).toBe(true) // n
  })

  it('marks task-level actual mismatches and shows per-image exclusive params', async () => {
    const renderer = await render(
      makeOrigin({
        actualParams: { size: '1024x1024' },
        imageActualParams: { size: '1536x1024', seed: 42 },
        generatedFileNameBase: '海报_01',
        filenameLabel: '图册',
      }),
    )
    const text = texts(renderer)
    expect(text.some((item) => item.includes('本图专属'))).toBe(true)
    expect(text.some((item) => item.includes('Seed'))).toBe(true)
    expect(text.some((item) => item.includes('42'))).toBe(true)
    expect(text.some((item) => item.includes('1536x1024'))).toBe(true)
    expect(text.some((item) => item.includes('海报_01'))).toBe(true)
    // 任务级差异以「实际值」徽章呈现
    expect(renderer.root.findAll((node) => node.props.title === 'API 实际响应值').length).toBeGreaterThan(0)
  })

  it('returns null without an origin', async () => {
    const renderer = await render(undefined)
    expect(renderer.root.findAll((node) => node.type === 'div')).toHaveLength(0)
  })

  it('hides the exclusive section when there is nothing per-image', async () => {
    const renderer = await render(makeOrigin())
    const text = texts(renderer)
    expect(text.some((item) => item.includes('本图专属'))).toBe(false)
  })
})
