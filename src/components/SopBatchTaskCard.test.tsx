/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import SopBatchTaskCard from './SopBatchTaskCard'

const storeMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  vi.clearAllMocks()
})

function task(id: string, index: number): TaskRecord {
  return {
    id,
    prompt: `提示词 ${index}`,
    sopBatch: { batchId: 'batch-1', sopId: 'sop-1', sopName: '天体图', promptIndex: index, promptCount: 2 },
    params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', n: 1 },
    inputImageIds: [],
    outputImages: [`image-${index}`],
    status: 'done',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  } as unknown as TaskRecord
}

describe('SopBatchTaskCard', () => {
  it('uses batch-level selection, gallery opening, and deletion callbacks', () => {
    const onClick = vi.fn()
    const onOpenBatch = vi.fn()
    const onOpenImage = vi.fn()
    const onRerun = vi.fn()
    const onDelete = vi.fn()
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[task('task-1', 1), task('task-2', 2)]}
          summary={{ total: 2, running: 0, completed: 2, failed: 0 }}
          isSelected
          onClick={onClick}
          onOpenBatch={onOpenBatch}
          onOpenImage={onOpenImage}
          onRerun={onRerun}
          onDelete={onDelete}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root
      .findAllByProps({ 'data-selected': true })
      .find((node) => String(node.props.className).includes('gallery-sop-card'))
    expect(card?.props.className).toContain('gallery-task-card')
    expect(card?.props['data-status']).toBe('done')
    act(() => card!.props.onClick({}))
    expect(onClick).toHaveBeenCalledOnce()

    const thumbnail = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '查看 SOP 批量任务封面图片')
    act(() => thumbnail!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onOpenImage).toHaveBeenCalledWith('image-1')
    expect(onOpenBatch).not.toHaveBeenCalled()

    const openBatchButton = renderer!.root.findByProps({ 'aria-label': '查看 SOP 批量任务 天体图' })
    act(() => openBatchButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onOpenBatch).toHaveBeenCalledOnce()

    const rerunButton = renderer!.root.findByProps({ 'aria-label': '再次生成 SOP 批量任务 天体图' })
    act(() => rerunButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onRerun).toHaveBeenCalledOnce()
    expect(rerunButton.props.className).toContain('gallery-task-action')
    expect(renderer!.root.findByProps({ 'aria-label': 'SOP 批量任务操作' }).props.className).toContain(
      'overflow-x-auto',
    )
    expect(renderer!.root.findByProps({ 'aria-label': '任务参数' })).toBeTruthy()
    expect(renderer!.root.findByType('h3').children).toContain('已完成')

    const deleteButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '删除 SOP 批量任务 天体图')
    act(() => deleteButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
