import { describe, expect, it } from 'vitest'
import {
  clearSopAiRevisionJob,
  clearSopAiRevisionThread,
  createSopAiRevisionMessage,
  getSopAiRevisionJobState,
  loadSopAiRevisionThread,
  saveSopAiRevisionThread,
  startSopAiRevisionJob,
} from './sopAiRevision'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('SOP AI revision thread storage', () => {
  it('keeps independent persistent histories for each SOP', () => {
    const storage = createStorage()
    const firstMessage = createSopAiRevisionMessage('user', '优化步骤')
    const secondMessage = createSopAiRevisionMessage('assistant', '已补充验收标准', {
      content: '# SOP\n\n1. 执行\n2. 验收',
      changeSummary: ['补充验收标准'],
    })

    saveSopAiRevisionThread('sop-a', [firstMessage, secondMessage], storage)

    expect(loadSopAiRevisionThread('sop-a', storage).messages).toEqual([firstMessage, secondMessage])
    expect(loadSopAiRevisionThread('sop-b', storage).messages).toEqual([])
  })

  it('limits stored context and clears only the requested SOP', () => {
    const storage = createStorage()
    const messages = Array.from({ length: 36 }, (_, index) => createSopAiRevisionMessage('user', `修改 ${index}`))
    saveSopAiRevisionThread('sop-a', messages, storage)
    saveSopAiRevisionThread('sop-b', [createSopAiRevisionMessage('user', '保留')], storage)

    expect(loadSopAiRevisionThread('sop-a', storage).messages).toHaveLength(30)
    expect(loadSopAiRevisionThread('sop-a', storage).messages[0].text).toBe('修改 6')

    clearSopAiRevisionThread('sop-a', storage)
    expect(loadSopAiRevisionThread('sop-a', storage).messages).toEqual([])
    expect(loadSopAiRevisionThread('sop-b', storage).messages).toHaveLength(1)
  })

  it('finishes and persists a revision after the conversation UI closes', async () => {
    const storage = createStorage()
    const request = createSopAiRevisionMessage('user', '生成新版')
    saveSopAiRevisionThread('sop-a', [request], storage)
    let finish!: (value: { reply: string; content: string; changeSummary: string[] }) => void

    const job = startSopAiRevisionJob(
      'sop-a',
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      storage,
    )

    expect(getSopAiRevisionJobState('sop-a').status).toBe('running')
    finish({ reply: '新版已生成', content: '# 新版 SOP', changeSummary: ['补充验收标准'] })

    await expect(job).resolves.toEqual({ ok: true })
    expect(loadSopAiRevisionThread('sop-a', storage).messages).toEqual([
      request,
      expect.objectContaining({
        role: 'assistant',
        text: '新版已生成',
        revision: { content: '# 新版 SOP', changeSummary: ['补充验收标准'] },
      }),
    ])
    expect(getSopAiRevisionJobState('sop-a').status).toBe('idle')
    clearSopAiRevisionJob('sop-a')
  })
})
