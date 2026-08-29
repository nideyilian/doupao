/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { createCompositeV2StoreState, useCompositeV2Store } from './storeV2'
import { ExportStatusWatcher } from './ExportStatusWatcher'
import type { CompositeV2DistributionSuccessItem, CompositeV2SuccessItem } from './lib/compositeV2Types'

const mainStoreMock = vi.hoisted(() => {
  const state = { postprocessDialogOpen: false }
  const showToast = vi.fn()
  const useStore = Object.assign((selector: (s: { postprocessDialogOpen: boolean }) => unknown) => selector(state), {
    getState: () => ({ showToast }),
  })
  return { useStore, showToast, state }
})

vi.mock('../../store', () => mainStoreMock)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

function successItem(path: string): CompositeV2SuccessItem {
  return { path, presetId: 'p1', presetName: '预设A', channel: '横版', size: '16:9', index: 0 }
}

function distributionSuccessItem(path: string): CompositeV2DistributionSuccessItem {
  return { originalPath: `o-${path}`, targetPath: path }
}

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  mainStoreMock.showToast.mockClear()
  mainStoreMock.state.postprocessDialogOpen = false
})

function renderWatcher() {
  let renderer: ReturnType<typeof create>
  act(() => {
    renderer = create(<ExportStatusWatcher />)
  })
  mountedRenderers.push(renderer!)
  return renderer!
}

describe('ExportStatusWatcher', () => {
  it('弹窗关闭时：导出完成弹出成功 toast', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running', exportCompleted: 0, exportTotal: 2 })
    })
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'completed',
        exportCompleted: 2,
        exportTotal: 2,
        exportSuccesses: [successItem('out/a.jpg')],
        exportFailures: [],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
    expect(mainStoreMock.showToast).toHaveBeenCalledWith('后期处理完成：1 成功，0 失败。', 'success')
  })

  it('部分失败时以 error 类型提示', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'completed',
        exportSuccesses: [successItem('out/a.jpg')],
        exportFailures: [
          {
            backgroundPath: 'bg/b.jpg',
            presetId: 'p1',
            presetName: '预设A',
            channel: '横版',
            size: '16:9',
            reason: '写入失败',
          },
        ],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledWith('后期处理完成：1 成功，1 失败。', 'error')
  })

  it('整体运行失败（failed）时以 error 类型提示', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'failed',
        exportSuccesses: [successItem('out/a.jpg')],
        exportFailures: [
          {
            backgroundPath: 'bg/b.jpg',
            presetId: 'p1',
            presetName: '预设A',
            channel: '横版',
            size: '16:9',
            reason: '渲染异常',
          },
        ],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledWith('后期处理失败：1 成功，1 失败。', 'error')
  })

  it('取消时提示已取消', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'canceling' })
    })
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'canceled', exportSuccesses: [successItem('out/a.jpg')] })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledWith('后期处理已取消：已完成 1 张。', 'info')
  })

  it('含分配时：导出完成后等待分配落定再汇总提示', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'completed',
        exportSuccesses: [successItem('out/a.jpg')],
        distributionStatus: 'running',
        distributionCompleted: 0,
        distributionTotal: 1,
      })
    })
    // 分配仍在运行：不提前提示
    expect(mainStoreMock.showToast).not.toHaveBeenCalled()
    act(() => {
      useCompositeV2Store.setState({
        distributionStatus: 'completed',
        distributionCompleted: 1,
        distributionTotal: 1,
        distributionSuccesses: [distributionSuccessItem('dist/a.jpg')],
        distributionFailures: [],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
    expect(mainStoreMock.showToast).toHaveBeenCalledWith(
      '后期处理完成：1 成功，0 失败。 分配：1 成功，0 失败。',
      'success',
    )
  })

  it('弹窗打开时：不弹 toast（界面内已有结果展示）', () => {
    mainStoreMock.state.postprocessDialogOpen = true
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'completed', exportSuccesses: [successItem('out/a.jpg')] })
    })
    expect(mainStoreMock.showToast).not.toHaveBeenCalled()
  })

  it('同一轮结算不重复提示（弹窗开合等状态变化不触发）', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'completed', exportSuccesses: [successItem('out/a.jpg')] })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
    // 完成后打开弹窗、再关闭：不再提示
    act(() => {
      mainStoreMock.state.postprocessDialogOpen = true
      useCompositeV2Store.setState({ exportCompleted: 1, exportTotal: 1 })
    })
    act(() => {
      mainStoreMock.state.postprocessDialogOpen = false
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
  })

  it('新一轮导出结算时再次提示', () => {
    renderWatcher()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'completed', exportSuccesses: [successItem('out/a.jpg')] })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running' })
    })
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'completed',
        exportSuccesses: [successItem('out/a.jpg'), successItem('out/b.jpg')],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(2)
    expect(mainStoreMock.showToast).toHaveBeenLastCalledWith('后期处理完成：2 成功，0 失败。', 'success')
  })

  it('挂载时已处于终态（热更新场景）不误报', () => {
    useCompositeV2Store.setState({ exportStatus: 'completed', exportCompleted: 2, exportTotal: 2 })
    renderWatcher()
    expect(mainStoreMock.showToast).not.toHaveBeenCalled()
  })

  it('挂载时正在运行：结算时仍提示', () => {
    useCompositeV2Store.setState({ exportStatus: 'running', exportCompleted: 1, exportTotal: 2 })
    renderWatcher()
    expect(mainStoreMock.showToast).not.toHaveBeenCalled()
    act(() => {
      useCompositeV2Store.setState({
        exportStatus: 'completed',
        exportCompleted: 2,
        exportTotal: 2,
        exportSuccesses: [successItem('out/a.jpg')],
      })
    })
    expect(mainStoreMock.showToast).toHaveBeenCalledTimes(1)
  })
})
