import type { CompositeV2HistoryRecord } from './compositeV2Types'

export function addCompositeHistoryRecord(
  history: CompositeV2HistoryRecord[],
  record: CompositeV2HistoryRecord,
  retention: number,
): CompositeV2HistoryRecord[] {
  const limit = Number.isFinite(retention) ? Math.max(1, Math.floor(retention)) : 1
  const nextHistory = history.filter((item) => item.id !== record.id)

  return [record, ...nextHistory].sort((a, b) => b.endedAt - a.endedAt).slice(0, limit)
}
