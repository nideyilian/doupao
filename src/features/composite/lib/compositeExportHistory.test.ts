import { describe, expect, it } from 'vitest'
import { summarizeCompositeExportHistory } from './compositeExportHistory'

describe('summarizeCompositeExportHistory', () => {
  it('summarizes only the latest run by output path', () => {
    const history = summarizeCompositeExportHistory([
      { runId: 'old', outputPath: 'D:/out/a', count: 9, createdAt: 1 },
      { runId: 'new', outputPath: 'D:/out/a', count: 1, createdAt: 2 },
      { runId: 'new', outputPath: 'D:/out/a', count: 2, createdAt: 3 },
      { runId: 'new', outputPath: 'D:/out/b', count: 4, createdAt: 4 },
    ])

    expect(history).toEqual([
      { outputPath: 'D:/out/a', count: 3 },
      { outputPath: 'D:/out/b', count: 4 },
    ])
  })
})
