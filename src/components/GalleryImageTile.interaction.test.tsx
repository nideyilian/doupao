/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import GalleryImageTile, { HOVER_FULL_IMAGE_DEBOUNCE_MS, type GalleryImageItem } from './GalleryImageTile'

const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(() => new Promise<string | undefined>(() => {})),
  ensureImageThumbnailCached: vi.fn(() => new Promise(() => {})),
  getCachedThumbnail: vi.fn(() => null),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

const task: TaskRecord = {
  id: 'task-1',
  prompt: 'prompt',
  params: { ...DEFAULT_PARAMS },
  inputImageIds: [],
  outputImages: ['image-1', 'image-2'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

const item: GalleryImageItem = {
  id: 'task-1:image-2:1',
  imageId: 'image-2',
  imageIndex: 1,
  task,
}

// jsdom 不实现 Image.decode 也不加载 data URL：stub 成同步 resolve，
// 让「离屏预解码」在测试里直接完成。
const originalDecode = HTMLImageElement.prototype.decode

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn(async () => {}) as typeof originalDecode
  storeMocks.ensureImageCached.mockClear()
  storeMocks.ensureImageThumbnailCached.mockClear()
})

afterEach(() => {
  HTMLImageElement.prototype.decode = originalDecode
  vi.useRealTimers()
})

describe('GalleryImageTile interactions', () => {
  it('selects its task and opens the exact image detail by mouse or keyboard', () => {
    const onSelect = vi.fn()
    const onOpenDetail = vi.fn()
    let renderer!: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <GalleryImageTile item={item} selected={false} onSelect={onSelect} onOpenDetail={onOpenDetail} />,
      )
    })

    const tile = renderer.root.findByType('article')
    act(() => tile.props.onClick({ ctrlKey: true, metaKey: false }))
    expect(onSelect).toHaveBeenCalledWith(true)

    const preventDefault = vi.fn()
    act(() => tile.props.onDoubleClick({ preventDefault }))
    expect(preventDefault).toHaveBeenCalled()
    expect(onOpenDetail).toHaveBeenCalledTimes(1)

    act(() => tile.props.onKeyDown({ key: 'Enter', preventDefault }))
    expect(onOpenDetail).toHaveBeenCalledTimes(2)
    expect(tile.props['aria-label']).toContain('单击选择所属任务')
  })

  it('loads the thumbnail by default and the original image on pointer enter (hover intent)', async () => {
    // 缩略图异步就绪
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })
    storeMocks.ensureImageCached.mockResolvedValueOnce('data:image/png;base64,full-resolution')
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GalleryImageTile item={item} selected={false} onSelect={vi.fn()} onOpenDetail={vi.fn()} />)
    })

    // 默认只用缩略图，不加载原图
    const image = renderer.root.findByType('img')
    expect(image.props.src).toBe('data:image/webp;base64,thumbnail')
    expect(image.props['data-image-quality']).toBe('thumbnail')

    // hover 后经防抖 + 离屏解码，原图按需加载并替换 src
    const tile = renderer.root.findByType('article')
    vi.useFakeTimers()
    await act(async () => {
      tile.props.onPointerEnter()
      vi.advanceTimersByTime(HOVER_FULL_IMAGE_DEBOUNCE_MS + 50)
    })
    vi.useRealTimers()

    const imageAfterHover = renderer.root.findByType('img')
    expect(imageAfterHover.props.src).toBe('data:image/png;base64,full-resolution')
    expect(imageAfterHover.props['data-image-quality']).toBe('full')
  })

  it('keeps the thumbnail when the pointer leaves before the debounce fires', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GalleryImageTile item={item} selected={false} onSelect={vi.fn()} onOpenDetail={vi.fn()} />)
    })

    const tile = renderer.root.findByType('article')
    vi.useFakeTimers()
    await act(async () => {
      tile.props.onPointerEnter()
      tile.props.onPointerLeave()
      vi.advanceTimersByTime(HOVER_FULL_IMAGE_DEBOUNCE_MS + 50)
    })
    vi.useRealTimers()

    const image = renderer.root.findByType('img')
    expect(image.props.src).toBe('data:image/webp;base64,thumbnail')
    expect(storeMocks.ensureImageCached).not.toHaveBeenCalled()
  })

  it('never loads the original when loadFullOnHover is disabled (large libraries)', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GalleryImageTile
          item={item}
          selected={false}
          onSelect={vi.fn()}
          onOpenDetail={vi.fn()}
          loadFullOnHover={false}
        />,
      )
    })

    const tile = renderer.root.findByType('article')
    await act(async () => {
      tile.props.onPointerEnter()
    })

    const image = renderer.root.findByType('img')
    expect(image.props.src).toBe('data:image/webp;base64,thumbnail')
    expect(storeMocks.ensureImageCached).not.toHaveBeenCalled()
  })
})
