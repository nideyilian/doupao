export interface GeneratedImageFilenameSettings {
  imageFilenameDatePrefix: boolean
  imageFilenameUsePrompt: boolean
}

export interface GeneratedImageFilenameContext {
  createdAt: number
  label: string
  prompt: string
  batch: number
}

export function sanitizeGeneratedImageFilenamePart(value: string, maxLength?: number): string {
  const sanitized = value
    .trim()
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
  return typeof maxLength === 'number' ? sanitized.slice(0, maxLength) : sanitized
}

export function formatGeneratedImageDate(createdAt: number): string {
  const date = Number.isFinite(createdAt) ? new Date(createdAt) : new Date()
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = validDate.getFullYear()
  const month = String(validDate.getMonth() + 1).padStart(2, '0')
  const day = String(validDate.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function buildGeneratedImageFileNamePrefix(
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
): string {
  const parts: string[] = []
  if (settings.imageFilenameDatePrefix) {
    parts.push(formatGeneratedImageDate(context.createdAt))
  }
  parts.push(sanitizeGeneratedImageFilenamePart(context.label, 100) || 'image')
  parts.push(String(Math.max(1, Math.trunc(context.batch))))
  if (settings.imageFilenameUsePrompt) {
    const prompt = sanitizeGeneratedImageFilenamePart(context.prompt, 100)
    if (prompt) parts.push(prompt)
  }
  return parts.join('-')
}

export function buildGeneratedImageFileNameBase(
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
  sequence: number,
): string {
  return `${buildGeneratedImageFileNamePrefix(context, settings)}-${Math.max(1, Math.trunc(sequence))}`
}

export function findNextGeneratedImageSequence(
  fileNames: string[],
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
): number {
  const prefix = escapeRegExp(buildGeneratedImageFileNamePrefix(context, settings))
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.[^.]+$`, 'i')
  let maxSequence = 0
  for (const fileName of fileNames) {
    const match = fileName.match(pattern)
    if (!match) continue
    maxSequence = Math.max(maxSequence, Number.parseInt(match[1], 10))
  }
  return maxSequence + 1
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
