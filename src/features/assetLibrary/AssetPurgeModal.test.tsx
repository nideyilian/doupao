import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mainStoreMock = vi.hoisted(() => ({
  planPurgeGeneratedAssets: vi.fn(),
  purgeGeneratedAssets: vi.fn(),
  showToast: vi.fn(),
  useStore: { getState: vi.fn(() => ({ showToast: mainStoreMock.showToast })) },
}))

vi.mock('../../store', () => mainStoreMock)

vi.mock('react-dom', () => ({
  createPortal: (node: unknown) => node,
}))

import AssetPurgeModal from './AssetPurgeModal'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import { useAssetLibraryStore } from './store'

const BLOCKED_PLAN = {
  allowedAssetIds: ['a'],
  blocked: [
    {
      assetId: 'b',
      imageId: 'img-b',
      references: [
        { type: 'task-input', ownerId: 'task-1', label: '任务输入（task-1）', blocking: true },
        { type: 'sop-reference', ownerId: 'run-1', label: 'SOP 参考图', blocking: true },
      ],
    },
  ],
  taskOutputCleanups: [],
  imageIdsToDelete: ['img-a'],
  tombstones: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('document', {
    body: { style: {} },
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({
      style: {},
      select: vi.fn(),
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      focus: vi.fn(),
    })),
  })
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: () => void) => {
      callback()
      return 1
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('HTMLElement', class HTMLElementStub {})
  useAssetLibraryStore.setState({
    assetsById: {
      a: normalizeAsset({
        id: 'a',
        imageId: 'img-a',
        status: 'trashed',
        origins: [
          {
            key: 'task-1:0',
            taskId: 'task-1',
            outputSlot: 0,
            taskCreatedAt: 1,
            taskFinishedAt: 1,
            sourceMode: 'gallery',
            prompt: '一只猫',
            inputImageIds: [],
          },
        ],
        primaryOriginKey: 'task-1:0',
      }),
    },
    assetOrder: ['a'],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function findByTestId(renderer: ReactTestRenderer, id: string) {
  return renderer.root.findByProps({ 'data-testid': id })
}

function collectText(renderer: ReactTestRenderer): string {
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      parts.push(node)
      return
    }
    if (node && typeof node === 'object' && 'children' in (node as Record<string, unknown>)) {
      const children = (node as { children?: unknown[] }).children
      if (Array.isArray(children)) children.forEach(visit)
    }
  }
  renderer.root.findAll((node) => {
    const children = (node.children ?? []) as unknown[]
    children.forEach((child) => visit(child))
    return false
  })
  return parts.join(' ')
}

describe('AssetPurgeModal', () => {
  it('previews the purge plan and shows blocked references', async () => {
    mainStoreMock.planPurgeGeneratedAssets.mockResolvedValue(BLOCKED_PLAN)
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetPurgeModal open assetIds={['a', 'b']} onOpenChange={vi.fn()} onExecuted={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mainStoreMock.planPurgeGeneratedAssets).toHaveBeenCalledWith(['a', 'b'])
    const text = collectText(renderer!)
    expect(text).toContain('无法删除')
    expect(text).toContain('任务输入（task-1）')
    expect(text).toContain('SOP 参考图')
    act(() => renderer!.unmount())
  })

  it('executes the purge on confirm and reports blocked leftovers', async () => {
    mainStoreMock.planPurgeGeneratedAssets.mockResolvedValue(BLOCKED_PLAN)
    mainStoreMock.purgeGeneratedAssets.mockResolvedValue({ purged: ['a'], blocked: BLOCKED_PLAN.blocked })
    const onExecuted = vi.fn()
    const onOpenChange = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(
        <AssetPurgeModal open assetIds={['a', 'b']} onOpenChange={onOpenChange} onExecuted={onExecuted} />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      findByTestId(renderer!, 'asset-purge-confirm').props.onClick()
    })
    expect(mainStoreMock.purgeGeneratedAssets).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(onExecuted).toHaveBeenCalledWith({ purged: ['a'], blocked: BLOCKED_PLAN.blocked })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    act(() => renderer!.unmount())
  })

  it('disables the confirm button when every asset is blocked', async () => {
    mainStoreMock.planPurgeGeneratedAssets.mockResolvedValue({
      ...BLOCKED_PLAN,
      allowedAssetIds: [],
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetPurgeModal open assetIds={['b']} onOpenChange={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(findByTestId(renderer!, 'asset-purge-confirm').props.disabled).toBe(true)
    act(() => renderer!.unmount())
  })
})
