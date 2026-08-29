import type { InputImage, WordLibraryEntry } from '../types'

export interface VariableResolver {
  wordLibraryEntries: WordLibraryEntry[]
}

const MENTION_START = '\u2063'
const MENTION_END = '\u2064'
export const VAR_START = '\u2060'
export const VAR_END = '\u2061'
const VAR_ENTRY_ID_SEPARATOR = '\u2062'
export const VAR_MENTION_RE = /\u2060([^\u2061]+)\u2061/g
const TEMPLATE_VARIABLE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g
const SELECTED_IMAGE_MENTION_RE = /\u2063@图(\d+)\u2064/g
const SELECTED_MENTION_RE = /\u2063(@图(\d+)|@(?:第)?\d+轮图\d+)\u2064/g

export interface AtImageQuery {
  start: number
  query: string
}

export function createVariableMention(varName: string, entryId?: string): string {
  const name = varName.trim()
  const id = entryId?.trim()
  return `${VAR_START}${name}${id ? `${VAR_ENTRY_ID_SEPARATOR}${id}` : ''}${VAR_END}`
}

export function parseVariableMention(rawValue: string) {
  const [rawName, rawEntryId] = rawValue.split(VAR_ENTRY_ID_SEPARATOR, 2)
  return { varName: rawName.trim(), entryId: rawEntryId?.trim() || undefined }
}

function hasSubstantiveVariableEntries(entry: WordLibraryEntry): boolean {
  const values = entry.entries.map((value) => value.trim()).filter(Boolean)
  return values.length > 0 && !(values.length === 1 && values[0] === entry.key)
}

export function resolveVariableMentionEntry(
  varName: string,
  entryId: string | undefined,
  wordLibraryEntries: WordLibraryEntry[],
  options: { preferredGroupId?: string } = {},
): WordLibraryEntry | undefined {
  const name = varName.trim()
  if (!name) return undefined

  const activeEntries = wordLibraryEntries.filter((entry) => entry.deletedAt == null)
  if (entryId) return activeEntries.find((entry) => entry.id === entryId)

  const sameName = activeEntries.filter((entry) => entry.key === name)
  if (sameName.length <= 1) return sameName[0]

  if (options.preferredGroupId) {
    const sameGroup = sameName.filter((entry) => entry.groupId === options.preferredGroupId)
    if (sameGroup.length === 1) return sameGroup[0]
  }

  const substantive = sameName.filter(hasSubstantiveVariableEntries)
  if (substantive.length === 1) return substantive[0]

  const generated = substantive.filter((entry) => entry.sourceSkillName || entry.generationBatchId)
  if (generated.length === 1) return generated[0]

  const nonDefault = substantive.filter((entry) => entry.groupId !== 'default')
  return nonDefault.length === 1 ? nonDefault[0] : undefined
}

function resolveVariableValue(
  varName: string,
  entryId: string | undefined,
  wordLibraryEntries: WordLibraryEntry[],
): string | undefined {
  const entry = resolveVariableMentionEntry(varName, entryId, wordLibraryEntries)
  const values = entry?.entries.map((value) => value.trim()).filter(Boolean) ?? []
  if (values.length === 0) return undefined
  return values[Math.floor(Math.random() * values.length)]
}

export function getImageMentionLabel(index: number) {
  return `@图${index + 1}`
}

export function getSelectedImageMentionLabel(index: number) {
  return getSelectedTextMentionLabel(getImageMentionLabel(index))
}

export function getSelectedTextMentionLabel(text: string) {
  return `${MENTION_START}${text}${MENTION_END}`
}

export function stripImageMentionMarkers(prompt: string): string {
  return prompt.replace(/[\u2060\u2061\u2062\u2063\u2064]/g, '')
}

export function escapePromptHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapePromptHtmlAttribute(value: string): string {
  return escapePromptHtmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function getPromptIndexFromVisibleIndex(prompt: string, visibleIndex: number): number {
  let visible = 0
  for (let i = 0; i < prompt.length; i++) {
    if (visible >= visibleIndex) return i
    if (prompt[i] === MENTION_START || prompt[i] === MENTION_END || prompt[i] === VAR_START || prompt[i] === VAR_END)
      continue
    visible++
  }
  return prompt.length
}

function findVariableMentionAtVisibleOffset(prompt: string, visibleOffset: number) {
  for (const match of prompt.matchAll(VAR_MENTION_RE)) {
    if (match.index == null) continue
    const { varName } = parseVariableMention(match[1])
    const visibleStart = stripImageMentionMarkers(prompt.slice(0, match.index)).length
    const visibleEnd = visibleStart + varName.length
    if (visibleOffset >= visibleStart && visibleOffset <= visibleEnd) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        visibleStart,
        visibleEnd,
        marker: match[0],
        varName,
      }
    }
  }
  return null
}

export function convertVariableMentionAtVisibleOffsetToText(prompt: string, visibleOffset: number) {
  const mention = findVariableMentionAtVisibleOffset(prompt, visibleOffset)
  if (!mention) return prompt
  return `${prompt.slice(0, mention.start)}${mention.varName}${prompt.slice(mention.end)}`
}

export function moveVariableMentionInPrompt(prompt: string, sourceVisibleOffset: number, targetVisibleOffset: number) {
  const mention = findVariableMentionAtVisibleOffset(prompt, sourceVisibleOffset)
  if (!mention) return prompt
  if (targetVisibleOffset >= mention.visibleStart && targetVisibleOffset <= mention.visibleEnd) return prompt

  const promptWithoutMention = `${prompt.slice(0, mention.start)}${prompt.slice(mention.end)}`
  const nextTargetVisibleOffset =
    targetVisibleOffset > mention.visibleEnd ? targetVisibleOffset - mention.varName.length : targetVisibleOffset
  const visibleLength = stripImageMentionMarkers(promptWithoutMention).length
  const insertAt =
    nextTargetVisibleOffset >= visibleLength
      ? promptWithoutMention.length
      : getPromptIndexFromVisibleIndex(promptWithoutMention, nextTargetVisibleOffset)
  return `${promptWithoutMention.slice(0, insertAt)}${mention.marker}${promptWithoutMention.slice(insertAt)}`
}

export function isCursorInSelectedImageMention(prompt: string, visibleCursor: number): boolean {
  for (const match of prompt.matchAll(SELECTED_MENTION_RE)) {
    if (match.index == null) continue
    const visibleStart = stripImageMentionMarkers(prompt.slice(0, match.index)).length
    const visibleEnd = visibleStart + match[1].length
    if (visibleCursor > visibleStart && visibleCursor <= visibleEnd) return true
  }
  return false
}

export function getAtImageQuery(
  prompt: string,
  cursor: number,
  imageSource: Pick<InputImage[], 'length'>,
): AtImageQuery | null {
  if (imageSource.length === 0) return null

  const beforeCursor = prompt.slice(0, cursor)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return null

  const query = beforeCursor.slice(atIndex + 1)
  if (/\s/.test(query)) return null
  return { start: atIndex, query }
}

export function imageMentionMatches(query: string, index: number) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const oneBasedIndex = String(index + 1)
  const label = `图${oneBasedIndex}`
  return oneBasedIndex.includes(normalized) || label.toLowerCase().includes(normalized)
}

export function insertImageMention(prompt: string, start: number, cursor: number, imageIndex: number) {
  const mention = getSelectedImageMentionLabel(imageIndex)
  const visibleMention = getImageMentionLabel(imageIndex)
  const nextPrompt = `${prompt.slice(0, start)}${mention}${prompt.slice(cursor)}`
  return {
    prompt: nextPrompt,
    cursor: start + visibleMention.length,
  }
}

export function insertImageMentionAtVisibleRange(prompt: string, start: number, cursor: number, imageIndex: number) {
  return insertTextMentionAtVisibleRange(prompt, start, cursor, getImageMentionLabel(imageIndex))
}

export function insertTextMentionAtVisibleRange(prompt: string, start: number, cursor: number, text: string) {
  const promptStart = getPromptIndexFromVisibleIndex(prompt, start)
  const promptCursor = getPromptIndexFromVisibleIndex(prompt, cursor)
  const mention = getSelectedTextMentionLabel(text)
  return {
    prompt: `${prompt.slice(0, promptStart)}${mention}${prompt.slice(promptCursor)}`,
    cursor: start + text.length,
  }
}

export function remapImageMentionsForOrder(
  prompt: string,
  previousImages: InputImage[],
  nextImages: InputImage[],
  equivalentImageIds: Record<string, string> = {},
): string {
  return prompt.replace(SELECTED_IMAGE_MENTION_RE, (text, n) => {
    const previousImage = previousImages[Number(n) - 1]
    if (!previousImage) return text

    const nextImageId = equivalentImageIds[previousImage.id] ?? previousImage.id
    const nextIndex = nextImages.findIndex((img) => img.id === nextImageId)
    return nextIndex >= 0 ? getSelectedImageMentionLabel(nextIndex) : '@已移除图片'
  })
}

export type PromptMentionPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; imageIndex: number; mentionText?: string }
  | { type: 'mention'; text: string; mentionText: string; imageIndex?: never }
  | { type: 'variable'; text: string; varName: string; entryId?: string }

export function getPromptMentionParts(prompt: string, inputImages: InputImage[]): PromptMentionPart[] {
  const parts: PromptMentionPart[] = []
  let lastIndex = 0

  // 收集所有匹配（mention + variable），按位置排序
  const matches: Array<{ index: number; length: number; type: 'mention' | 'variable'; match: RegExpExecArray }> = []

  for (const match of prompt.matchAll(SELECTED_MENTION_RE)) {
    if (match.index == null) continue
    matches.push({ index: match.index, length: match[0].length, type: 'mention', match })
  }
  for (const match of prompt.matchAll(VAR_MENTION_RE)) {
    if (match.index == null) continue
    const { varName } = parseVariableMention(match[1])
    if (!varName.trim()) continue
    matches.push({ index: match.index, length: match[0].length, type: 'variable', match })
  }

  matches.sort((a, b) => a.index - b.index)

  for (const m of matches) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', text: stripImageMentionMarkers(prompt.slice(lastIndex, m.index)) })
    }

    if (m.type === 'mention') {
      const text = m.match[1]
      const index = m.match[2] ? Number(m.match[2]) - 1 : null
      if (index != null && !inputImages[index]) continue
      parts.push(
        index == null
          ? { type: 'mention', text, mentionText: getSelectedTextMentionLabel(text) }
          : { type: 'mention', text, imageIndex: index },
      )
    } else {
      // variable
      const { varName, entryId } = parseVariableMention(m.match[1])
      parts.push({ type: 'variable', text: varName, varName, entryId })
    }

    lastIndex = m.index + m.length
  }

  if (lastIndex < prompt.length) {
    parts.push({ type: 'text', text: stripImageMentionMarkers(prompt.slice(lastIndex)) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: stripImageMentionMarkers(prompt) }]
}

export function replaceImageMentionsForApi(
  prompt: string,
  imageCount?: number,
  formatImage?: (index: number) => string,
  variableResolver?: VariableResolver,
): string {
  let result = prompt.replace(SELECTED_IMAGE_MENTION_RE, (text, n) => {
    const index = Number(n) - 1
    if (imageCount != null && (index < 0 || index >= imageCount)) return stripImageMentionMarkers(text)
    return formatImage ? formatImage(index) : `[image ${n}]`
  })
  // 替换变量词条标记为实际词条内容（随机选择一条）
  if (variableResolver) {
    result = result.replace(VAR_MENTION_RE, (_text, rawValue) => {
      const { varName: trimmedVarName, entryId } = parseVariableMention(rawValue)
      if (!trimmedVarName) return ''
      return resolveVariableValue(trimmedVarName, entryId, variableResolver.wordLibraryEntries) ?? trimmedVarName
    })
    // Support variables typed directly in the gallery prompt as {{词条名}}.
    // Unknown variables intentionally remain visible instead of being silently removed.
    result = result.replace(TEMPLATE_VARIABLE_RE, (marker, rawName) => {
      const name = String(rawName).trim()
      return resolveVariableValue(name, undefined, variableResolver.wordLibraryEntries) ?? marker
    })
  }
  return result
}
