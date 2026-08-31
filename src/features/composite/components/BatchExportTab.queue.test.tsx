/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from '../lib/compositeV2Defaults'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import { BatchExportTab } from './BatchExportTab'

const dialogMocks = vi.hoisted(() => ({
  openConfirmDialog: vi.fn(),
  openInfoDialog: vi.fn(),
}))
vi.mock('../../../hooks/useAppDialog', () => ({ useAppDialog: () => dialogMocks }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []
/** 未放行的背景读取（可控 Promise），用于把队列泵停在指定任务的读取阶段 */
let pendingReads: Array<(value: unknown) => void> = []

afterEach(async () => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  // 释放可能挂起的后台导出读取，避免队列泵跨测试残留（泵在等待读取时不会产生任何更新）
  pendingReads.splice(0).forEach((resolve) => resolve(null))
  pendingReads = []
  await new Promise((resolve) => setTimeout(resolve, 0))
  useCompositeV2Store.setState(createCompositeV2StoreState())
  dialogMocks.openConfirmDialog.mockClear()
  vi.restoreAllMocks()
  if (typeof window !== 'undefined') {
    delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
  }
})

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function findButtonByText(root: ReactTestInstance, text: string) {
  return root
    .findAll((node: ReactTestInstance) => node.type === 'button')
    .find((node: ReactTestInstance) => getNodeText(node).includes(text))
}

/** 就绪的导出配置：1 个预设（有输出目录）+ 1 个启用尺寸规则 + 2 张背景 */
function setupReadyState() {
  const preset = {
    ...createDefaultCompositeV2Preset(1),
    id: 'preset-a',
    name: 'Preset A',
    outputRootPath: 'D:/exports/a',
  }
  const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [preset.id] }
  const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
  outputRuleGroups[0]!.rules[0]!.enabled = true
  useCompositeV2Store.setState({
    presets: [preset],
    presetGroups: [group],
    outputRuleGroups,
    selectedPresetGroupId: group.id,
    selectedPreviewPresetId: preset.id,
    enabledPresetIdsForRun: [preset.id],
    backgroundFolders: ['D:/backgrounds'],
    backgrounds: [
      { path: 'D:/backgrounds/a.jpg', name: 'a.jpg', relativeDir: '', width: 1280, height: 720 },
      { path: 'D:/backgrounds/b.jpg', name: 'b.jpg', relativeDir: '', width: 1280, height: 720 },
    ],
    previewHistory: ['D:/backgrounds/a.jpg'],
    previewHistoryIndex: 0,
  })
}

/** 挂起式背景读取 mock：每次读取推入 pendingReads，由测试放行 */
function mountWithPendingReads() {
  const readImageFile = vi.fn(
    () =>
      new Promise((resolve) => {
        pendingReads.push(resolve)
      }),
  )
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { isElectron: true, readImageFile },
  })
}

async function mountBatchExportTab() {
  let renderer: ReturnType<typeof create>
  await act(async () => {
    renderer = create(<BatchExportTab />)
  })
  mountedRenderers.push(renderer!)
  return renderer!
}

/** 在 act 内完成点击并冲刷一轮宏任务：队列泵的全部更新都落在 act 窗口内 */
async function clickAndFlush(renderer: ReactTestInstance, buttonText: string) {
  await act(async () => {
    await findButtonByText(renderer, buttonText)?.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 在 act 内放行当前挂起的背景读取，让队列泵继续推进 */
async function resolveReadsAndFlush() {
  await act(async () => {
    pendingReads.splice(0).forEach((resolve) => resolve(null))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('BatchExportTab 后台导出队列', () => {
  it('导出进行中可再次发送：任务进入队列，按发送时刻的快照顺序执行完毕后写入历史', async () => {
    mountWithPendingReads()
    setupReadyState()
    const renderer = await mountBatchExportTab()

    // 第一次发送：任务立即开始后台执行（面板槽位同步激活为当前任务）
    await clickAndFlush(renderer.root, '开始导出')
    expect(useCompositeV2Store.getState().exportStatus).toBe('running')
    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'running')).toHaveLength(1)
    expect(useCompositeV2Store.getState().exportTasks).toHaveLength(2)

    // 修改配置后执行中再次发送：新任务按发送时刻的配置入队，不影响已发送/执行中的任务
    await act(async () => {
      useCompositeV2Store.getState().setCustomValue('batch-2')
    })
    await clickAndFlush(renderer.root, '加入导出队列')
    const [first, second] = useCompositeV2Store.getState().exportQueue
    expect(first!.snapshot.custom).toBe('')
    expect(second!.snapshot.custom).toBe('batch-2')
    expect(second!.status).toBe('queued')
    expect(getNodeText(renderer.root)).toContain('后台队列：1 个任务待导出')

    // 放行第一个任务的读取 → 第一个任务完成，泵自动开始第二个任务
    await resolveReadsAndFlush()
    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'running')).toHaveLength(1)
    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'queued')).toHaveLength(0)
    expect(useCompositeV2Store.getState().exportStatus).toBe('running')

    // 放行第二个任务的读取 → 全部完成，历史各记一笔
    await resolveReadsAndFlush()
    expect(useCompositeV2Store.getState().exportQueue).toHaveLength(0)
    expect(useCompositeV2Store.getState().history).toHaveLength(2)
    expect(useCompositeV2Store.getState().history.every((record) => record.failureCount === 2)).toBe(true)
    // 历史按时间倒序：后发送的任务排在前
    expect(useCompositeV2Store.getState().history[0]!.startedAt).toBeGreaterThanOrEqual(
      useCompositeV2Store.getState().history[1]!.startedAt,
    )
    // 面板槽位展示最后一个任务的最终状态
    expect(useCompositeV2Store.getState().exportStatus).toBe('completed')
    expect(useCompositeV2Store.getState().exportCompleted).toBe(2)
    expect(useCompositeV2Store.getState().exportTotal).toBe(2)
    expect(useCompositeV2Store.getState().exportFailures).toHaveLength(2)
  })

  it('取消排队只移除未开始的任务，正在执行的任务不受影响', async () => {
    mountWithPendingReads()
    setupReadyState()
    const renderer = await mountBatchExportTab()

    // 发送两个任务：第一个执行中，第二个排队
    await clickAndFlush(renderer.root, '开始导出')
    await clickAndFlush(renderer.root, '加入导出队列')
    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'queued')).toHaveLength(1)

    // 点击「取消排队」→ 确认后仅移除排队任务
    await act(async () => {
      await findButtonByText(renderer.root, '取消排队')?.props.onClick()
    })
    expect(dialogMocks.openConfirmDialog).toHaveBeenCalledTimes(1)
    const dialogOptions = dialogMocks.openConfirmDialog.mock.calls[0]![0] as { action?: () => void }
    act(() => {
      dialogOptions.action?.()
    })

    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'queued')).toHaveLength(0)
    expect(useCompositeV2Store.getState().exportQueue.filter((entry) => entry.status === 'running')).toHaveLength(1)
    expect(useCompositeV2Store.getState().exportStatus).toBe('running')

    // 放行执行中任务的读取 → 正常完成并写入历史
    await resolveReadsAndFlush()
    expect(useCompositeV2Store.getState().exportQueue).toHaveLength(0)
    expect(useCompositeV2Store.getState().history).toHaveLength(1)
  })
})
