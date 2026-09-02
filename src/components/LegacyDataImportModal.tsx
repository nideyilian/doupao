import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import {
  importLegacyDataSource,
  readJsonTextFile,
  relaunchAppAfterImport,
  scanLegacyDataSources,
  selectFile,
  selectSavePath,
  writeJsonTextFile,
  type LegacyImportResult,
  type LegacyImportSelection,
  type LegacySourceInfo,
} from '../lib/localSave'
import {
  buildLegacyDataExport,
  defaultLegacyDataExportFileName,
  describeLegacyDataPayload,
  importLegacyDataPayload,
  parseLegacyDataFile,
  type LegacyDataFilePayload,
} from '../lib/legacyDataTransfer'
import { useStore } from '../store'

interface Props {
  open: boolean
  onClose: () => void
}

function formatDate(mtime: number | null): string {
  if (mtime == null) return '无状态文件'
  return new Date(mtime).toLocaleString()
}

const DEFAULT_SELECTION: LegacyImportSelection = {
  importState: true,
  importLocalSettings: true,
  importLocalSaves: true,
  importIndexedDb: true,
}

/**
 * 旧版数据导入（设置 → 数据管理 → 导入旧版数据）。
 * 两条路径：
 * 1. 从旧 userData 目录（豆泡 / doupao / gpt-image-playground 等）复制数据到当前目录
 *    （只复制不覆盖；IndexedDB 仅导入与当前运行模式匹配的 origin 目录，导入后需重启生效）。
 * 2. 「导出数据 / 导入数据文件」：跨运行模式（dev ⇄ 安装版）的任务、词条库、Agent 对话迁移。
 */
export default function LegacyDataImportModal({ open, onClose }: Props) {
  const showToast = useStore((s) => s.showToast)
  const [scanning, setScanning] = useState(false)
  const [sources, setSources] = useState<LegacySourceInfo[] | null>(null)
  const [selectionByDir, setSelectionByDir] = useState<Record<string, LegacyImportSelection>>({})
  const [importingDir, setImportingDir] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ dir: string; result: LegacyImportResult } | null>(null)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [importFileBusy, setImportFileBusy] = useState(false)
  const [pendingFilePayload, setPendingFilePayload] = useState<LegacyDataFilePayload | null>(null)
  const [fileImportSummary, setFileImportSummary] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setScanning(true)
    try {
      const found = await scanLegacyDataSources()
      setSources(found)
      setSelectionByDir((current) => {
        const next = { ...current }
        for (const source of found) {
          if (!next[source.dir]) next[source.dir] = { ...DEFAULT_SELECTION }
        }
        return next
      })
    } catch (err) {
      showToast('扫描旧版数据目录失败', 'error')
    } finally {
      setScanning(false)
    }
  }, [showToast])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useCloseOnEscape(open && !pendingFilePayload, onClose)

  const hasMatchingIndexedDb = useMemo(
    () => (sources ?? []).some((source) => source.indexedDbEntries.some((entry) => entry.matchesCurrentOrigin)),
    [sources],
  )
  const hasAnySource = (sources ?? []).length > 0
  const hasImportedSomething = useMemo(() => lastResult != null && lastResult.result.imported.length > 0, [lastResult])

  const toggleSelectionItem = (dir: string, key: keyof LegacyImportSelection) => {
    setSelectionByDir((current) => ({
      ...current,
      [dir]: { ...(current[dir] ?? DEFAULT_SELECTION), [key]: !(current[dir]?.[key] ?? true) },
    }))
  }

  const handleImport = async (source: LegacySourceInfo) => {
    const selection = selectionByDir[source.dir] ?? DEFAULT_SELECTION
    if (
      !selection.importState &&
      !selection.importLocalSettings &&
      !selection.importLocalSaves &&
      !selection.importIndexedDb
    ) {
      showToast('请至少勾选一项要导入的内容', 'info')
      return
    }
    setImportingDir(source.dir)
    setLastResult(null)
    setNeedsRestart(false)
    try {
      const response = await importLegacyDataSource(source.dir, selection)
      if (!response.success) {
        showToast(`导入失败：${response.error ?? '未知错误'}`, 'error')
        return
      }
      setLastResult({ dir: source.dir, result: response.result! })
      const importedIndexedDb = response.result!.imported.some((item) => item.includes('任务与词条库'))
      setNeedsRestart(importedIndexedDb)
      if (response.result!.imported.length === 0) {
        showToast('没有可导入的新数据（内容已存在或来源为空）', 'info')
      } else {
        showToast(`已导入 ${response.result!.imported.length} 项`, 'success')
      }
    } catch (error) {
      showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setImportingDir(null)
    }
  }

  const handleExport = async () => {
    setExportBusy(true)
    try {
      const payload = await buildLegacyDataExport()
      if (
        !payload.stores.tasks?.length &&
        !payload.stores.wordLibrary?.length &&
        !payload.stores.agentConversations?.length &&
        !payload.stores.images?.length
      ) {
        showToast('当前没有可导出的任务/词条库数据', 'info')
        return
      }
      const filePath = await selectSavePath(defaultLegacyDataExportFileName(), [
        { name: '数据导出文件', extensions: ['json'] },
      ])
      if (!filePath) return
      const ok = await writeJsonTextFile(filePath, JSON.stringify(payload))
      showToast(ok ? `已导出到 ${filePath}` : '导出失败', ok ? 'success' : 'error')
    } catch (error) {
      showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setExportBusy(false)
    }
  }

  const handlePickImportFile = async () => {
    setImportFileBusy(true)
    try {
      const filePath = await selectFile([{ name: '数据导出文件', extensions: ['json'] }])
      if (!filePath) return
      const content = await readJsonTextFile(filePath)
      if (!content) {
        showToast('读取文件失败', 'error')
        return
      }
      const payload = parseLegacyDataFile(content)
      setPendingFilePayload(payload)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setImportFileBusy(false)
    }
  }

  const handleConfirmFileImport = async () => {
    if (!pendingFilePayload) return
    setImportFileBusy(true)
    try {
      const summary = await importLegacyDataPayload(pendingFilePayload)
      setFileImportSummary(
        `任务 ${summary.tasks} 条、词条库 ${summary.wordLibrary} 份、Agent 对话 ${summary.agentConversations} 个、图片记录 ${summary.images} 条`,
      )
      showToast('数据文件已导入', 'success')
      setPendingFilePayload(null)
    } catch (error) {
      showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setImportFileBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center bg-ds-scrim/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="导入旧版数据"
    >
      <div
        className="ds-modal-surface relative z-10 flex max-h-[85vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-ds-xl border animate-modal-in motion-reduce:animate-none"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-5 py-3.5">
          <div>
            <h3 className="text-sm font-bold text-ds-text dark:text-ds-text-subtle">导入旧版数据</h3>
            <p className="mt-0.5 text-xs text-ds-muted">
              从旧版本数据目录（豆泡 / doupao / gpt-image-playground 等）恢复，或跨模式迁移任务与词条库
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-lg text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主体 */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
          <div className="rounded-ds-lg border border-ds-border/60 bg-ds-subtle/60 p-3 text-xs leading-relaxed text-ds-muted dark:bg-ds-subtle/40">
            导入只<strong className="text-ds-text">复制不覆盖</strong>：已存在的数据不会被改动。任务/词条库等 IndexedDB
            数据与运行模式绑定（安装版与开发模式互不可见），目录导入只恢复当前模式的数据；跨模式迁移请用下方的「导出数据
            / 导入数据文件」。
          </div>

          {/* 旧目录扫描结果 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-ds-text">检测到的旧版本数据目录</h4>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={scanning}
                className="rounded-md px-2 py-1 text-xs text-ds-primary transition-colors hover:bg-ds-primary/10"
              >
                {scanning ? '扫描中…' : '重新扫描'}
              </button>
            </div>

            {scanning ? (
              <p className="py-6 text-center text-xs text-ds-muted">正在扫描 AppData 下的旧版数据目录…</p>
            ) : !hasAnySource ? (
              <p className="rounded-ds-lg border border-dashed border-ds-border px-3 py-6 text-center text-xs text-ds-muted">
                未发现旧版本数据目录（已迁移过或从未安装旧版）。本机数据目录：
                <code className="mx-1 rounded bg-ds-subtle px-1 py-0.5">%APPDATA%</code>
              </p>
            ) : (
              sources!.map((source) => {
                const selection = selectionByDir[source.dir] ?? DEFAULT_SELECTION
                const originMatches = source.indexedDbEntries.filter((entry) => entry.matchesCurrentOrigin)
                const originMismatch = source.indexedDbEntries.filter((entry) => !entry.matchesCurrentOrigin)
                return (
                  <div key={source.dir} className="rounded-ds-lg border border-ds-border bg-ds-surface p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-xs font-semibold text-ds-text">{source.dirName}</span>
                      <span className="text-xs tabular-nums text-ds-muted">{source.sizeMb} MB</span>
                      <span className="text-xs text-ds-muted">状态文件：{formatDate(source.stateFileMtime)}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-ds-muted" title={source.dir}>
                      {source.dir}
                    </div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ds-subtle">
                        <input
                          type="checkbox"
                          checked={selection.importState}
                          onChange={() => toggleSelectionItem(source.dir, 'importState')}
                        />
                        标签工作区与设置（状态文件）
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ds-subtle">
                        <input
                          type="checkbox"
                          checked={selection.importLocalSettings}
                          onChange={() => toggleSelectionItem(source.dir, 'importLocalSettings')}
                        />
                        本地设置（素材库位置等）
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ds-subtle">
                        <input
                          type="checkbox"
                          checked={selection.importLocalSaves}
                          onChange={() => toggleSelectionItem(source.dir, 'importLocalSaves')}
                        />
                        素材库 local-saves
                        {source.hasLocalSaves && (
                          <span className="tabular-nums text-ds-muted">（{source.localSavesSizeMb} MB）</span>
                        )}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ds-subtle">
                        <input
                          type="checkbox"
                          checked={selection.importIndexedDb}
                          onChange={() => toggleSelectionItem(source.dir, 'importIndexedDb')}
                        />
                        任务与词条库
                        {originMatches.length > 0 && (
                          <span className="text-ds-success">（本模式 {originMatches.length} 个）</span>
                        )}
                        {originMatches.length === 0 && originMismatch.length > 0 && (
                          <span className="text-ds-warning">（仅其他模式，需数据文件迁移）</span>
                        )}
                      </label>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={importingDir === source.dir}
                        onClick={() => void handleImport(source)}
                        className="rounded-ds-lg bg-ds-primary px-3 py-1.5 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary/90 disabled:opacity-50"
                      >
                        {importingDir === source.dir ? '导入中…' : '导入此目录'}
                      </button>
                    </div>
                    {lastResult?.dir === source.dir && (
                      <div className="mt-2 space-y-1 rounded-ds-lg bg-ds-subtle/70 p-2.5 text-xs dark:bg-ds-subtle/40">
                        {lastResult.result.imported.length > 0 && (
                          <p className="text-ds-success">已导入：{lastResult.result.imported.join('、')}</p>
                        )}
                        {lastResult.result.skipped.length > 0 && (
                          <p className="text-ds-muted">跳过：{lastResult.result.skipped.join('、')}</p>
                        )}
                        {lastResult.result.notes.map((note) => (
                          <p key={note} className="text-ds-warning">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {needsRestart && hasImportedSomething && (
              <div className="flex items-center justify-between gap-3 rounded-ds-lg border border-ds-primary/40 bg-ds-primary-subtle px-3 py-2.5 text-xs text-ds-primary dark:border-ds-primary/25 dark:bg-ds-primary/10">
                <span>任务/词条库数据已复制，需重启应用后生效。</span>
                <button
                  type="button"
                  onClick={() => void relaunchAppAfterImport()}
                  className="shrink-0 rounded-ds-lg bg-ds-primary px-3 py-1.5 font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary/90"
                >
                  立即重启
                </button>
              </div>
            )}

            {!hasMatchingIndexedDb && hasAnySource && (
              <p className="rounded-ds-lg border border-dashed border-ds-border px-3 py-2 text-xs text-ds-muted">
                提示：当前运行模式没有匹配的任务/词条库数据目录，跨模式迁移请使用下方「导出数据 / 导入数据文件」。
              </p>
            )}
          </section>

          {/* 跨模式数据文件迁移 */}
          <section className="space-y-2 border-t border-ds-border pt-4">
            <h4 className="text-xs font-semibold text-ds-text">导出 / 导入数据文件（跨模式迁移）</h4>
            <p className="text-xs leading-relaxed text-ds-muted">
              在旧版本（或开发模式）中「导出数据」生成 JSON 文件，再在新版本（或安装版）中「导入数据文件」，
              即可迁移任务、词条库与 Agent 对话；该 JSON 只保存图片引用元数据，不包含原始图片。跨设备恢复原图请使用 ZIP
              导出并勾选「包含原始图片」。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={exportBusy}
                onClick={() => void handleExport()}
                className="rounded-ds-lg border border-ds-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ds-subtle disabled:opacity-50"
              >
                {exportBusy ? '导出中…' : '导出当前数据'}
              </button>
              <button
                type="button"
                disabled={importFileBusy}
                onClick={() => void handlePickImportFile()}
                className="rounded-ds-lg border border-ds-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ds-subtle disabled:opacity-50"
              >
                {importFileBusy ? '导入中…' : '导入数据文件'}
              </button>
            </div>

            {pendingFilePayload && (
              <div className="rounded-ds-lg border border-ds-primary/40 bg-ds-primary-subtle p-3 text-xs dark:border-ds-primary/25 dark:bg-ds-primary/10">
                <p className="font-medium text-ds-primary">
                  数据文件内容：{describeLegacyDataPayload(pendingFilePayload)}
                  {pendingFilePayload.appVersion ? `（导出自 v${pendingFilePayload.appVersion}）` : ''}
                </p>
                <p className="mt-1 text-ds-muted">导入时跳过已存在的记录，不会覆盖现有数据。</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConfirmFileImport()}
                    className="rounded-ds-lg bg-ds-primary px-3 py-1.5 font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary/90"
                  >
                    确认导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingFilePayload(null)}
                    className="rounded-ds-lg border border-ds-border px-3 py-1.5 transition-colors hover:bg-ds-subtle"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {fileImportSummary && (
              <p className="rounded-ds-lg bg-ds-subtle/70 p-2.5 text-xs text-ds-success dark:bg-ds-subtle/40">
                已导入：{fileImportSummary}
              </p>
            )}
          </section>
        </div>

        {/* 底部 */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ds-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-ds-lg border border-ds-border px-4 py-2 text-xs font-medium transition-colors hover:bg-ds-subtle"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
