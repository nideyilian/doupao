import type { CompositeExportRecord, CompositeExportSummary } from './compositeTypes'

export function summarizeCompositeExportHistory(records: CompositeExportRecord[]): CompositeExportSummary[] {
  if (!records.length) return []
  const latestRun = records.reduce(
    (latest, record) => (record.createdAt >= latest.createdAt ? record : latest),
    records[0],
  ).runId
  const summary = new Map<string, number>()
  for (const record of records) {
    if (record.runId !== latestRun) continue
    summary.set(record.outputPath, (summary.get(record.outputPath) ?? 0) + record.count)
  }
  return Array.from(summary, ([outputPath, count]) => ({ outputPath, count }))
}
