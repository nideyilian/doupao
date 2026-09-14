export interface VisualSkillDimension {
  dimension: string
  chinese: string
  english: string
  locked: boolean
  deriveEnabled: boolean
  deriveDirection: string
}

export interface VisualSkill {
  id: string
  name: string
  description: string
  sourceImageIds: string[]
  createdAt: number
  updatedAt: number
  visualAnalysis: Record<string, string>
  preservedRules: string[]
  replaceableElements: string[]
  textRules: string[]
  chinesePromptTemplate: string
  englishPromptTemplate: string
  keywordTable: VisualSkillDimension[]
}

const STORAGE_KEY = 'doupao.visual-skills.v1'

export function getReferenceStyleThemes(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readVisualSkills(): VisualSkill[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((skill): skill is VisualSkill => {
      return Boolean(
        skill &&
        typeof skill === 'object' &&
        typeof skill.name === 'string' &&
        typeof skill.chinesePromptTemplate === 'string' &&
        typeof skill.englishPromptTemplate === 'string',
      )
    })
  } catch {
    return []
  }
}

export function writeVisualSkills(skills: VisualSkill[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
}

export function updateVisualSkill(skills: VisualSkill[], skillId: string, patch: Partial<VisualSkill>): VisualSkill[] {
  return skills.map((skill) => (skill.id === skillId ? { ...skill, ...patch, updatedAt: Date.now() } : skill))
}

export function buildVisualSkillPrompts(skill: VisualSkill, theme: string) {
  const value = theme.trim()
  if (!skill.chinesePromptTemplate.trim() || !skill.englishPromptTemplate.trim()) {
    throw new Error(`视觉 Skill「${skill.name}」缺少中英文提示词模板，请重新创建 Skill`)
  }
  return {
    chinese: skill.chinesePromptTemplate.replaceAll('{theme}', value),
    english: skill.englishPromptTemplate.replaceAll('{theme}', value),
  }
}

export function buildVisualSkillBatchPrompt(
  skill: VisualSkill,
  themes: string[],
  totalCount: number,
  directions: Record<string, string> = {},
) {
  if (themes.length === 0) throw new Error('请输入至少一个主题')
  if (totalCount < themes.length || totalCount % themes.length !== 0) {
    throw new Error(`总数量必须能被主题数 ${themes.length} 整除，且每个主题至少生成 1 张`)
  }
  const countPerTheme = totalCount / themes.length
  const fixedRules = skill.keywordTable
    .map((item) => {
      if (!item.deriveEnabled) return `${item.dimension}: preserve ${item.english}`
      const direction = directions[item.dimension]?.trim() || item.deriveDirection.trim()
      return `${item.dimension}: ${direction || 'derive naturally from the theme'}`
    })
    .join('; ')
  const items = themes.map((theme, index) => `${index + 1}. ${theme} (${countPerTheme} images)`).join('\n')
  return {
    countPerTheme,
    themes,
    prompts: themes.map((theme) => ({ theme, ...buildVisualSkillPrompts(skill, theme) })),
    prompt: [
      `Use visual Skill "${skill.name}" to generate exactly ${totalCount} images in one batch.`,
      `There are ${themes.length} independent themes. Generate exactly ${countPerTheme} images for each theme. Do not combine themes in one image.`,
      `Apply these shared visual rules to every image: ${fixedRules}`,
      'Each output image must depict exactly one theme from the list below while keeping the shared visual style consistent.',
      '',
      items,
    ].join('\n'),
  }
}

export function parseVisualSkill(text: string, sourceImageIds: string[]): VisualSkill {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = JSON.parse(trimmed) as Partial<VisualSkill>
  const now = Date.now()
  return {
    id: `visual-skill-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(parsed.name ?? '未命名视觉 Skill'),
    description: String(parsed.description ?? ''),
    sourceImageIds,
    createdAt: now,
    updatedAt: now,
    visualAnalysis: parsed.visualAnalysis && typeof parsed.visualAnalysis === 'object' ? parsed.visualAnalysis : {},
    preservedRules: Array.isArray(parsed.preservedRules) ? parsed.preservedRules.map(String) : [],
    replaceableElements: Array.isArray(parsed.replaceableElements) ? parsed.replaceableElements.map(String) : [],
    textRules: Array.isArray(parsed.textRules) ? parsed.textRules.map(String) : [],
    chinesePromptTemplate: String(parsed.chinesePromptTemplate ?? ''),
    englishPromptTemplate: String(parsed.englishPromptTemplate ?? ''),
    keywordTable: Array.isArray(parsed.keywordTable)
      ? parsed.keywordTable.map((item) => ({
          dimension: String(item.dimension ?? ''),
          chinese: String(item.chinese ?? ''),
          english: String(item.english ?? ''),
          locked: item.locked !== false,
          deriveEnabled: item.deriveEnabled === true || item.locked === false,
          deriveDirection: String(item.deriveDirection ?? ''),
        }))
      : [],
  }
}
