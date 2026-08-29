/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import { useStore } from '../store'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import DetailModal from './DetailModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  window.localStorage.clear()
})

describe('DetailModal large modal mode', () => {
  it('toggles to 80% size and restores the stored choice', () => {
    const previousTasks = useStore.getState().tasks
    const previousDetailTaskId = useStore.getState().detailTaskId
    const task: TaskRecord = {
      id: 'task-large-modal',
      prompt: '普通画廊任务',
      params: { ...DEFAULT_PARAMS },
      inputImageIds: [],
      outputImages: [],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
    }
    act(() => {
      useStore.setState({ tasks: [task], detailTaskId: task.id })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<DetailModal />)
    })
    expect(renderer.root.findByProps({ role: 'dialog', 'aria-label': '任务详情' }).props.style).toBeUndefined()

    act(() => {
      renderer.root.findByProps({ 'aria-label': '进入 普通任务详情大弹窗模式' }).props.onClick()
    })
    expect(renderer.root.findByProps({ role: 'dialog', 'aria-label': '任务详情' }).props.style).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })

    act(() => renderer.unmount())
    act(() => {
      renderer = create(<DetailModal />)
    })
    expect(renderer.root.findByProps({ 'aria-label': '退出 普通任务详情大弹窗模式' }).props['aria-pressed']).toBe(true)

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ tasks: previousTasks, detailTaskId: previousDetailTaskId })
    })
  })
})
