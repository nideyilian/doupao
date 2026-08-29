import type { SopBatchSnapshot } from '../../../types'

export type PromptRunListEntry =
  | { type: 'run'; run: SopBatchSnapshot; createdAt: number }
  | {
      type: 'sop-group'
      id: string
      sopId: string
      sopName: string
      runs: SopBatchSnapshot[]
      createdAt: number
    }

export function sortPromptRunsNewestFirst(runs: SopBatchSnapshot[]) {
  return [...runs].sort(
    (left, right) =>
      right.createdAt - left.createdAt || (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt),
  )
}

export function groupPromptRunsBySop(runs: SopBatchSnapshot[]): PromptRunListEntry[] {
  const sortedRuns = sortPromptRunsNewestFirst(runs)
  const runsBySop = new Map<string, SopBatchSnapshot[]>()

  for (const run of sortedRuns) {
    if (run.sop.id === 'prompt-library') continue
    const group = runsBySop.get(run.sop.id) ?? []
    group.push(run)
    runsBySop.set(run.sop.id, group)
  }

  const groupedSopIds = new Set(
    [...runsBySop.entries()].filter(([, group]) => group.length > 1).map(([sopId]) => sopId),
  )
  const emittedSopIds = new Set<string>()
  const entries: PromptRunListEntry[] = []

  for (const run of sortedRuns) {
    if (!groupedSopIds.has(run.sop.id)) {
      entries.push({ type: 'run', run, createdAt: run.createdAt })
      continue
    }
    if (emittedSopIds.has(run.sop.id)) continue
    emittedSopIds.add(run.sop.id)
    const group = runsBySop.get(run.sop.id) ?? [run]
    entries.push({
      type: 'sop-group',
      id: `sop:${run.sop.id}`,
      sopId: run.sop.id,
      sopName: run.sop.name || '未命名 SOP',
      runs: group,
      createdAt: group[0].createdAt,
    })
  }

  return entries
}
