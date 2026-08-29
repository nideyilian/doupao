import type { WordLibraryGroup } from '../../types'
import type { WordDeriveActionSettings, WordDeriveSaveStrategy } from './types'

type AssistantWordGroupOptions = Pick<WordDeriveActionSettings, 'targetGroupMode' | 'targetGroupId'> & {
  actionName: string
  /** Name used when a fresh group is created (mode 'new'). */
  suggestedName: string
  /** Per-save override chosen in the save dialog; falls back to targetGroupMode. */
  saveStrategy?: WordDeriveSaveStrategy
}

/** Build a human-readable group name for a fresh generation batch:
 *  `{技能名} · {输入摘要} · {MM-DD HH:mm}`. */
export function buildWordGroupName(actionName: string, prompt: string, inputImageCount: number): string {
  const skillName = actionName.trim() || '词条衍生'
  const summary = summarizeInput(prompt, inputImageCount)
  const stamp = formatGroupStamp(Date.now())
  return `${skillName} · ${summary} · ${stamp}`
}

function summarizeInput(prompt: string, inputImageCount: number): string {
  const text = prompt.trim().replace(/\s+/g, ' ').slice(0, 12).trim()
  if (text) return text
  if (inputImageCount > 0) return `${inputImageCount}张参考图`
  return '未命名素材'
}

function formatGroupStamp(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function resolveAssistantWordGroupId(
  options: AssistantWordGroupOptions,
  groups: WordLibraryGroup[],
  createGroup: (name: string) => string,
) {
  const activeGroups = groups.filter((group) => group.archivedAt == null)
  // The explicit per-save choice wins; without one, use the persisted default.
  const strategy: WordDeriveSaveStrategy = options.saveStrategy ?? options.targetGroupMode

  if (strategy === 'selected' && options.targetGroupId) {
    const selected = activeGroups.find((group) => group.id === options.targetGroupId)
    if (selected) return selected.id
  }

  // Default ('new'): every generation goes into its own standalone group so
  // different skills / inputs / runs never merge into one shared bucket.
  return createGroup(options.suggestedName)
}
