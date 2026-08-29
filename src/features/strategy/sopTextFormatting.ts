const STRUCTURAL_LINE = /^(?:#{1,6}(?!#)|[-*+]\s|\d+[.)、．]\s*|>\s|```|---+$)/
const SENTENCE_PARTS = /[^。！？!?；;\n]+[。！？!?；;]?/g

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, '\n')
}

function joinWrappedProse(lines: string[]) {
  return lines.reduce((result, line) => {
    const trimmed = line.trim()
    if (!trimmed) return result
    if (!result) return trimmed
    const needsSpace = /[A-Za-z0-9)]$/.test(result) && /^[A-Za-z0-9(]/.test(trimmed)
    return `${result}${needsSpace ? ' ' : ''}${trimmed}`
  }, '')
}

function splitLongParagraph(paragraph: string, targetLength: number) {
  if (paragraph.length <= targetLength) return [paragraph]
  const sentences = paragraph
    .match(SENTENCE_PARTS)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [paragraph]
  const sections: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current && current.length + sentence.length > targetLength) {
      sections.push(current)
      current = sentence
      continue
    }
    current += sentence
  }
  if (current) sections.push(current)
  return sections
}

export function cleanPastedSopText(value: string) {
  return normalizeLineEndings(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeSopNumbering(value: string) {
  let inCodeBlock = false
  return normalizeLineEndings(value)
    .split('\n')
    .map((line) => {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        return line.trimEnd()
      }
      if (inCodeBlock) return line
      return line
        .replace(/^(\s*)[•●▪◦]\s*/, '$1- ')
        .replace(/^(\s*)(\d+)[、．.)）]\s*/, '$1$2. ')
        .replace(/^(\s*)[-*+]\s+/, '$1- ')
    })
    .join('\n')
}

export function formatSopDocument(value: string) {
  let inCodeBlock = false
  const output: string[] = []
  const lines = normalizeSopNumbering(
    normalizeLineEndings(value)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' '),
  ).split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      output.push(line)
      continue
    }
    if (inCodeBlock) {
      output.push(rawLine)
      continue
    }
    const heading = trimmed.match(/^(#{1,6})(?!#)\s*(.+)$/)
    if (heading) {
      if (output.length > 0 && output.at(-1) !== '') output.push('')
      output.push(`${heading[1]} ${heading[2]}`)
      output.push('')
      continue
    }
    output.push(line.replace(/^[ \t]+/, ''))
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function autoParagraphSopText(value: string, targetLength = 150) {
  const source = cleanPastedSopText(value)
  if (!source) return ''
  const lines = source.split('\n')
  const output: string[] = []
  let proseBuffer: string[] = []
  let inCodeBlock = false

  const flushProse = () => {
    if (proseBuffer.length === 0) return
    const prose = joinWrappedProse(proseBuffer)
    const paragraphs = splitLongParagraph(prose, targetLength)
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) output.push('')
      output.push(paragraph)
    })
    proseBuffer = []
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed.startsWith('```')) {
      flushProse()
      inCodeBlock = !inCodeBlock
      output.push(rawLine)
      continue
    }
    if (inCodeBlock) {
      output.push(rawLine)
      continue
    }
    if (!trimmed) {
      flushProse()
      if (output.at(-1) !== '') output.push('')
      continue
    }
    if (STRUCTURAL_LINE.test(trimmed)) {
      flushProse()
      output.push(rawLine)
      continue
    }
    proseBuffer.push(rawLine)
  }
  flushProse()

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
