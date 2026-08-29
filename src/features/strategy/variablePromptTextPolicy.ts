import { parseVariablePrompt } from '../../lib/variablePrompt'

export const EXCLUDE_TEXT_SKILL_INSTRUCTION = `本次已开启“排除文字”。只提取主体、场景、结构、构图、镜头、材质、光影和视觉关系，不分析、不保留、不改写参考图中的任何文案，也不提取文案排版。最终 variablePrompt 中禁止出现文案、文字、标题、副标题、卖点、价格、参数、配料、标签、OCR、Logo、二维码、文字区或文案区相关变量；这些内容不得进入任何变量选项。正文必须明确要求忽略参考图中的全部文字和文字排版，生成纯视觉画面，不预留文案区或文字安全区。`

export const KEEP_TEXT_SKILL_INSTRUCTION = `本次已关闭“排除文字”。不要套用纯视觉任务的默认文字排除规则；如果参考图包含有意设计且业务需要的文字，请按当前技能规则决定保留、替换或绑定。需要精确文案与主体对应时，优先使用带文案策略技能和主体文案包。`

const FORBIDDEN_VARIABLE_NAME =
  /文案|文字|标题|副标题|卖点|价格|价签|配料|参数|信息列表|标签|品牌|logo|二维码|ocr|文字区|文案区/iu
const FORBIDDEN_OPTION_CONTENT =
  /文案|文字|标题|副标题|卖点|价格|价签|配料|参数|信息列表|标签|品牌|copy_schema|subject_copy_binding|OCR|Logo|二维码|文字区|文案区/iu
const EXCLUDE_TEXT_CLAUSE =
  '忽略参考图中的所有文字与文案排版，不生成任何文字、字母、数字、Logo、水印、二维码、标题、标签、按钮或仿按钮控件，不预留文案区或文字安全区。'

export function applyVariablePromptTextPolicy(prompt: string, excludeText: boolean) {
  if (!excludeText) return prompt
  const parsed = parseVariablePrompt(prompt)
  if (!parsed.enabled) return prompt
  const forbiddenVariable = parsed.variables.find((variable) => FORBIDDEN_VARIABLE_NAME.test(variable.name))
  if (forbiddenVariable) {
    throw new Error(`开启“排除文字”后不能生成变量“${forbiddenVariable.name}”`)
  }
  const forbiddenOption = parsed.variables.find((variable) =>
    variable.options.some((option) => FORBIDDEN_OPTION_CONTENT.test(option)),
  )
  if (forbiddenOption) {
    throw new Error(`开启“排除文字”后，变量“${forbiddenOption.name}”中不能包含文案或文字排版内容`)
  }
  if (parsed.body.includes(EXCLUDE_TEXT_CLAUSE)) return prompt
  const normalized = prompt.replace(/\r\n?/g, '\n')
  const sectionMatch = normalized.match(/^\s*可变项\s*[：:]\s*$/mu)
  if (!sectionMatch || sectionMatch.index === undefined) return prompt
  const body = normalized.slice(0, sectionMatch.index).trimEnd()
  const variableSection = normalized.slice(sectionMatch.index).trimStart()
  return `${body}${/[。！？!?]$/u.test(body) ? '' : '。'}${EXCLUDE_TEXT_CLAUSE}\n\n${variableSection}`
}
