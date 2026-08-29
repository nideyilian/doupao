import { useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useStore } from '../store'
import type { WordLibraryEntry } from '../types'
import {
  escapePromptHtmlAttribute,
  escapePromptHtmlText,
  getPromptMentionParts,
  getSelectedImageMentionLabel,
  createVariableMention,
  resolveVariableMentionEntry,
  VAR_END,
  VAR_START,
} from '../lib/promptImageMentions'
import { normalizePromptVariableMarkers, replaceVariableNameInPrompt } from '../lib/promptVariableEditor'
import { buildVariableColorMap } from '../lib/promptVariableColors'

type PromptVariableEditorProps = {
  value: string
  onChange: (value: string) => void
  onVariablePromptChange?: (value: string) => void
  className?: string
  autoFocus?: boolean
  selectOnFocus?: boolean
  spellCheck?: boolean
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

function getContentEditablePlainText(el: HTMLElement): string {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      text += node.dataset.mentionText ?? node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('wildcard-var')) {
      text += createVariableMention(node.dataset.varName ?? node.textContent ?? '', node.dataset.entryId)
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '\n')
}

function renderPromptHtml(value: string, wordLibraryEntries: WordLibraryEntry[]) {
  const colorMap = buildVariableColorMap(wordLibraryEntries)

  return getPromptMentionParts(value, [])
    .map((part) => {
      if (part.type === 'mention') {
        const mentionText = part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)
        return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapePromptHtmlAttribute(mentionText)}">${escapePromptHtmlText(part.text)}</span>`
      }
      if (part.type === 'variable') {
        const color = colorMap[part.varName] ?? ''
        if (!color) return escapePromptHtmlText(part.text)
        const style = color
          ? `style="background:${color}18;color:${color};border-color:${color};--var-bg:${color}18;--var-text:${color};--var-border:${color};--var-bg-hover:${color}28;--var-bg-selected:${color};--var-text-selected:#fff;--var-border-selected:${color}"`
          : ''
        return `<span contenteditable="false" draggable="false" class="wildcard-var" data-var-name="${escapePromptHtmlAttribute(part.varName)}"${part.entryId ? ` data-entry-id="${escapePromptHtmlAttribute(part.entryId)}"` : ''} ${style}>${escapePromptHtmlText(part.text)}</span>`
      }
      return escapePromptHtmlText(part.text)
    })
    .join('')
}

export default function PromptVariableEditor({
  value,
  onChange,
  onVariablePromptChange,
  className = '',
  autoFocus = false,
  selectOnFocus = false,
  spellCheck = false,
  onBlur,
  onClick,
  onKeyDown,
}: PromptVariableEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isUserInputRef = useRef(false)
  const valueRef = useRef(value)
  const wordLibraryEntries = useStore((s) => s.wordLibraryEntries)
  const wordLibraryGroups = useStore((s) => s.wordLibraryGroups)
  const setWordLibraryPromptSelectedVarName = useStore((s) => s.setWordLibraryPromptSelectedVarName)
  const setWordLibraryEditEntryId = useStore((s) => s.setWordLibraryEditEntryId)
  const setVarEntryEditor = useStore((s) => s.setVarEntryEditor)
  const activeWordLibraryEntries = useMemo(
    () => wordLibraryEntries.filter((e) => e.deletedAt == null),
    [wordLibraryEntries],
  )
  const renderedHtml = useMemo(
    () => renderPromptHtml(value, activeWordLibraryEntries),
    [value, activeWordLibraryEntries],
  )

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    const normalized = normalizePromptVariableMarkers(
      value,
      activeWordLibraryEntries.map((entry) => entry.key),
    )
    if (normalized === value) return
    valueRef.current = normalized
    onChange(normalized)
    onVariablePromptChange?.(normalized)
  }, [activeWordLibraryEntries, onChange, onVariablePromptChange, value])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    if (el.innerHTML !== renderedHtml) el.innerHTML = renderedHtml
  }, [renderedHtml])

  useEffect(() => {
    if (!autoFocus) return
    const el = editorRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.focus()
      if (!selectOnFocus) return
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }, [autoFocus, selectOnFocus])

  const openVariableEditor = (varName: string, boundEntryId?: string) => {
    const currentStore = useStore.getState()
    const entry = resolveVariableMentionEntry(varName, boundEntryId, currentStore.wordLibraryEntries)
    const groupId = entry?.groupId ?? currentStore.wordLibraryGroups[0]?.id ?? wordLibraryGroups[0]?.id ?? 'default'
    setWordLibraryPromptSelectedVarName(entry ? null : varName)
    setWordLibraryEditEntryId(entry?.id ?? boundEntryId ?? null)
    setVarEntryEditor({
      entryId: entry?.id,
      varName,
      groupId,
      entries: entry?.entries ?? [],
      onSave: (rawNewName, newGroupId, cleanedEntries) => {
        const newName = rawNewName.trim() || varName
        const nextPrompt = replaceVariableNameInPrompt(valueRef.current, varName, newName)
        if (nextPrompt !== valueRef.current) {
          valueRef.current = nextPrompt
          onChange(nextPrompt)
          onVariablePromptChange?.(nextPrompt)
        }

        const latestStore = useStore.getState()
        const existingId = entry?.id
        if (existingId) {
          latestStore.updateWordLibraryEntry(existingId, {
            key: newName,
            groupId: newGroupId,
            entries: cleanedEntries,
            label: newName,
          })
        } else if (cleanedEntries.length > 0) {
          const newEntry = latestStore.createWordLibraryEntry(newGroupId, newName)
          latestStore.updateWordLibraryEntry(newEntry.id, {
            entries: cleanedEntries,
            label: newName,
          })
        }
        latestStore.showToast('词条已保存', 'success')
      },
    })
  }

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      className={className}
      spellCheck={spellCheck}
      onInput={(event) => {
        isUserInputRef.current = true
        const nextValue = getContentEditablePlainText(event.currentTarget)
        valueRef.current = nextValue
        onChange(nextValue)
      }}
      onBlur={onBlur}
      onClick={(event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wildcard-var')
        if (target) {
          const varName = target.dataset.varName ?? target.textContent ?? ''
          const entry = resolveVariableMentionEntry(
            varName,
            target.dataset.entryId,
            useStore.getState().wordLibraryEntries,
          )
          setWordLibraryPromptSelectedVarName(entry ? null : varName)
          setWordLibraryEditEntryId(entry?.id ?? target.dataset.entryId ?? null)
        }
        onClick?.(event)
      }}
      onDoubleClick={(event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.wildcard-var')
        if (!target) return
        event.preventDefault()
        event.stopPropagation()
        openVariableEditor(target.dataset.varName ?? target.textContent ?? '', target.dataset.entryId)
      }}
      onKeyDown={onKeyDown}
    />
  )
}
