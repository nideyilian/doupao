export type SopGenerationBriefParts = {
  goal: string
  inputs: string
  output: string
  constraints: string
  exclusions: string
}

export const EMPTY_SOP_GENERATION_BRIEF: SopGenerationBriefParts = {
  goal: '',
  inputs: '',
  output: '',
  constraints: '',
  exclusions: '',
}

const SECTIONS: Array<{ key: keyof SopGenerationBriefParts; heading: string }> = [
  { key: 'goal', heading: '生成目标' },
  { key: 'inputs', heading: '输入与参考重点' },
  { key: 'output', heading: '期望产出' },
  { key: 'constraints', heading: '必须遵守' },
  { key: 'exclusions', heading: '不要出现' },
]

export function compileSopGenerationBrief(parts: SopGenerationBriefParts): string {
  return SECTIONS.map(({ key, heading }) => {
    const value = parts[key].trim()
    return value ? `${heading}：\n${value}` : ''
  })
    .filter(Boolean)
    .join('\n\n')
}

export function parseSopGenerationBrief(value: string): SopGenerationBriefParts {
  const trimmed = value.trim()
  if (!trimmed) return { ...EMPTY_SOP_GENERATION_BRIEF }

  const parts = { ...EMPTY_SOP_GENERATION_BRIEF }
  const headingPattern = SECTIONS.map(({ heading }) => heading).join('|')
  const sectionPattern = new RegExp(`(?:^|\\n\\n)(${headingPattern})：\\n`, 'g')
  const matches = [...trimmed.matchAll(sectionPattern)]
  if (matches.length === 0) return { ...parts, goal: trimmed }

  matches.forEach((match, index) => {
    const section = SECTIONS.find(({ heading }) => heading === match[1])
    if (!section || match.index === undefined) return
    const contentStart = match.index + match[0].length
    const contentEnd = matches[index + 1]?.index ?? trimmed.length
    parts[section.key] = trimmed.slice(contentStart, contentEnd).trim()
  })
  return parts
}
