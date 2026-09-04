import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  type GeneratedAsset,
  type GeneratedAssetOrigin,
  type SopBatchSnapshot,
  type TaskRecord,
} from '../types'
import {
  buildAssetBatchGroups,
  buildAssetBatchOverview,
  getPrimaryOrigin,
  hasTaskFailure,
  truncatePrompt,
} from './assetBatchGrouping'

function makeOrigin(taskId: string, outputSlot: number, prompt = '一只猫'): GeneratedAssetOrigin {
  return {
    key: `${taskId}:${outputSlot}`,
    taskId,
    outputSlot,
    taskCreatedAt: 1000,
    taskFinishedAt: 2000,
    sourceMode: 'gallery',
    prompt,
    requestedParams: DEFAULT_PARAMS,
    inputImageIds: [],
  }
}

function makeAsset(id: string, origin: GeneratedAssetOrigin, createdAt = 1000): GeneratedAsset {
  return {
    id,
    imageId: id,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [origin],
    primaryOriginKey: origin.key,
    parentAssetIds: [],
    metadataVersion: 1,
  }
}

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: `提示词 ${id}`,
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...overrides,
  }
}

const snapshot: SopBatchSnapshot = {
  id: 'snap-1',
  batchId: 'batch-1',
  title: '品牌海报合集',
  tags: ['海报', '新品'],
  promptGroup: { id: 'folder-1', name: '品牌 > 海报' },
  sop: { id: 'sop-1', name: 'SOP 海报', description: '', content: '' },
  brief: '',
  referenceImageIds: [],
  promptCount: 2,
  imagesPerPrompt: 1,
  prompts: [],
  params: DEFAULT_PARAMS,
  workspaceTabId: null,
  createdAt: 1000,
  status: 'ready',
}

describe('buildAssetBatchGroups', () => {
  it('groups assets by SOP batch and passes through snapshot promptGroup', () => {
    const taskA = makeTask('t1', {
      sopBatch: {
        batchId: 'batch-1',
        snapshotId: 'snap-1',
        sopId: 'sop-1',
        sopName: 'SOP 海报',
        promptIndex: 0,
        promptCount: 2,
      },
    })
    const taskB = makeTask('t2', {
      sopBatch: {
        batchId: 'batch-1',
        snapshotId: 'snap-1',
        sopId: 'sop-1',
        sopName: 'SOP 海报',
        promptIndex: 1,
        promptCount: 2,
      },
    })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-b', makeOrigin('t2', 0), 2000), makeAsset('img-a', makeOrigin('t1', 0), 1000)],
      new Map([
        ['t1', taskA],
        ['t2', taskB],
      ]),
      new Map([['snap-1', snapshot]]),
    )

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.kind).toBe('sop-batch')
    expect(group?.title).toBe('品牌海报合集')
    expect(group?.promptGroup).toEqual({ id: 'folder-1', name: '品牌 > 海报' })
    expect(group?.snapshotTitle).toBe('品牌海报合集')
    expect(group?.taskIds).toEqual(['t1', 't2'])
    expect(group?.assets.map((asset) => asset.id)).toEqual(['img-a', 'img-b'])
    expect(group?.summary).toEqual({ total: 2, running: 0, completed: 2, failed: 0 })
  })

  it('keeps orphan assets grouped by their origin task id when the task is deleted', () => {
    const groups = buildAssetBatchGroups(
      [
        makeAsset('img-1', makeOrigin('gone-task', 0, '已删除任务的提示词')),
        makeAsset('img-2', makeOrigin('gone-task', 1, '已删除任务的提示词')),
      ],
      new Map(),
      new Map(),
    )

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.kind).toBe('orphan')
    expect(group?.title).toContain('已删除任务的提示词')
    expect(group?.task).toBeNull()
    expect(group?.taskIds).toEqual([])
    expect(group?.assets.map((asset) => asset.id)).toEqual(['img-1', 'img-2'])
  })

  it('groups regular tasks separately from batches and sorts newest first', () => {
    const plainTask = makeTask('t3', { createdAt: 3000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-x', makeOrigin('t3', 0), 3000)],
      new Map([['t3', plainTask]]),
      new Map(),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('task')
    expect(groups[0]?.taskIds).toEqual(['t3'])
    expect(groups[0]?.title).toContain('提示词 t3')
  })

  it('falls back to SOP name when no snapshot and no prompt is available', () => {
    const task = makeTask('t4', {
      sopBatch: { batchId: 'batch-9', sopId: 'sop-9', sopName: '秋季上新', promptIndex: 0, promptCount: 1 },
    })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-y', makeOrigin('t4', 0, ''))],
      new Map([['t4', task]]),
      new Map(),
    )
    expect(groups[0]?.title).toBe('秋季上新')
  })

  it('sorts groups by task submission time (position fixed at creation)', () => {
    const taskOld = makeTask('t-old')
    const taskNew = makeTask('t-new', { createdAt: 9000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-new', makeOrigin('t-new', 0), 9000), makeAsset('img-old', makeOrigin('t-old', 0), 1000)],
      new Map([
        ['t-old', taskOld],
        ['t-new', taskNew],
      ]),
      new Map(),
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-new', 'task:t-old'])
  })

  it('keeps card position fixed at submission time even when assets finish later (no reorder by progress)', () => {
    // 任务 A 先提交（t=1000）但生成慢、素材完成时间晚（9000）；任务 B 后提交（t=8000）、素材 8000。
    // 位置应在创建（提交）时确定：B 在上、A 在下，不能因为 A 的素材晚生成而把 A 顶到 B 前面。
    const taskA = makeTask('t-a', { createdAt: 1000 })
    const taskB = makeTask('t-b', { createdAt: 8000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-a', makeOrigin('t-a', 0), 9000), makeAsset('img-b', makeOrigin('t-b', 0), 8000)],
      new Map([
        ['t-a', taskA],
        ['t-b', taskB],
      ]),
      new Map(),
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-b', 'task:t-a'])
    // 组时间徽章显示任务提交时间而不是素材生成时间
    expect(groups.map((group) => group.createdAt)).toEqual([8000, 1000])
  })

  it('pins a just-submitted running task at the top by submission time (0.7.56 新任务置顶)', () => {
    // 回归：生成中的任务没有素材，组 createdAt 若为 0 会沉到所有有图任务下方，
    // 结束后（成功/部分失败）又因素材时间跳到最上方 → 卡片位置跳动。
    const olderDone = makeTask('t-done', { createdAt: 1000 })
    const freshRunning = makeTask('t-running', { status: 'running', createdAt: 9000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-old', makeOrigin('t-done', 0), 2000)],
      new Map([
        ['t-done', olderDone],
        ['t-running', freshRunning],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-running', 'task:t-done'])
    // 运行中卡片的时间徽章显示任务提交时间，而不是 1970 年
    expect(groups[0]?.createdAt).toBe(9000)
  })

  it('uses task submission time as the sort baseline for failed taskless groups', () => {
    const failedOld = makeTask('t-failed-old', { status: 'error', error: 'x', createdAt: 1000 })
    const failedNew = makeTask('t-failed-new', { status: 'error', error: 'x', createdAt: 8000 })
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-failed-old', failedOld],
        ['t-failed-new', failedNew],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-failed-new', 'task:t-failed-old'])
    expect(groups.map((group) => group.createdAt)).toEqual([8000, 1000])
  })

  it('keeps failed task cards even when the includeTaskless predicate rejects them (failure overrides scope)', () => {
    // 用户要求：失败任务卡在任何作用域（含素材专属作用域）都保留，不能因切换文件夹/筛选消失。
    // 模拟 AssetBatchView 的 includeTaskless：素材专属作用域下失败任务仍放行。
    const failed = makeTask('t-failed', { status: 'error', error: '服务商超时' })
    const running = makeTask('t-running', { status: 'running' })
    const scopeRejectAllExceptFailure = (task: TaskRecord) => task.status === 'error'
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-failed', failed],
        ['t-running', running],
      ]),
      new Map(),
      { includeTaskless: scopeRejectAllExceptFailure },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-failed'])
  })

  it('keeps partially failed task cards when their assets were cleaned up (done + batchItemErrors)', () => {
    // 部分失败任务 status=done 但含失败槽位：素材被清理后任务卡仍应保留（hasTaskFailure 放行）。
    const partialFailed = makeTask('t-partial', {
      status: 'done',
      outputImages: [],
      batchItemStatuses: ['done', 'error'],
      batchItemErrors: [{ index: 1, error: '第二张失败' }],
    })
    const groups = buildAssetBatchGroups([], new Map([['t-partial', partialFailed]]), new Map(), {
      includeTaskless: () => true,
    })
    expect(groups.map((group) => group.id)).toEqual(['task:t-partial'])
    expect(groups[0]?.summary.failed).toBe(0) // status=done → 计为 completed
  })

  it('drops truly completed taskless tasks (done without failure) as historical empty tasks', () => {
    const doneEmpty = makeTask('t-done', { status: 'done', outputImages: [] })
    const groups = buildAssetBatchGroups([], new Map([['t-done', doneEmpty]]), new Map(), {
      includeTaskless: () => true,
    })
    expect(groups).toEqual([])
  })
})

describe('hasTaskFailure', () => {
  it('detects fully failed and partially failed tasks', () => {
    expect(hasTaskFailure(makeTask('a', { status: 'error', error: 'x' }))).toBe(true)
    expect(
      hasTaskFailure(
        makeTask('b', {
          status: 'done',
          batchItemStatuses: ['done', 'error'],
          batchItemErrors: [{ index: 1, error: 'x' }],
        }),
      ),
    ).toBe(true)
    expect(hasTaskFailure(makeTask('c', { status: 'done' }))).toBe(false)
    expect(hasTaskFailure(makeTask('d', { status: 'running' }))).toBe(false)
    expect(hasTaskFailure(makeTask('e', { status: 'done', batchItemStatuses: ['done', 'done'] }))).toBe(false)
    expect(
      hasTaskFailure(
        makeTask('f', {
          status: 'error',
          error: '缩略图加载超时',
          params: { ...makeTask('base').params, n: 1 },
          outputImages: ['img-ok'],
        }),
      ),
    ).toBe(false)
  })
})

describe('buildAssetBatchOverview', () => {
  it('aggregates group/task/asset counts and task statuses', () => {
    const taskDone = makeTask('t1')
    const taskRunning = makeTask('t2', { status: 'running' })
    const taskFailed = makeTask('t3', { status: 'error' })
    const groups = buildAssetBatchGroups(
      [
        makeAsset('img-1', makeOrigin('t1', 0)),
        makeAsset('img-2', makeOrigin('t2', 0)),
        makeAsset('img-3', makeOrigin('t3', 0)),
        makeAsset('img-4', makeOrigin('gone', 0)),
      ],
      new Map([
        ['t1', taskDone],
        ['t2', taskRunning],
        ['t3', taskFailed],
      ]),
      new Map(),
    )
    const overview = buildAssetBatchOverview(
      groups,
      new Map([
        ['t1', taskDone],
        ['t2', taskRunning],
        ['t3', taskFailed],
      ]),
    )
    expect(overview.groupCount).toBe(4) // 3 个任务组 + 1 个孤儿组
    expect(overview.taskCount).toBe(3) // 孤儿组不占任务数
    expect(overview.assetCount).toBe(4)
    expect(overview.completed).toBe(1)
    expect(overview.running).toBe(1)
    expect(overview.failed).toBe(1)
  })

  it('includes active tasks without assets so running/failed tasks stay visible', () => {
    const taskRunning = makeTask('t-running', { status: 'running' })
    const taskFailed = makeTask('t-failed', { status: 'error', error: '服务商超时' })
    const taskStopped = makeTask('t-stopped', { status: 'error', error: '任务已停止' })
    const taskDone = makeTask('t-done', { status: 'done' })
    // t-running/t-failed 无素材（提交后/失败后没有产出），t-done 也无素材（历史空任务不补）
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-running', taskRunning],
        ['t-failed', taskFailed],
        ['t-stopped', taskStopped],
        ['t-done', taskDone],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )

    const ids = groups.map((group) => group.id)
    expect(ids).toContain('task:t-running')
    expect(ids).toContain('task:t-failed')
    expect(ids).toContain('task:t-stopped')
    expect(ids).not.toContain('task:t-done')
    const failedGroup = groups.find((group) => group.id === 'task:t-failed')!
    expect(failedGroup.assets).toEqual([])
    expect(failedGroup.task?.error).toBe('服务商超时')
  })

  it('applies the includeTaskless predicate (project scope only includes its own tasks)', () => {
    const taskInProject = makeTask('t-in', { status: 'running', defaultCollectionId: 'col-a' })
    const taskElsewhere = makeTask('t-out', { status: 'running', defaultCollectionId: 'col-b' })
    const taskNone = makeTask('t-none', { status: 'running' })
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-in', taskInProject],
        ['t-out', taskElsewhere],
        ['t-none', taskNone],
      ]),
      new Map(),
      { includeTaskless: (task) => task.defaultCollectionId === 'col-a' },
    )
    const ids = groups.map((group) => group.id)
    expect(ids).toContain('task:t-in')
    expect(ids).not.toContain('task:t-out')
    expect(ids).not.toContain('task:t-none')
  })

  it('keeps the default (no options) behavior without adding taskless tasks', () => {
    const taskRunning = makeTask('t-running', { status: 'running' })
    const groups = buildAssetBatchGroups([], new Map([['t-running', taskRunning]]), new Map())
    expect(groups).toEqual([])
  })
})

describe('getPrimaryOrigin', () => {
  it('prefers the primary origin key and falls back to the first origin', () => {
    const primary = makeOrigin('t1', 0, '主来源')
    const secondary = makeOrigin('t2', 0, '次来源')
    const asset = { ...makeAsset('a', secondary), primaryOriginKey: primary.key, origins: [secondary, primary] }
    expect(getPrimaryOrigin(asset)?.prompt).toBe('主来源')
    expect(getPrimaryOrigin({ ...asset, primaryOriginKey: null })?.prompt).toBe('次来源')
  })
})

describe('truncatePrompt', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(truncatePrompt('  高  清   猫  ')).toBe('高 清 猫')
    const long = 'x'.repeat(120)
    expect(truncatePrompt(long)).toBe(`${'x'.repeat(80)}…`)
  })
})
