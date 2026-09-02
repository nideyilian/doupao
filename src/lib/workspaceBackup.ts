import type { TaskRecord, WorkspaceBackupState, WorkspaceBackupTab, WorkspaceTab, WorkspaceTabGroup } from '../types'

export function createWorkspaceBackupState(
  tabs: WorkspaceTab[],
  groups: WorkspaceTabGroup[],
  activeTabId: string | null,
  includeTaskIds: boolean,
): WorkspaceBackupState {
  return {
    tabs: tabs.map((tab): WorkspaceBackupTab => ({
      id: tab.id,
      name: tab.name,
      groupId: tab.groupId,
      prompt: tab.prompt,
      inputImageIds: tab.inputImages.map((image) => image.id),
      inputImageFolder: tab.inputImageFolder
        ? { ...tab.inputImageFolder, imageIds: [...tab.inputImageFolder.imageIds] }
        : null,
      params: { ...tab.params },
      maskDraft: tab.maskDraft ? { ...tab.maskDraft } : null,
      maskEditorImageId: tab.maskEditorImageId,
      customOutputPath: tab.customOutputPath,
      taskIds: includeTaskIds ? tab.tasks.map((task) => task.id) : [],
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
      order: tab.order,
    })),
    groups: groups.map((group) => ({ ...group })),
    activeTabId,
  }
}

export function restoreWorkspaceBackupState(
  snapshot: WorkspaceBackupState,
  tasks: TaskRecord[],
  availableImageIds: ReadonlySet<string>,
): {
  tabs: WorkspaceTab[]
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
} {
  if (!snapshot || !Array.isArray(snapshot.tabs) || !Array.isArray(snapshot.groups)) {
    throw new Error('工作区备份结构无效')
  }

  const groups = snapshot.groups.map((group) => ({ ...group }))
  const groupIds = new Set<string>()
  for (const group of groups) {
    if (groupIds.has(group.id)) throw new Error(`标签分组 ID 重复：${group.id}`)
    groupIds.add(group.id)
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  const claimedTaskIds = new Set<string>()
  const tabIds = new Set<string>()
  const tabs = snapshot.tabs.map((tab): WorkspaceTab => {
    if (tabIds.has(tab.id)) throw new Error(`标签页 ID 重复：${tab.id}`)
    tabIds.add(tab.id)
    if (tab.groupId !== null && !groupIds.has(tab.groupId)) {
      throw new Error(`标签页 ${tab.id} 引用了不存在的标签分组：${tab.groupId}`)
    }
    if (!Array.isArray(tab.taskIds) || !Array.isArray(tab.inputImageIds)) {
      throw new Error(`标签页 ${tab.id} 的引用列表无效`)
    }

    const tabTasks = tab.taskIds.map((taskId) => {
      const task = taskMap.get(taskId)
      if (!task) throw new Error(`标签页 ${tab.id} 引用了不存在的任务：${taskId}`)
      if (claimedTaskIds.has(taskId)) throw new Error(`任务被多个标签页引用：${taskId}`)
      claimedTaskIds.add(taskId)
      return task
    })
    for (const imageId of tab.inputImageIds) {
      if (!availableImageIds.has(imageId)) {
        throw new Error(`标签页 ${tab.id} 引用了不存在的输入图片：${imageId}`)
      }
    }
    for (const imageId of tab.inputImageFolder?.imageIds ?? []) {
      if (!availableImageIds.has(imageId)) {
        throw new Error(`标签页 ${tab.id} 引用了不存在的输入图片：${imageId}`)
      }
    }
    if (tab.maskDraft && !availableImageIds.has(tab.maskDraft.targetImageId)) {
      throw new Error(`标签页 ${tab.id} 引用了不存在的遮罩目标图片：${tab.maskDraft.targetImageId}`)
    }
    if (tab.maskEditorImageId && !availableImageIds.has(tab.maskEditorImageId)) {
      throw new Error(`标签页 ${tab.id} 引用了不存在的遮罩编辑图片：${tab.maskEditorImageId}`)
    }

    return {
      id: tab.id,
      name: tab.name,
      groupId: tab.groupId,
      prompt: tab.prompt,
      inputImages: tab.inputImageIds.map((id) => ({ id, dataUrl: '' })),
      inputImageFolder: tab.inputImageFolder
        ? { ...tab.inputImageFolder, imageIds: [...tab.inputImageFolder.imageIds] }
        : null,
      params: { ...tab.params },
      maskDraft: tab.maskDraft ? { ...tab.maskDraft } : null,
      maskEditorImageId: tab.maskEditorImageId,
      customOutputPath: tab.customOutputPath,
      tasks: tabTasks,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
      order: tab.order,
    }
  })

  if (snapshot.activeTabId !== null && !tabIds.has(snapshot.activeTabId)) {
    throw new Error(`当前标签页不存在：${snapshot.activeTabId}`)
  }

  return {
    tabs,
    groups,
    activeTabId: snapshot.activeTabId,
  }
}
