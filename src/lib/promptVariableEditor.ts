import { createVariableMention, parseVariableMention, VAR_MENTION_RE } from './promptImageMentions'

export function replaceVariableNameInPrompt(prompt: string, previousName: string, nextName: string): string {
  if (previousName === nextName) return prompt
  return prompt.replace(VAR_MENTION_RE, (marker, rawValue: string) => {
    const { varName, entryId } = parseVariableMention(rawValue)
    return varName === previousName ? createVariableMention(nextName, entryId) : marker
  })
}

export function normalizePromptVariableMarkers(prompt: string, activeVariableNames: Iterable<string>): string {
  const active = new Set([...activeVariableNames].map((name) => name.trim()).filter(Boolean))
  return prompt.replace(VAR_MENTION_RE, (marker, rawValue: string) => {
    const { varName: name, entryId } = parseVariableMention(rawValue)
    if (entryId) return marker
    return active.has(name) ? marker : name
  })
}
