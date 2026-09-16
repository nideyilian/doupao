import type { AppMode, ExternalAssetCommand, TaskParams } from '../types'

/** 一个工作区标签页对外暴露的只读视图。 */
export interface WorkspaceTabView {
  id: string
  name: string
  prompt: string
  params: TaskParams
  taskCount: number
}

/** `getAppState` 的返回体：外部 agent 据此知道当前在哪个模式、哪一页、写了什么。 */
export interface WorkspaceSnapshot {
  appMode: AppMode
  activeTabId: string | null
  tabs: WorkspaceTabView[]
}

/**
 * 外部命令能触碰的最小工作区接口。
 *
 * 刻意用结构化类型而不是直接引用 `AppState`：单测只需塞一个几十行的假 store，
 * 不必构造整个应用状态；同时把「外部命令到底能碰到什么」显式钉在这里，
 * 以后想扩大权限范围必须改这个接口，不会悄悄发生。
 */
export interface WorkspaceAccess {
  appMode: AppMode
  activeWorkspaceTabId: string | null
  workspaceTabs: Array<{ id: string; name: string; prompt: string; params: TaskParams; tasks: unknown[] }>
  prompt: string
  params: TaskParams
  setActiveWorkspaceTabId: (id: string) => void
  setPrompt: (prompt: string) => void
  setParams: (params: Partial<TaskParams>) => void
}

/** 写操作之后的回执：agent 需要看到改动真的落到了哪一页、落成了什么。 */
export interface WorkspaceEditResult {
  activeTabId: string | null
  prompt: string
  params: TaskParams
}

export function readWorkspaceState(getState: () => WorkspaceAccess): WorkspaceSnapshot {
  const state = getState()
  return {
    appMode: state.appMode,
    activeTabId: state.activeWorkspaceTabId,
    tabs: state.workspaceTabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      prompt: tab.prompt,
      params: tab.params,
      taskCount: tab.tasks.length,
    })),
  }
}

/**
 * 执行 `setPrompt` / `setParams`。
 *
 * 写入一律作用于「当前活动标签页」；带 `tabId` 时先切过去 —— 这样用户能直接看见
 * 改动落在哪一页，而不是被静默写到某个后台标签页里。切页失败（标签页不存在）时
 * 抛错并**不做任何写入**，避免改错地方。
 */
export function applyWorkspaceEdit(
  command: ExternalAssetCommand,
  getState: () => WorkspaceAccess,
): WorkspaceEditResult {
  const before = getState()
  if (command.tabId && command.tabId !== before.activeWorkspaceTabId) {
    if (!before.workspaceTabs.some((tab) => tab.id === command.tabId)) throw new Error('tab not found')
    before.setActiveWorkspaceTabId(command.tabId)
  }
  const target = getState()
  if (command.action === 'setPrompt') target.setPrompt(command.prompt ?? '')
  else target.setParams(command.params ?? {})
  const after = getState()
  return { activeTabId: after.activeWorkspaceTabId, prompt: after.prompt, params: after.params }
}
