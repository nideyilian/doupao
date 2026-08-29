/**
 * 批量变量提示词引擎（移植自 doupao-liangnianban，MIT）。
 *
 * 语法：提示词正文 + 独立一行的「可变项：」定义块，每个变量单独一行：
 *   {{变量名}}：选项一 / 选项二 / 选项三
 *
 * parseVariablePrompt 负责解析与校验（格式错误会被拦截，避免 {{}} 裸奔进图片模型），
 * renderVariablePromptBatch 用确定性种子把模板展开成 N 条具体提示词（多样度优先）。
 */
export interface VariablePromptDefinition {
  name: string
  options: string[]
}

export interface VariablePromptParseResult {
  detected: boolean
  enabled: boolean
  body: string
  variables: VariablePromptDefinition[]
  errors: string[]
  warnings: string[]
  combinationCount: number
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
}

const VARIABLE_SECTION_LINE = /^\s*可变项\s*[：:]\s*$/u
const VARIABLE_DEFINITION_LINE = /^\s*\{\{\s*([^{}\r\n]+?)\s*\}\}\s*[：:]\s*(.*?)\s*$/u
const VARIABLE_MARKER = /\{\{\s*([^{}\r\n]+?)\s*\}\}/gu
const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9'])

function unique(values: string[]) {
  return [...new Set(values)]
}

function normalizeVariableName(value: string) {
  return value.trim()
}

function findAspectRatio(body: string): VariablePromptParseResult['aspectRatio'] {
  const match = body.match(
    /(?:图片|画面)比例为\s*[：:]?\s*(1\s*:\s*1|3\s*:\s*4|4\s*:\s*3|9\s*:\s*16|16\s*:\s*9)(?=$|[\s，,。；;])/u,
  )
  if (!match) return undefined
  const ratio = match[1].replace(/\s+/g, '')
  return SUPPORTED_ASPECT_RATIOS.has(ratio) ? (ratio as VariablePromptParseResult['aspectRatio']) : undefined
}

export function parseVariablePrompt(prompt: string): VariablePromptParseResult {
  const normalized = prompt.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const strictSectionIndex = lines.findIndex((line) => VARIABLE_SECTION_LINE.test(line))
  const candidateSectionIndex = lines.findIndex((line) => /^\s*可变项\s*[：:]/u.test(line))
  const sectionIndex = strictSectionIndex >= 0 ? strictSectionIndex : candidateSectionIndex
  const detected = sectionIndex >= 0
  const body = detected ? lines.slice(0, sectionIndex).join('\n').trim() : normalized.trim()
  const errors: string[] = []
  const warnings: string[] = []
  const definitions: VariablePromptDefinition[] = []

  if (!detected) {
    return {
      detected: false,
      enabled: false,
      body,
      variables: [],
      errors,
      warnings,
      combinationCount: 0,
    }
  }

  if (strictSectionIndex < 0) {
    errors.push('“可变项：”必须单独占一行，变量定义从下一行开始')
  }

  if (!body) errors.push('“可变项”前缺少提示词正文')
  const seenNames = new Set<string>()
  lines.slice(sectionIndex + 1).forEach((line, offset) => {
    if (!line.trim()) return
    const match = line.match(VARIABLE_DEFINITION_LINE)
    if (!match) {
      errors.push(`可变项第 ${offset + 1} 行格式不正确，每个变量必须单独占一行`)
      return
    }
    const name = normalizeVariableName(match[1])
    const options = unique(
      match[2]
        .split(/\s*[／/]\s*/u)
        .map((option) => option.trim())
        .filter(Boolean),
    )
    if (!name) {
      errors.push(`可变项第 ${offset + 1} 行缺少变量名`)
      return
    }
    if (seenNames.has(name)) {
      errors.push(`变量“${name}”重复定义`)
      return
    }
    if (options.length === 0) {
      errors.push(`变量“${name}”没有可用选项`)
      return
    }
    seenNames.add(name)
    definitions.push({ name, options })
  })

  if (definitions.length === 0) errors.push('“可变项”中没有可用的变量定义')

  const usedNames = unique([...body.matchAll(VARIABLE_MARKER)].map((match) => normalizeVariableName(match[1])))
  const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]))
  const missingNames = usedNames.filter((name) => !definitionByName.has(name))
  if (missingNames.length > 0) errors.push(`正文中的变量未定义：${missingNames.join('、')}`)

  const usedVariables = definitions.filter((definition) => usedNames.includes(definition.name))
  const unusedNames = definitions
    .filter((definition) => !usedNames.includes(definition.name))
    .map((definition) => definition.name)
  if (unusedNames.length > 0) warnings.push(`正文未使用，已忽略：${unusedNames.join('、')}`)
  if (usedVariables.length === 0) errors.push('提示词正文没有使用“可变项”中定义的变量')

  const combinationCount = usedVariables.reduce((count, definition) => {
    if (count >= Number.MAX_SAFE_INTEGER / definition.options.length) return Number.MAX_SAFE_INTEGER
    return count * definition.options.length
  }, 1)

  return {
    detected,
    enabled: errors.length === 0 && usedVariables.length > 0,
    body,
    variables: usedVariables,
    errors,
    warnings,
    combinationCount: usedVariables.length > 0 ? combinationCount : 0,
    aspectRatio: findAspectRatio(body),
  }
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function candidateIndexes(
  variables: VariablePromptDefinition[],
  seed: string,
  outputIndex: number,
  candidateIndex: number,
) {
  return variables.map((variable, variableIndex) => {
    if (candidateIndex === 0) {
      return (outputIndex + hashString(`${seed}:${variable.name}`)) % variable.options.length
    }
    return (
      hashString(`${seed}:${outputIndex}:${candidateIndex}:${variableIndex}:${variable.name}`) % variable.options.length
    )
  })
}

function hammingDistance(left: number[], right: number[]) {
  return left.reduce((distance, value, index) => distance + (value === right[index] ? 0 : 1), 0)
}

function chooseCombinations(variables: VariablePromptDefinition[], count: number, seed: string) {
  const selections: number[][] = []
  const used = new Set<string>()
  const usage = variables.map((variable) => new Array(variable.options.length).fill(0) as number[])
  const recentWindow = 8
  const candidateCount = Math.max(64, variables.length * 24)
  const totalCombinations = variables.reduce((total, variable) => {
    if (total >= Number.MAX_SAFE_INTEGER / variable.options.length) return Number.MAX_SAFE_INTEGER
    return total * variable.options.length
  }, 1)

  for (let outputIndex = 0; outputIndex < count; outputIndex++) {
    let best: number[] | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
      const candidate = candidateIndexes(variables, seed, outputIndex, candidateIndex)
      const key = candidate.join(':')
      // 组合未耗尽时禁止重复；耗尽后允许复用，但优先选与最近结果差异最大的组合
      if (used.size < totalCombinations && used.has(key)) continue
      const previous = selections.at(-1)
      const adjacentDistance = previous ? hammingDistance(candidate, previous) : variables.length
      const recent = selections.slice(-recentWindow)
      const nearestRecentDistance =
        recent.length > 0
          ? Math.min(...recent.map((selection) => hammingDistance(candidate, selection)))
          : variables.length
      const reusePenalty = used.has(key) ? 30 : 0
      const usagePenalty = candidate.reduce(
        (sum, optionIndex, variableIndex) => sum + usage[variableIndex][optionIndex],
        0,
      )
      const score =
        adjacentDistance * 100 + nearestRecentDistance * 20 - usagePenalty * 12 - reusePenalty - candidateIndex * 0.001
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }

    const selected = best ?? candidateIndexes(variables, seed, outputIndex, 0)
    selections.push(selected)
    used.add(selected.join(':'))
    selected.forEach((optionIndex, variableIndex) => {
      usage[variableIndex][optionIndex] += 1
    })
  }
  return selections
}

function renderBody(body: string, variables: VariablePromptDefinition[], selection: number[]) {
  const selectedByName = new Map(
    variables.map((variable, index) => [variable.name, variable.options[selection[index]]]),
  )
  return body
    .replace(VARIABLE_MARKER, (marker, rawName: string) => {
      return selectedByName.get(normalizeVariableName(rawName)) ?? marker
    })
    .trim()
}

export function renderVariablePromptBatch(prompt: string, count: number, seed = prompt) {
  const parsed = parseVariablePrompt(prompt)
  if (!parsed.enabled) return []
  const normalizedCount = Math.max(1, Math.trunc(count))
  return chooseCombinations(parsed.variables, normalizedCount, seed).map((selection) =>
    renderBody(parsed.body, parsed.variables, selection),
  )
}
