import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord, WorkspaceBackupState, WorkspaceTab, WorkspaceTabGroup } from '../types'
import { createWorkspaceBackupState, restoreWorkspaceBackupState } from './workspaceBackup'

function task(id: string): TaskRecord {
  return {
    id,
    prompt: id,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

function tab(
  id: string,
  tasks: TaskRecord[],
  groupId: string | null = null,
  inputImageIds: string[] = [],
): WorkspaceTab {
  return {
    id,
    name: id,
    groupId,
    prompt: `prompt-${id}`,
    inputImages: inputImageIds.map((imageId) => ({ id: imageId, dataUrl: '' })),
    inputImageFolder: null,
    params: { ...DEFAULT_PARAMS },
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 1,
    updatedAt: 2,
    order: 0,
  }
}

const taskA = task('task-a')
const taskB = task('task-b')
const groupA: WorkspaceTabGroup = {
  id: 'group-a',
  name: '分组 A',
  order: 0,
  collapsed: false,
}

function validSnapshot(): WorkspaceBackupState {
  return createWorkspaceBackupState(
    [tab('tab-a', [taskA], groupA.id, ['input-a']), tab('tab-b', [taskB], null, ['input-b']), tab('tab-empty', [])],
    [groupA],
    'tab-b',
    true,
  )
}

describe('workspace backup snapshots', () => {
  it('serializes and hydrates tab task ownership without duplicating tasks', () => {
    const snapshot = validSnapshot()

    expect(snapshot.tabs.map(({ id, taskIds }) => ({ id, taskIds }))).toEqual([
      { id: 'tab-a', taskIds: ['task-a'] },
      { id: 'tab-b', taskIds: ['task-b'] },
      { id: 'tab-empty', taskIds: [] },
    ])

    expect(restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toMatchObject({
      activeTabId: 'tab-b',
      groups: [groupA],
      tabs: [
        { id: 'tab-a', tasks: [taskA], inputImages: [{ id: 'input-a', dataUrl: '' }] },
        { id: 'tab-b', tasks: [taskB], inputImages: [{ id: 'input-b', dataUrl: '' }] },
        { id: 'tab-empty', tasks: [] },
      ],
    })
  })

  it('omits task ownership from config-only snapshots', () => {
    const snapshot = createWorkspaceBackupState([tab('tab-a', [taskA])], [], 'tab-a', false)

    expect(snapshot.tabs[0]?.taskIds).toEqual([])
  })

  it('rejects duplicate tab IDs', () => {
    const snapshot = validSnapshot()
    snapshot.tabs[1] = { ...snapshot.tabs[1]!, id: snapshot.tabs[0]!.id }

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toThrow(
      '标签页 ID 重复',
    )
  })

  it('rejects a tab that references a missing group', () => {
    const snapshot = validSnapshot()
    snapshot.tabs[0] = { ...snapshot.tabs[0]!, groupId: 'missing-group' }

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toThrow(
      '不存在的标签分组',
    )
  })

  it('rejects a tab that references a missing task', () => {
    const snapshot = validSnapshot()
    snapshot.tabs[0] = { ...snapshot.tabs[0]!, taskIds: ['missing-task'] }

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toThrow(
      '不存在的任务',
    )
  })

  it('rejects a task owned by more than one tab', () => {
    const snapshot = validSnapshot()
    snapshot.tabs[1] = { ...snapshot.tabs[1]!, taskIds: ['task-a'] }

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toThrow(
      '任务被多个标签页引用',
    )
  })

  it('rejects an invalid active tab', () => {
    const snapshot = { ...validSnapshot(), activeTabId: 'missing-tab' }

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-a', 'input-b']))).toThrow(
      '当前标签页不存在',
    )
  })

  it('rejects a missing input image', () => {
    const snapshot = validSnapshot()

    expect(() => restoreWorkspaceBackupState(snapshot, [taskA, taskB], new Set(['input-b']))).toThrow(
      '不存在的输入图片',
    )
  })
})
