export type BatchExecutionMode = 'balanced' | 'task-first'
export type CopyMode = 'with-copy' | 'without-copy'
export type BatchCopyChoice = 'without-copy' | 'with-copy' | 'derived-copy' | 'mixed'

export interface BatchDirectionInput {
  name: string
  weight?: number
  count?: number
  strategy?: string
  copyRatio?: number
  copyChoice?: BatchCopyChoice
  referenceFolder?: string
}

export interface BatchTaskInput {
  sourceId: string
  date?: string
  sku: string
  department?: string
  owner?: string
  product: string
  channel: string
  specification: string
  quantity: number
  contact?: string
  directions: BatchDirectionInput[]
  strategy?: string
  copyRatio?: number
  copyChoice?: BatchCopyChoice
  referenceFolder?: string
  notes?: string
}

export interface BatchPlannerOptions {
  startDate: string
  dailyLimit: number
  redundancyRate: number
  defaultCopyRatio: number
  executionMode: BatchExecutionMode
  outputRoot: string
  referenceRoot?: string
}

export interface PlannedBatchUnit {
  id: string
  sourceId: string
  date: string
  sku: string
  department?: string
  owner?: string
  product: string
  channel: string
  specification: string
  direction: string
  strategy: string
  copyMode: CopyMode
  targetCount: number
  plannedCount: number
  referenceFolder?: string
  outputFolder: string
  prompt: string
}

export interface PlannedBatchDay {
  date: string
  plannedCount: number
  units: PlannedBatchUnit[]
}

export interface AgentBatchPlan {
  targetCount: number
  plannedCount: number
  redundancyCount: number
  days: PlannedBatchDay[]
}

// eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
const INVALID_PATH_CHARS = /[<>:"/\\|?*\x00-\x1f]+/g

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function positiveInteger(value: number, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : fallback
}

function sanitizePathPart(value: string, fallback: string) {
  return value.trim().replace(INVALID_PATH_CHARS, '-').replace(/\s+/g, ' ').slice(0, 100) || fallback
}

function joinPath(parts: string[]) {
  const root = parts[0] ?? ''
  const separator = root.includes('\\') ? '\\' : '/'
  return parts
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/g, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(separator)
}

function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`Invalid start date: ${value}`)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new Error(`Invalid start date: ${value}`)
  }
  return date
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateKey: string, offset: number) {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + offset)
  return formatDateKey(date)
}

export function allocateInteger(total: number, weights: number[]): number[] {
  const normalizedTotal = Math.max(0, Math.trunc(total))
  if (weights.length === 0) return []
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0)
  const effectiveWeights = weightSum > 0 ? safeWeights : safeWeights.map(() => 1)
  const effectiveSum = effectiveWeights.reduce((sum, weight) => sum + weight, 0)
  const raw = effectiveWeights.map((weight) => (normalizedTotal * weight) / effectiveSum)
  const result = raw.map(Math.floor)
  const remaining = normalizedTotal - result.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; i < remaining; i += 1) result[order[i % order.length].index] += 1
  return result
}

export function allocateDirections(quantity: number, directions: BatchDirectionInput[]) {
  const total = Math.max(0, Math.trunc(quantity))
  if (directions.length === 0) return []
  const fixed = directions.map((direction) => Math.max(0, Math.trunc(direction.count ?? 0)))
  const fixedTotal = fixed.reduce((sum, value) => sum + value, 0)
  if (fixedTotal > total) throw new Error('Direction counts exceed task quantity')
  const flexibleIndexes = directions.flatMap((direction, index) => (direction.count == null ? [index] : []))
  const result = [...fixed]
  const remaining = total - fixedTotal
  if (remaining > 0 && flexibleIndexes.length === 0) throw new Error('Direction counts do not cover task quantity')
  if (flexibleIndexes.length > 0) {
    const allocated = allocateInteger(
      remaining,
      flexibleIndexes.map((index) => directions[index].weight ?? 1),
    )
    flexibleIndexes.forEach((directionIndex, index) => {
      result[directionIndex] = allocated[index]
    })
  }
  return result
}

function buildReferenceFolder(options: BatchPlannerOptions) {
  // Reference images are a workspace-level optional capability. A selected
  // directory applies to the whole frozen plan, so row data cannot silently
  // point a task at a different folder.
  return options.referenceRoot?.trim() || undefined
}

function buildOutputFolder(task: BatchTaskInput, direction: string, copyMode: CopyMode, options: BatchPlannerOptions) {
  return joinPath([
    options.outputRoot,
    sanitizePathPart(task.sku, 'sku'),
    sanitizePathPart(task.product, 'product'),
    sanitizePathPart(task.channel, 'channel'),
    sanitizePathPart(task.specification, 'specification'),
    sanitizePathPart(direction, 'direction'),
    copyMode === 'with-copy' ? '有文案' : '无文案',
  ])
}

function buildPrompt(task: BatchTaskInput, direction: BatchDirectionInput, strategy: string, copyMode: CopyMode) {
  const copyInstruction =
    copyMode === 'with-copy'
      ? '画面需要包含与卖点匹配、清晰可读的中文营销文案，并预留安全边距。'
      : '只生成纯视觉画面，禁止出现文字、字母、数字、水印、Logo 或伪文字。'
  return [
    `为「${task.product}」制作适用于${task.channel}的${task.specification}商业素材。`,
    `创意方向：${direction.name}。`,
    `生图策略：${strategy}。`,
    copyInstruction,
    task.notes ? `补充要求：${task.notes}` : '',
    '同一方向内保持核心视觉语言一致，但主体动作、构图、场景细节和功能符号应有足够变化，避免近重复。',
  ]
    .filter(Boolean)
    .join('\n')
}

function createUnitsForTask(task: BatchTaskInput, options: BatchPlannerOptions): PlannedBatchUnit[] {
  const directionCounts = allocateDirections(task.quantity, task.directions)
  const units: PlannedBatchUnit[] = []
  task.directions.forEach((direction, directionIndex) => {
    const directionTarget = directionCounts[directionIndex]
    if (directionTarget <= 0) return
    const copyRatio =
      task.copyChoice === 'without-copy'
        ? 0
        : task.copyChoice === 'with-copy' || task.copyChoice === 'derived-copy'
          ? 1
          : clamp01(direction.copyRatio ?? task.copyRatio ?? options.defaultCopyRatio)
    const copyCounts = allocateInteger(directionTarget, [copyRatio, 1 - copyRatio])
    const referenceFolder = buildReferenceFolder(options)
    const strategy =
      direction.strategy?.trim() ||
      task.strategy?.trim() ||
      (referenceFolder
        ? '参考图风格提取后做同风格差异化衍生'
        : '根据产品、渠道、素材规格和创意方向生成差异化商业视觉素材')
    ;(['with-copy', 'without-copy'] as const).forEach((copyMode, copyIndex) => {
      const targetCount = copyCounts[copyIndex]
      if (targetCount <= 0) return
      units.push({
        id: `${sanitizePathPart(task.sourceId, 'task')}-${directionIndex + 1}-${copyMode}`,
        sourceId: task.sourceId,
        date: options.startDate,
        sku: task.sku,
        department: task.department,
        owner: task.owner,
        product: task.product,
        channel: task.channel,
        specification: task.specification,
        direction: direction.name,
        strategy,
        copyMode,
        targetCount,
        plannedCount: targetCount,
        referenceFolder,
        outputFolder: buildOutputFolder(task, direction.name, copyMode, options),
        prompt: buildPrompt(task, direction, strategy, copyMode),
      })
    })
  })
  return units
}

function splitChoices(value: string) {
  return value
    .split(/[、,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function expandTaskCombinations(task: BatchTaskInput) {
  const channels = splitChoices(task.channel)
  const specifications = splitChoices(task.specification)
  return channels.flatMap((channel, channelIndex) =>
    specifications.map((specification, specificationIndex) => ({
      ...task,
      sourceId: `${task.sourceId}-c${channelIndex + 1}-s${specificationIndex + 1}`,
      channel,
      specification,
    })),
  )
}

function splitUnitsByDailyLimit(units: PlannedBatchUnit[], options: BatchPlannerOptions) {
  const dailyLimit = positiveInteger(options.dailyLimit)
  const queue =
    options.executionMode === 'task-first'
      ? units
      : units.slice().sort((a, b) => b.plannedCount - a.plannedCount || a.id.localeCompare(b.id))
  const days: PlannedBatchDay[] = []
  let dayIndex = 0
  let day: PlannedBatchDay = { date: options.startDate, plannedCount: 0, units: [] }

  const pushDay = () => {
    if (day.units.length > 0) days.push(day)
    dayIndex += 1
    day = { date: addDays(options.startDate, dayIndex), plannedCount: 0, units: [] }
  }

  for (const unit of queue) {
    let remainingPlanned = unit.plannedCount
    let remainingTarget = unit.targetCount
    let chunkIndex = 0
    while (remainingPlanned > 0) {
      if (day.plannedCount >= dailyLimit) pushDay()
      const capacity = dailyLimit - day.plannedCount
      const plannedCount = Math.min(capacity, remainingPlanned)
      const isLastChunk = plannedCount === remainingPlanned
      const targetCount = isLastChunk
        ? remainingTarget
        : Math.min(remainingTarget, Math.floor((unit.targetCount * plannedCount) / unit.plannedCount))
      chunkIndex += 1
      day.units.push({
        ...unit,
        id: `${unit.id}-day-${dayIndex + 1}-chunk-${chunkIndex}`,
        date: day.date,
        plannedCount,
        targetCount,
      })
      day.plannedCount += plannedCount
      remainingPlanned -= plannedCount
      remainingTarget -= targetCount
    }
  }
  if (day.units.length > 0) days.push(day)
  return days
}

export function createAgentBatchPlan(tasks: BatchTaskInput[], options: BatchPlannerOptions): AgentBatchPlan {
  if (!options.outputRoot.trim()) throw new Error('Output root is required')
  parseDateKey(options.startDate)
  const normalizedTasks = tasks.map((task, index) => {
    const missing = [
      !task.sku.trim() ? 'SKU' : '',
      !task.product.trim() ? '产品' : '',
      !task.channel.trim() ? '渠道' : '',
      !task.specification.trim() ? '素材规格' : '',
    ].filter(Boolean)
    if (missing.length > 0) throw new Error(`第 ${index + 1} 行缺少：${missing.join('、')}`)
    if (!Number.isFinite(task.quantity) || task.quantity <= 0 || !Number.isInteger(task.quantity)) {
      throw new Error(`第 ${index + 1} 行「数量」必须是大于 0 的整数`)
    }
    if (task.directions.length === 0) throw new Error(`第 ${index + 1} 行「方向」不能为空`)
    return { ...task, quantity: Math.trunc(task.quantity) }
  })
  const expandedTasks = normalizedTasks.flatMap(expandTaskCombinations)
  const units = expandedTasks.flatMap((task) => createUnitsForTask(task, options))
  const targetCount = expandedTasks.reduce((sum, task) => sum + task.quantity, 0)
  const plannedTotal = targetCount + Math.ceil(targetCount * Math.max(0, options.redundancyRate))
  const plannedCounts = allocateInteger(
    plannedTotal,
    units.map((unit) => unit.targetCount),
  )
  units.forEach((unit, index) => {
    unit.plannedCount = plannedCounts[index]
  })
  const days = splitUnitsByDailyLimit(units, options)
  const plannedCount = days.reduce((sum, day) => sum + day.plannedCount, 0)
  return { targetCount, plannedCount, redundancyCount: plannedCount - targetCount, days }
}

export function parseDirectionCell(value: string): BatchDirectionInput[] {
  return value
    .split(/[\n;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const countMatch = item.match(/^(.*?)[=:：]\s*(\d+)\s*张?$/)
      if (countMatch) return { name: countMatch[1].trim(), count: Number(countMatch[2]) }
      const percentMatch = item.match(/^(.*?)[=:：]\s*(\d+(?:\.\d+)?)\s*%$/)
      if (percentMatch) return { name: percentMatch[1].trim(), weight: Number(percentMatch[2]) }
      return { name: item, weight: 1 }
    })
}
