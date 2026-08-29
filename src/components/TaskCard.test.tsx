/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import TaskCard from './TaskCard'

const storeMocks = vi.hoisted(() => {
  const state = {
    toggleTaskSelection: vi.fn(),
    settings: { alwaysShowRetryButton: false },
    openFavoritePicker: vi.fn(),
    setConfirmDialog: vi.fn(),
  }
  const useStore = Object.assign(
    vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
    { getState: vi.fn(() => state) },
  )

  return {
    useStore,
    ensureImageCached: vi.fn(),
    ensureImageThumbnailCached: vi.fn(),
    subscribeImageThumbnail: vi.fn(() => () => {}),
    retryTask: vi.fn(),
    removeMultipleTasks: vi.fn(),
    updateTaskPrompt: vi.fn(),
  }
})

vi.mock('../store', () => storeMocks)
vi.mock('../stores/runtimeStore', () => ({
  useRuntimeStore: (selector: (value: { streamPreviews: Record<string, string> }) => unknown) =>
    selector({ streamPreviews: {} }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  vi.clearAllMocks()
})

const task: TaskRecord = {
  id: 'task-1',
  prompt: 'single image',
  params: { ...DEFAULT_PARAMS, n: 1 },
  inputImageIds: [],
  outputImages: ['image-1'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

describe('TaskCard', () => {
  it('falls back to the original image when a single output has no thumbnail', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce(undefined)
    storeMocks.ensureImageCached.mockResolvedValueOnce('data:image/png;base64,original')
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)

    expect(storeMocks.ensureImageCached).toHaveBeenCalledWith('image-1')
    expect(renderer.root.findByType('img').props.src).toBe('data:image/png;base64,original')
  })

  it('shows the actual generated resolution on the cover badge, not the scaled thumbnail size', async () => {
    // 回归：Electron 磁盘缩略图（thumbs/）解析出的是压缩后尺寸（最长边 ≤1024px），
    // 封面分辨率徽章必须用任务的实际参数（actualParamsByImage/actualParams）显示原图尺寸。
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumb',
      width: 1024,
      height: 1024,
      thumbnailVersion: 5,
    })
    const doneTask: TaskRecord = {
      ...task,
      actualParams: { size: '2048x2048' },
      actualParamsByImage: { 'image-1': { size: '2048x2048' } },
    }
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <TaskCard task={doneTask} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)

    const texts = renderer.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children)
    expect(texts).toContain('2048×2048')
    expect(texts).not.toContain('1024×1024')
  })
})
