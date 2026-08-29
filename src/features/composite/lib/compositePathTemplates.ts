type TemplateVars = {
  date: string
  channel: string
  size: string
  preset: string
  index: number
  source: string
  sourceDir: string
  custom: string
}

type BuildPathInput = TemplateVars & {
  namingTemplate: string
  filenameTemplate: string
  customVariables?: Record<string, string>
  preserveSourceDir: boolean
}

// eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
const RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizePathSegment(value: string): string {
  const sanitized =
    value
      .replace(RESERVED_CHARS, '_')
      .trim()
      .replace(/[. ]+$/g, (match) => '_'.repeat(match.length)) || '_'
  const stem = sanitized.split('.')[0] ?? sanitized
  return WINDOWS_RESERVED_NAMES.test(stem) ? `_${sanitized}` : sanitized
}

export function resolveCompositeTemplate(
  template: string,
  vars: TemplateVars & { customVariables?: Record<string, string> },
): string {
  let result = template
    .replaceAll('{date}', vars.date)
    .replaceAll('{channel}', vars.channel)
    .replaceAll('{size}', vars.size)
    .replaceAll('{preset}', vars.preset)
    .replaceAll('{index}', String(vars.index))
    .replaceAll('{source}', vars.source)
    .replaceAll('{sourceDir}', vars.sourceDir)
    .replaceAll('{custom}', vars.custom)
  for (const [name, value] of Object.entries(vars.customVariables ?? {})) {
    result = result.replaceAll(`{${name}}`, value)
  }
  return result
}

/**
 * 从命名模板中移除 {index}（序号）字段，并清理由此产生的多余 "-" 分隔符。
 * 用于「文件夹命名完全跟随文件名模板、但不带序号」的场景。
 */
export function stripTemplateIndex(template: string): string {
  return template
    .replace(/{index}/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

function splitTemplatePath(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizePathSegment(/^\.+$/.test(part) ? '_' : part))
}

export function buildCompositeOutputPathParts(input: BuildPathInput) {
  const subfolders = splitTemplatePath(resolveCompositeTemplate(input.namingTemplate, input))
  if (input.preserveSourceDir && input.sourceDir) {
    subfolders.push(...splitTemplatePath(input.sourceDir))
  }
  const filenameStem = sanitizePathSegment(resolveCompositeTemplate(input.filenameTemplate, input))
  return {
    subfolders,
    filename: `${filenameStem}.jpg`,
  }
}

export function withCollisionSuffix(filename: string, suffix: number): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return `${filename}-${suffix}`
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`
}
