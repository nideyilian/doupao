import { beforeEach, describe, expect, it } from 'vitest'
import { useRuntimeStore } from './runtimeStore'

describe('runtimeStore', () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      streamPreviews: {},
      streamPreviewSlots: {},
      agentStreamingTexts: {},
    })
  })

  it('tracks stream previews outside the durable application store', () => {
    const runtime = useRuntimeStore.getState()
    runtime.setTaskStreamPreview('task-a', 'preview-a', 1)

    expect(useRuntimeStore.getState().streamPreviews).toEqual({ 'task-a': 'preview-a' })
    expect(useRuntimeStore.getState().streamPreviewSlots).toEqual({ 'task-a': { '1': 'preview-a' } })

    useRuntimeStore.getState().setTaskStreamPreview('task-a')
    expect(useRuntimeStore.getState().streamPreviews).toEqual({})
    expect(useRuntimeStore.getState().streamPreviewSlots).toEqual({})
  })

  it('clears one or all buffered Agent messages for a conversation', () => {
    const runtime = useRuntimeStore.getState()
    runtime.setAgentStreamingText('conversation-a', 'message-a', 'first')
    runtime.setAgentStreamingText('conversation-a', 'message-b', 'second')
    runtime.setAgentStreamingText('conversation-b', 'message-a', 'other')

    runtime.clearAgentStreamingText('conversation-a', 'message-a')
    expect(useRuntimeStore.getState().agentStreamingTexts).toEqual({
      'conversation-a:message-b': 'second',
      'conversation-b:message-a': 'other',
    })

    useRuntimeStore.getState().clearAgentStreamingText('conversation-a')
    expect(useRuntimeStore.getState().agentStreamingTexts).toEqual({
      'conversation-b:message-a': 'other',
    })
  })
})
