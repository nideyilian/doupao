/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { SopLibraryItem } from './types'
import SopPresetPickerModal from './SopPresetPickerModal'

vi.mock('react-dom', () => ({
  createPortal: (node: unknown) => node,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
})

const item: SopLibraryItem = {
  id: 'sop-1',
  name: '商品图 SOP',
  description: '用于商品主图',
  content: '生成商品主图。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function findDialogLayer(renderer: ReturnType<typeof create>) {
  return renderer.root.findAll((node) => {
    return typeof node.props.className === 'string' && node.props.className.includes('ds-dialog-layer')
  })[0]
}

describe('SopPresetPickerModal', () => {
  it('closes only when the backdrop itself is pressed', () => {
    const onOpenChange = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal open items={[item]} groups={[]} onSelect={vi.fn()} onOpenChange={onOpenChange} />,
      )
    })
    mountedRenderers.push(renderer!)

    const layer = findDialogLayer(renderer!)
    const content = {}
    act(() => layer.props.onMouseDown({ target: content, currentTarget: layer }))
    expect(onOpenChange).not.toHaveBeenCalled()

    act(() => layer.props.onMouseDown({ target: layer, currentTarget: layer }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers a clear SOP action and a management entry', () => {
    const onClear = vi.fn()
    const onManage = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          open
          items={[item]}
          groups={[]}
          selectedSopId={item.id}
          onSelect={vi.fn()}
          onClear={onClear}
          onManage={onManage}
          onOpenChange={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const buttons = renderer!.root.findAllByType('button')
    act(() => buttons.find((button) => button.props['aria-pressed'] === false)!.props.onClick())
    act(() => buttons.find((button) => button.props['aria-label'] === '打开 SOP 库')!.props.onClick())

    expect(onClear).toHaveBeenCalledOnce()
    expect(onManage).toHaveBeenCalledOnce()
  })

  it('edits and copies SOP presets inside the picker', () => {
    const onSaveItem = vi.fn()
    const onDuplicateItem = vi.fn(() => 'sop-copy')
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          open
          items={[item]}
          groups={[]}
          onSelect={vi.fn()}
          onSaveItem={onSaveItem}
          onDuplicateItem={onDuplicateItem}
          onOpenChange={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.props['aria-label'] === `复制 ${item.name}`)!
        .props.onClick(),
    )
    expect(onDuplicateItem).toHaveBeenCalledWith(item.id)

    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.props['aria-label'] === `编辑 ${item.name}`)!
        .props.onClick(),
    )
    const nameInput = renderer!.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '编辑后的 SOP' } }))
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))

    expect(onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: '编辑后的 SOP' }))
  })

  it('moves a dragged SOP into the dropped group', () => {
    const onSaveItem = vi.fn()
    const targetGroup = { id: 'group-2', name: '目标分组', createdAt: 1, updatedAt: 1 }
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => item.id) }
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          open
          items={[item]}
          groups={[targetGroup]}
          onSelect={vi.fn()}
          onSaveItem={onSaveItem}
          onOpenChange={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const draggableCard = renderer!.root.findAll((node) => node.props.draggable === true)[0]
    act(() => draggableCard.props.onDragStart({ dataTransfer: transfer }))
    const target = renderer!.root.findAll((node) => node.props['data-sop-drop-group'] === targetGroup.id)[0]
    act(() => target.props.onDrop({ preventDefault: vi.fn(), dataTransfer: transfer }))

    expect(onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, groupId: targetGroup.id }))
  })
})
