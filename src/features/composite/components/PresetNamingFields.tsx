import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useStore } from '../../../store'
import type { CompositeV2CustomVariable, CompositeV2Preset } from '../lib/compositeV2Types'

type Props = {
  preset: CompositeV2Preset
  customVariables: CompositeV2CustomVariable[]
  previewValues: Record<string, string>
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
  onAddCustomVariable: (name: string, value: string) => void
  onUpdateCustomVariableValue: (name: string, value: string) => void
  onRemoveCustomVariable: (name: string) => void
  onSelectOutputDirectory?: () => void | Promise<void>
}

const BUILT_IN_VARIABLES = [
  { name: 'date', label: '日期' },
  { name: 'channel', label: '渠道' },
  { name: 'size', label: '尺寸' },
  { name: 'preset', label: '预设' },
  { name: 'index', label: '序号' },
  { name: 'source', label: '源文件' },
  { name: 'sourceDir', label: '源目录' },
  { name: 'custom', label: '自定义值' },
]
const BUILT_IN_VARIABLE_NAMES = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))

export type NamingTemplateSelection = {
  start: number
  end: number
}

export function insertNamingVariable(template: string, name: string, selection: NamingTemplateSelection | null) {
  const token = `{${name}}`
  if (!selection) {
    return { template: `${template}${token}`, caret: template.length + token.length }
  }

  const start = Math.max(0, Math.min(selection.start, selection.end, template.length))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), template.length))
  return {
    template: `${template.slice(0, start)}${token}${template.slice(end)}`,
    caret: start + token.length,
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function renderNamingTemplateHtml(template: string, values: Record<string, string>): string {
  let result = ''
  let cursor = 0
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const index = match.index ?? 0
    const name = match[1] ?? ''
    result += escapeHtml(template.slice(cursor, index))
    const resolved = values[name] ?? match[0]
    result += `<span contenteditable="false" draggable="true" class="mention-tag" data-variable-name="${escapeHtml(name)}" title="${escapeHtml(match[0])}">${escapeHtml(resolved)}</span>`
    cursor = index + match[0].length
  }
  return result + escapeHtml(template.slice(cursor))
}

export function readNamingTemplate(host: Pick<Node, 'childNodes'>): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    const name = element.getAttribute('data-variable-name')
    if (name) return `{${name}}`
    if (element.tagName === 'BR') return ''
    return Array.from(element.childNodes).map(readNode).join('')
  }
  return Array.from(host.childNodes).map(readNode).join('')
}

export function resolveNamingTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (token, name: string) => values[name] ?? token)
}

function namingTokenAt(template: string, tokenStart: number) {
  return /^\{([^{}]+)\}/.exec(template.slice(tokenStart))
}

export function moveNamingVariable(template: string, tokenStart: number, dropOffset: number): string {
  const token = namingTokenAt(template, tokenStart)
  if (!token) return template
  const withoutToken = `${template.slice(0, tokenStart)}${template.slice(tokenStart + token[0].length)}`
  const adjustedOffset = Math.max(
    0,
    Math.min(withoutToken.length, dropOffset > tokenStart ? dropOffset - token[0].length : dropOffset),
  )
  return `${withoutToken.slice(0, adjustedOffset)}${token[0]}${withoutToken.slice(adjustedOffset)}`
}

export function convertNamingVariableToText(
  template: string,
  tokenStart: number,
  values: Record<string, string>,
): string {
  const token = namingTokenAt(template, tokenStart)
  if (!token) return template
  const resolved = values[token[1] ?? ''] ?? token[0]
  return `${template.slice(0, tokenStart)}${resolved}${template.slice(tokenStart + token[0].length)}`
}

function getNamingNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  const element = node as Element
  const name = element.getAttribute('data-variable-name')
  if (name) return `{${name}}`.length
  if (element.tagName === 'BR') return 0
  return Array.from(element.childNodes).reduce((sum, child) => sum + getNamingNodeLength(child), 0)
}

function getNamingOffsetBeforeNode(host: HTMLElement, target: Node): number {
  let offset = 0
  let found = false
  const walk = (node: Node) => {
    if (found) return
    if (node === target) {
      found = true
      return
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null
    if (node.nodeType === Node.TEXT_NODE || element?.hasAttribute('data-variable-name')) {
      offset += getNamingNodeLength(node)
      return
    }
    node.childNodes.forEach(walk)
  }
  host.childNodes.forEach(walk)
  return offset
}

function getNamingBoundaryOffset(host: HTMLElement, container: Node, offset: number): number {
  if (container === host) {
    return Array.from(host.childNodes)
      .slice(0, offset)
      .reduce((sum, child) => sum + getNamingNodeLength(child), 0)
  }
  const chip = (container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement)?.closest(
    '[data-variable-name]',
  )
  if (chip && host.contains(chip)) {
    const chipStart = getNamingOffsetBeforeNode(host, chip)
    return chipStart + (offset > 0 ? getNamingNodeLength(chip) : 0)
  }
  return (
    getNamingOffsetBeforeNode(host, container) +
    (container.nodeType === Node.TEXT_NODE ? Math.min(offset, container.textContent?.length ?? 0) : 0)
  )
}

function getNamingSelection(host: HTMLElement): NamingTemplateSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null
  return {
    start: getNamingBoundaryOffset(host, range.startContainer, range.startOffset),
    end: getNamingBoundaryOffset(host, range.endContainer, range.endOffset),
  }
}

function setNamingCaret(host: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return
  let remaining = offset
  let boundary: { node: Node; offset: number } = { node: host, offset: host.childNodes.length }

  for (const child of Array.from(host.childNodes)) {
    const length = getNamingNodeLength(child)
    if (remaining <= length) {
      const element = child.nodeType === Node.ELEMENT_NODE ? (child as Element) : null
      if (element?.hasAttribute('data-variable-name')) {
        boundary = {
          node: host,
          offset: Array.from(host.childNodes).indexOf(child) + (remaining >= length ? 1 : 0),
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        boundary = { node: child, offset: Math.min(remaining, child.textContent?.length ?? 0) }
      }
      break
    }
    remaining -= length
  }

  const range = document.createRange()
  range.setStart(boundary.node, boundary.offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

type TemplateField = 'outputRootPath' | 'filenameTemplate'

type NamingTemplateEditorProps = {
  ariaLabel: string
  editorRef: RefObject<HTMLDivElement | null>
  field: TemplateField
  value: string
  values: Record<string, string>
  minHeightClass: string
  onActivate: (field: TemplateField, selection: NamingTemplateSelection | null) => void
  onChange: (value: string, caret?: number) => void
}

function NamingTemplateEditor({
  ariaLabel,
  editorRef,
  field,
  value,
  values,
  minHeightClass,
  onActivate,
  onChange,
}: NamingTemplateEditorProps) {
  const draggedTokenStartRef = useRef<number | null>(null)

  function remember(host: HTMLDivElement) {
    onActivate(field, getNamingSelection(host))
  }

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      aria-label={ariaLabel}
      data-template-field={field}
      dangerouslySetInnerHTML={{ __html: renderNamingTemplateHtml(value, values) }}
      onInput={(event) => {
        const host = event.currentTarget
        const selection = getNamingSelection(host)
        onChange(readNamingTemplate(host), selection?.start)
      }}
      onFocus={(event) => remember(event.currentTarget)}
      onSelect={(event) => remember(event.currentTarget)}
      onClick={(event) => {
        const chip = (event.target as HTMLElement | null)?.closest('[data-variable-name]')
        if (chip && event.currentTarget.contains(chip)) {
          const selection = window.getSelection()
          const range = document.createRange()
          range.selectNode(chip)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
        remember(event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return
        const range = selection.getRangeAt(0)
        const chip = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-variable-name]')).find(
          (candidate) => {
            try {
              return !range.collapsed && range.intersectsNode(candidate)
            } catch {
              return false
            }
          },
        )
        if (!chip) return
        event.preventDefault()
        const template = readNamingTemplate(event.currentTarget)
        const tokenStart = getNamingOffsetBeforeNode(event.currentTarget, chip)
        const token = namingTokenAt(template, tokenStart)
        if (token) {
          onChange(`${template.slice(0, tokenStart)}${template.slice(tokenStart + token[0].length)}`, tokenStart)
        }
      }}
      onContextMenu={(event) => {
        const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-variable-name]')
        if (!chip || !event.currentTarget.contains(chip)) return
        event.preventDefault()
        const template = readNamingTemplate(event.currentTarget)
        const tokenStart = getNamingOffsetBeforeNode(event.currentTarget, chip)
        const name = chip.dataset.variableName ?? ''
        const textToInsert = chip.textContent ?? values[name] ?? ''
        onChange(
          convertNamingVariableToText(template, tokenStart, {
            ...values,
            [name]: textToInsert,
          }),
          tokenStart + textToInsert.length,
        )
      }}
      onDragStart={(event) => {
        const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-variable-name]')
        if (!chip || !event.currentTarget.contains(chip)) return
        draggedTokenStartRef.current = getNamingOffsetBeforeNode(event.currentTarget, chip)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', chip.dataset.variableName ?? '')
      }}
      onDragOver={(event) => {
        if (draggedTokenStartRef.current !== null) event.preventDefault()
      }}
      onDrop={(event) => {
        const tokenStart = draggedTokenStartRef.current
        draggedTokenStartRef.current = null
        if (tokenStart === null) return
        event.preventDefault()
        const template = readNamingTemplate(event.currentTarget)
        const ownerDocument = event.currentTarget.ownerDocument as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
        const range = ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY)
        const dropOffset =
          range && event.currentTarget.contains(range.startContainer)
            ? getNamingBoundaryOffset(event.currentTarget, range.startContainer, range.startOffset)
            : template.length
        onChange(moveNamingVariable(template, tokenStart, dropOffset), dropOffset)
      }}
      onDragEnd={() => {
        draggedTokenStartRef.current = null
      }}
      className={`${minHeightClass} w-full cursor-text whitespace-pre-wrap break-words rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-xs outline-none focus:border-ds-primary dark:border-ds-border dark:bg-ds-scrim`}
    />
  )
}

export function PresetNamingFields({
  preset,
  customVariables,
  previewValues,
  onUpdatePreset,
  onAddCustomVariable,
  onUpdateCustomVariableValue,
  onRemoveCustomVariable,
  onSelectOutputDirectory,
}: Props) {
  const [customName, setCustomName] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [customNameError, setCustomNameError] = useState('')
  const [activeField, setActiveField] = useState<TemplateField>('filenameTemplate')
  const selectionRef = useRef<Record<TemplateField, NamingTemplateSelection | null>>({
    outputRootPath: null,
    filenameTemplate: null,
  })
  const pendingCaretRef = useRef<{ field: TemplateField; caret: number } | null>(null)
  const outputRootRef = useRef<HTMLDivElement>(null)
  const filenameRef = useRef<HTMLDivElement>(null)
  const customNameErrorId = `preset-custom-variable-name-error-${preset.id}`

  const resolvedValues = useMemo(
    () => ({
      ...previewValues,
      ...preset.customVariableValues,
    }),
    [preset.customVariableValues, previewValues],
  )
  const filenamePreview = resolveNamingTemplate(preset.filenameTemplate, resolvedValues)

  useEffect(() => {
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
    setActiveField('filenameTemplate')
    selectionRef.current = { outputRootPath: null, filenameTemplate: null }
    pendingCaretRef.current = null
  }, [preset.id])

  useEffect(() => {
    const pending = pendingCaretRef.current
    if (!pending) return
    pendingCaretRef.current = null
    const editor = pending.field === 'outputRootPath' ? outputRootRef.current : filenameRef.current
    if (!editor) return
    editor.focus()
    setNamingCaret(editor, pending.caret)
  }, [preset.outputRootPath, preset.filenameTemplate])

  function rememberSelection(field: TemplateField, selection: NamingTemplateSelection | null) {
    setActiveField(field)
    selectionRef.current[field] = selection
  }

  function insertVariable(name: string) {
    const template = preset[activeField]
    const inserted = insertNamingVariable(template, name, selectionRef.current[activeField])
    selectionRef.current[activeField] = { start: inserted.caret, end: inserted.caret }
    pendingCaretRef.current = { field: activeField, caret: inserted.caret }
    onUpdatePreset({ [activeField]: inserted.template })
  }

  function addCustomVariable() {
    const name = customName.trim().replace(/[{}\s]/g, '')
    if (!name) return
    if (BUILT_IN_VARIABLE_NAMES.has(name) || customVariables.some((variable) => variable.name === name)) {
      setCustomNameError('变量名已被使用')
      return
    }
    onAddCustomVariable(name, customValue)
    useStore.getState().showToast(`已添加变量「${name}」`, 'success')
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
  }

  return (
    <div data-layout="preset-naming-fields" className="space-y-3 border-t border-ds-border pt-3 dark:border-ds-border">
      <div>
        <span className="block text-xs text-ds-muted">输出根目录</span>
        <div className="mt-1 flex gap-2">
          <NamingTemplateEditor
            editorRef={outputRootRef}
            ariaLabel="输出根目录"
            field="outputRootPath"
            value={preset.outputRootPath}
            values={resolvedValues}
            minHeightClass="min-h-ds-control-lg min-w-0 flex-1"
            onActivate={rememberSelection}
            onChange={(value, caret) => {
              if (caret !== undefined) pendingCaretRef.current = { field: 'outputRootPath', caret }
              onUpdatePreset({ outputRootPath: value })
            }}
          />
          <button
            type="button"
            onClick={() => void onSelectOutputDirectory?.()}
            className="cursor-pointer rounded-md border border-ds-border bg-ds-surface px-3 text-xs font-medium hover:bg-ds-subtle dark:border-ds-border dark:bg-ds-scrim dark:hover:bg-ds-subtle"
          >
            选择
          </button>
        </div>
      </div>
      <label className="block text-xs text-ds-muted">
        全局分配地址
        <input
          aria-label="全局分配地址"
          value={preset.distributionPath}
          onChange={(event) => onUpdatePreset({ distributionPath: event.target.value })}
          placeholder="目标根目录"
          className="mt-1 w-full cursor-text rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm dark:border-ds-border dark:bg-ds-scrim"
        />
      </label>
      <div>
        <span className="block text-xs text-ds-muted">文件名模板</span>
        <div className="mt-1">
          <NamingTemplateEditor
            editorRef={filenameRef}
            ariaLabel={`预设文件名模板 ${preset.name}`}
            field="filenameTemplate"
            value={preset.filenameTemplate}
            values={resolvedValues}
            minHeightClass="min-h-20"
            onActivate={rememberSelection}
            onChange={(value, caret) => {
              if (caret !== undefined) pendingCaretRef.current = { field: 'filenameTemplate', caret }
              onUpdatePreset({ filenameTemplate: value })
            }}
          />
        </div>
      </div>

      <div
        data-testid="preset-naming-preview"
        className="rounded-md border border-ds-primary/35 bg-ds-primary-subtle/50 p-2 text-xs text-ds-primary dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary"
      >
        <div>
          文件预览：<span data-testid="preset-filename-preview">{filenamePreview || '（空文件名）'}.jpg</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_VARIABLES.map((variable) => (
          <button
            key={variable.name}
            type="button"
            aria-label={`插入变量 {${variable.name}}`}
            title={`{${variable.name}} → ${resolvedValues[variable.name] ?? ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertVariable(variable.name)}
            className="cursor-pointer rounded-md border border-ds-warning/35 bg-ds-warning-subtle px-2 py-1 text-xs text-ds-warning hover:bg-ds-warning-subtle dark:border-ds-warning/30 dark:bg-ds-warning/10 dark:text-ds-warning"
          >
            {variable.label}
          </button>
        ))}
      </div>

      {customVariables.map((variable) => (
        <div
          key={variable.id}
          className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto_auto] items-center gap-2"
        >
          <code className="truncate text-xs text-ds-primary dark:text-ds-primary">{`{${variable.name}}`}</code>
          <input
            aria-label={`变量值 ${variable.name}`}
            value={preset.customVariableValues[variable.name] ?? ''}
            onChange={(event) => onUpdateCustomVariableValue(variable.name, event.target.value)}
            className="min-w-0 rounded-md border border-ds-border px-2 py-1.5 text-xs dark:border-ds-border dark:bg-ds-scrim"
          />
          <button
            type="button"
            aria-label={`插入变量 {${variable.name}}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertVariable(variable.name)}
            className="rounded-md border border-ds-primary/35 px-2 py-1 text-xs text-ds-primary dark:border-ds-primary/30 dark:text-ds-primary"
          >
            插入
          </button>
          <button
            type="button"
            aria-label={`移除变量 {${variable.name}}`}
            onClick={() => {
              onRemoveCustomVariable(variable.name)
              useStore.getState().showToast(`已移除变量「${variable.name}」`, 'success')
            }}
            className="rounded-md px-1.5 text-sm text-ds-primary hover:bg-ds-primary-subtle"
          >
            ×
          </button>
        </div>
      ))}

      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-2">
        <div className="min-w-0">
          <input
            aria-label="自定义变量名"
            aria-invalid={customNameError ? true : undefined}
            aria-describedby={customNameError ? customNameErrorId : undefined}
            value={customName}
            onChange={(event) => {
              setCustomName(event.target.value)
              setCustomNameError('')
            }}
            placeholder="变量名，如 project"
            className="w-full min-w-0 rounded-md border border-ds-border px-2 py-1.5 text-xs dark:border-ds-border dark:bg-ds-scrim"
          />
          {customNameError && (
            <p id={customNameErrorId} role="alert" className="mt-1 text-xs text-ds-danger">
              {customNameError}
            </p>
          )}
        </div>
        <input
          aria-label="自定义变量值"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          placeholder="当前预设的值"
          className="min-w-0 rounded-md border border-ds-border px-2 py-1.5 text-xs dark:border-ds-border dark:bg-ds-scrim"
        />
        <button
          type="button"
          aria-label="添加自定义变量"
          onClick={addCustomVariable}
          className="rounded-md bg-ds-primary px-3 py-1.5 text-xs font-medium text-ds-text-inverse hover:bg-ds-primary-hover"
        >
          添加
        </button>
      </div>
    </div>
  )
}
