import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AppMode, type TaskParams } from '../types'
import { applyWorkspaceEdit, readWorkspaceState, type WorkspaceAccess } from './externalWorkspaceCommand'

interface FakeTab {
  id: string
  name?: string
  prompt?: string
  params?: Partial<TaskParams>
  taskCount?: number
}

/**
 * 假 store：只实现 `WorkspaceAccess`，但**忠实模拟真实 store 的一个关键行为** ——
 * 顶层 `prompt` / `params` 始终镜像「当前活动标签页」的草稿。少了这条，
 * `applyWorkspaceEdit` 的回执就会测不出「写到了哪一页」。
 */
function makeAccess(options: { appMode?: AppMode; activeTabId?: string | null; tabs: FakeTab[] }) {
  const tabs = options.tabs.map((tab) => ({
    id: tab.id,
    name: tab.name ?? `标签页 ${tab.id}`,
    prompt: tab.prompt ?? '',
    params: { ...DEFAULT_PARAMS, ...tab.params } as TaskParams,
    tasks: Array.from({ length: tab.taskCount ?? 0 }, (_, index) => ({ id: `${tab.id}-task-${index}` })),
  }))
  let activeId = options.activeTabId === undefined ? (tabs[0]?.id ?? null) : options.activeTabId
  const activeTab = () => tabs.find((tab) => tab.id === activeId)

  const access: WorkspaceAccess = {
    appMode: options.appMode ?? 'gallery',
    get activeWorkspaceTabId() {
      return activeId
    },
    workspaceTabs: tabs,
    get prompt() {
      return activeTab()?.prompt ?? ''
    },
    get params() {
      return activeTab()?.params ?? DEFAULT_PARAMS
    },
    setActiveWorkspaceTabId: vi.fn((id: string) => {
      activeId = id
    }),
    setPrompt: vi.fn((prompt: string) => {
      const tab = activeTab()
      if (tab) tab.prompt = prompt
    }),
    setParams: vi.fn((patch: Partial<TaskParams>) => {
      const tab = activeTab()
      if (tab) tab.params = { ...tab.params, ...patch }
    }),
  }
  return access
}

describe('readWorkspaceState', () => {
  it('回传模式、活动页与每个标签页的提示词/参数/任务数', () => {
    const access = makeAccess({
      appMode: 'agent',
      tabs: [
        { id: 't1', name: '主图', prompt: '一只猫', taskCount: 2 },
        { id: 't2', name: '副图', prompt: '一只狗', params: { n: 3 } },
      ],
    })

    expect(readWorkspaceState(() => access)).toEqual({
      appMode: 'agent',
      activeTabId: 't1',
      tabs: [
        { id: 't1', name: '主图', prompt: '一只猫', params: DEFAULT_PARAMS, taskCount: 2 },
        { id: 't2', name: '副图', prompt: '一只狗', params: { ...DEFAULT_PARAMS, n: 3 }, taskCount: 0 },
      ],
    })
  })

  it('没有标签页时活动页为 null', () => {
    const access = makeAccess({ activeTabId: null, tabs: [] })
    expect(readWorkspaceState(() => access)).toEqual({ appMode: 'gallery', activeTabId: null, tabs: [] })
  })
})

describe('applyWorkspaceEdit', () => {
  it('setPrompt 写到活动标签页，并回传改动后的状态', () => {
    const access = makeAccess({ tabs: [{ id: 't1', prompt: '旧提示词' }] })

    expect(applyWorkspaceEdit({ action: 'setPrompt', prompt: '新提示词' }, () => access)).toEqual({
      activeTabId: 't1',
      prompt: '新提示词',
      params: DEFAULT_PARAMS,
    })
    expect(access.workspaceTabs[0].prompt).toBe('新提示词')
    expect(access.setActiveWorkspaceTabId).not.toHaveBeenCalled()
  })

  it('setParams 合并到活动标签页，未覆盖的键保持原值', () => {
    const access = makeAccess({ tabs: [{ id: 't1', params: { size: '512x512', n: 1 } }] })

    expect(applyWorkspaceEdit({ action: 'setParams', params: { n: 4 } }, () => access)).toEqual({
      activeTabId: 't1',
      prompt: '',
      params: { ...DEFAULT_PARAMS, size: '512x512', n: 4 },
    })
  })

  it('带 tabId 时先切页再写，改动落在新页而不是原活动页', () => {
    const access = makeAccess({
      tabs: [
        { id: 't1', prompt: '第一页' },
        { id: 't2', prompt: '第二页' },
      ],
    })

    expect(applyWorkspaceEdit({ action: 'setPrompt', prompt: '写到第二页', tabId: 't2' }, () => access)).toEqual({
      activeTabId: 't2',
      prompt: '写到第二页',
      params: DEFAULT_PARAMS,
    })
    expect(access.setActiveWorkspaceTabId).toHaveBeenCalledWith('t2')
    expect(access.workspaceTabs[0].prompt).toBe('第一页')
    expect(access.workspaceTabs[1].prompt).toBe('写到第二页')
  })

  it('tabId 就是当前活动页时不重复切页', () => {
    const access = makeAccess({ tabs: [{ id: 't1' }] })
    applyWorkspaceEdit({ action: 'setPrompt', prompt: 'x', tabId: 't1' }, () => access)
    expect(access.setActiveWorkspaceTabId).not.toHaveBeenCalled()
  })

  it('tabId 不存在时抛错，且一个字都不写', () => {
    const access = makeAccess({ tabs: [{ id: 't1', prompt: '原样' }] })

    expect(() =>
      applyWorkspaceEdit({ action: 'setPrompt', prompt: '不该写进去', tabId: 'nope' }, () => access),
    ).toThrow('tab not found')
    expect(access.workspaceTabs[0].prompt).toBe('原样')
    expect(access.setPrompt).not.toHaveBeenCalled()
    expect(access.setParams).not.toHaveBeenCalled()
  })

  it('缺字段时按空值处理，不写入 undefined', () => {
    const access = makeAccess({ tabs: [{ id: 't1', prompt: '旧' }] })
    applyWorkspaceEdit({ action: 'setPrompt' }, () => access)
    expect(access.workspaceTabs[0].prompt).toBe('')
  })
})
