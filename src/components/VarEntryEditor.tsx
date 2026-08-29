import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'

/** 去除行首序号（如 "1. xxx"、"1) xxx"、"1、xxx"、"1.xxx"）和空白 */
function cleanEntryLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/^\d+[.)、）\u3001]\s*/, '')
    .replace(/^\d+\s+/, '')
    .trim()
}

/** 将 textarea 文本转为清洗后的词条数组 */
function parseEntries(text: string): string[] {
  return text
    .split('\n')
    .map(cleanEntryLine)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // 去重
}

export default function VarEntryEditor() {
  const config = useStore((s) => s.varEntryEditor)
  const setConfig = useStore((s) => s.setVarEntryEditor)
  const groups = useStore((s) => s.wordLibraryGroups)

  const [varName, setVarName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [entriesText, setEntriesText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // 打开时初始化
  useEffect(() => {
    if (config) {
      setVarName(config.varName)
      setGroupId(config.groupId)
      setEntriesText(config.entries.join('\n'))
      // 自动聚焦文本域
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [config])

  const handleClose = () => setConfig(null)

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!config) return
    try {
      const cleaned = parseEntries(entriesText)
      // 先关闭编辑器，再执行保存回调
      // 避免与 onSave 内部的多个 Zustand set() 调用产生冲突
      setConfig(null)
      config.onSave(varName.trim() || config.varName, groupId, cleaned)
    } catch (err) {
      console.error('保存词条失败:', err)
      useStore.getState().showToast('保存词条失败', 'error')
    }
  }

  useCloseOnEscape(Boolean(config), handleClose)
  usePreventBackgroundScroll(Boolean(config), modalRef)
  useDialogFocusTrap(Boolean(config), modalRef, textareaRef)

  // ⚠️ useMemo 必须在所有提前 return 之前调用，否则 React 会抱怨
  // "Rendered more hooks than during the previous render"
  const previewCount = useMemo(() => parseEntries(entriesText).length, [entriesText])

  if (!config) return null

  return (
    <div className="ds-modal-layer fixed inset-0 flex items-start justify-center p-4 pt-16" onClick={handleClose}>
      {/* 遮罩 */}
      <div className="ds-modal-scrim absolute inset-0" />

      {/* 弹窗卡片 */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="编辑变量词条"
        className="ds-modal-surface relative w-full max-w-md rounded-ds-xl border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏：变量名 | 分组 | 保存 */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-ds-border dark:border-ds-border">
          {/* 变量名 */}
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-ds-muted dark:text-ds-muted mb-1">变量名</label>
            <input
              value={varName}
              onChange={(e) => setVarName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-ds-border/60 dark:border-ds-border bg-ds-surface/50 dark:bg-ds-surface text-sm outline-none focus:ring-1 focus:ring-ds-focus/40"
              placeholder="变量名称"
            />
          </div>

          {/* 分组 */}
          <div className="w-32 flex-shrink-0">
            <label className="block text-xs text-ds-muted dark:text-ds-muted mb-1">分类</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-ds-border/60 dark:border-ds-border bg-ds-surface/50 dark:bg-ds-surface text-sm outline-none focus:ring-1 focus:ring-ds-focus/40"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* 保存 */}
          <button
            type="button"
            onClick={handleSave}
            className="self-end px-4 py-1.5 rounded-lg bg-ds-primary hover:bg-ds-primary-hover text-ds-text-inverse text-sm font-medium transition-colors"
          >
            保存
          </button>
        </div>

        {/* 词条编辑区 */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-ds-muted dark:text-ds-muted">
              词条内容 <span className="text-ds-text-subtle dark:text-ds-muted">（每行一个，自动去除编号和空行）</span>
            </label>
            <span className="text-xs text-ds-muted dark:text-ds-muted">{previewCount} 条</span>
          </div>
          <textarea
            ref={textareaRef}
            value={entriesText}
            onChange={(e) => setEntriesText(e.target.value)}
            className="w-full h-48 px-3 py-2 rounded-ds-lg border border-ds-border/60 dark:border-ds-border bg-ds-surface/50 dark:bg-ds-surface text-sm outline-none focus:ring-1 focus:ring-ds-focus/40 resize-none font-mono"
            placeholder={`输入词条，每行一个，例如：\ncat\ndog\nrabbit\n\n支持带编号格式：\n1. cat\n2. dog\n3. rabbit`}
          />
        </div>
      </div>
    </div>
  )
}
