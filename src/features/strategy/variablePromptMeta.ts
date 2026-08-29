import { parseVariablePrompt } from '../../lib/variablePrompt'
import type { SopVariableMeta } from './types'

/**
 * 变量提示词资产的可变项元数据增强层。
 *
 * 设计原则：模板正文（"可变项："区块）仍是唯一事实源，元数据只是增强层
 * （主题 theme / 类型 type / 衍生数量 count）。本模块提供：
 * - deriveVariableMetaFromContent：从正文推导默认元数据（旧资产迁移）
 * - normalizeVariableMeta：以正文为准合并存储的元数据
 * - replaceVariableOptions：把 AI 新选项确定性合并回正文（保证语法合法）
 * - updateVariableMeta：更新单个变量的参数
 */

/** 常用可变项类型预设；用户也可自由输入任意类型。 */
export const VARIABLE_TYPE_OPTIONS = [
  '实物',
  '文案联动',
  '场景',
  '叙事阶段',
  '结构',
  '风格',
  '人物',
  '动作',
  '背景',
  '比例',
  '镜头',
  '元素',
] as const

export const DEFAULT_VARIABLE_TYPE = '选项池'

export function isVariablePromptAsset(content: string) {
  return parseVariablePrompt(content).detected
}

/** 从模板正文推导每个可变项的默认元数据（旧资产缺省迁移用）。 */
export function deriveVariableMetaFromContent(content: string): SopVariableMeta[] {
  const parsed = parseVariablePrompt(content)
  return parsed.variables.map((variable) => ({
    name: variable.name,
    theme: '',
    type: DEFAULT_VARIABLE_TYPE,
    count: variable.options.length,
  }))
}

/**
 * 以正文解析结果为准，合并存储的元数据：
 * - 正文中的变量即使没有存储元数据也会补齐默认项；
 * - 已删除的变量的元数据会被丢弃；
 * - 存储的 theme/type 保留，count 以存储值为准（衍生目标），缺省回退正文选项数。
 */
export function normalizeVariableMeta(content: string, storedMeta?: SopVariableMeta[]): SopVariableMeta[] {
  const parsed = parseVariablePrompt(content)
  const storedByName = new Map((storedMeta ?? []).map((entry) => [entry.name, entry]))
  return parsed.variables.map((variable) => {
    const stored = storedByName.get(variable.name)
    return {
      name: variable.name,
      theme: stored?.theme?.trim() ?? '',
      type: stored?.type?.trim() || DEFAULT_VARIABLE_TYPE,
      count: Number.isFinite(stored?.count) && (stored?.count ?? 0) > 0 ? stored!.count : variable.options.length,
    }
  })
}

/** 更新单个变量的参数（不改动正文）。 */
export function updateVariableMeta(
  meta: SopVariableMeta[],
  variableName: string,
  patch: Partial<Pick<SopVariableMeta, 'theme' | 'type' | 'count'>>,
): SopVariableMeta[] {
  return meta.map((entry) => (entry.name === variableName ? { ...entry, ...patch } : entry))
}

/** 把指定变量的选项替换/合并回模板正文；其余行与正文保持逐字不变。 */
export function replaceVariableOptions(content: string, variableName: string, options: string[]): string {
  const parsed = parseVariablePrompt(content)
  if (!parsed.detected) throw new Error('模板中缺少“可变项：”区块')
  const definition = parsed.variables.find((variable) => variable.name === variableName)
  if (!definition) throw new Error(`模板中不存在变量「${variableName}」`)
  const uniqueOptions = [...new Set(options.map((option) => option.trim()).filter(Boolean))]
  if (uniqueOptions.length === 0) throw new Error(`变量「${variableName}」没有可用的新选项`)

  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const sectionIndex = lines.findIndex((line) => /^\s*可变项\s*[：:]\s*$/u.test(line.trim()))
  if (sectionIndex < 0) throw new Error('模板中缺少“可变项：”区块')

  const definitionLine = new RegExp(`^\\s*\\{\\{\\s*${escapeRegExp(variableName)}\\s*\\}\\}\\s*[：:]\\s*`, 'u')
  const targetIndex = lines.findIndex((line, index) => index > sectionIndex && definitionLine.test(line))
  if (targetIndex < 0) throw new Error(`模板中缺少变量「${variableName}」的定义行`)

  lines[targetIndex] = `{{${variableName}}}：${uniqueOptions.join(' / ')}`
  return lines.join('\n')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
