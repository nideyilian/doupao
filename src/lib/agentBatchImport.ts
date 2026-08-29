import { parseDirectionCell, type BatchTaskInput } from './agentBatchPlanner'

type RawRow = Record<string, unknown>

const HEADER_ALIASES = {
  sourceId: ['任务ID', '记录ID', 'ID', 'id'],
  date: ['日期', '需求日期', 'date'],
  sku: ['SKU', 'sku'],
  department: ['所属部门', '需求方', '部门'],
  owner: ['负责人', '制作人员'],
  product: ['产品', '产品名称'],
  channel: ['渠道'],
  specification: ['素材规格', '需求类型', '规格', '尺寸'],
  quantity: ['数量', '需求数量', '模板数量'],
  contact: ['对接人'],
  directions: ['方向', '创意方向', '内容方向'],
  strategy: ['生图策略', '生成策略', '策略'],
  copyRatio: ['有文案占比', '文案占比'],
  referenceFolder: ['参考图文件夹', '参考图目录', '参考图路径'],
  notes: ['备注说明（选填）', '备注说明', '备注'],
} as const

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

function getValue(row: RawRow, aliases: readonly string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
  for (const alias of aliases) {
    const value = normalized.get(normalizeHeader(alias))
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

function asText(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item)
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text ?? '')
        if (item && typeof item === 'object' && 'name' in item) return String((item as { name?: unknown }).name ?? '')
        return ''
      })
      .filter(Boolean)
      .join(';')
  }
  if (value && typeof value === 'object' && 'text' in value)
    return String((value as { text?: unknown }).text ?? '').trim()
  return value == null ? '' : String(value).trim()
}

function asNumber(value: unknown) {
  if (typeof value === 'number') return value
  const normalized = asText(value).replace(/,/g, '')
  if (!normalized) return NaN
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : NaN
}

function asRatio(value: unknown) {
  if (value === undefined) return undefined
  const text = asText(value)
  const numeric = asNumber(text.replace(/%$/, ''))
  if (!Number.isFinite(numeric)) return undefined
  return text.endsWith('%') || numeric > 1 ? numeric / 100 : numeric
}

function excelDateToDateKey(value: number) {
  const epoch = new Date(1899, 11, 30)
  epoch.setDate(epoch.getDate() + Math.trunc(value))
  const year = epoch.getFullYear()
  const month = String(epoch.getMonth() + 1).padStart(2, '0')
  const day = String(epoch.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function asDate(value: unknown) {
  if (typeof value === 'number' && value > 20_000 && value < 100_000) return excelDateToDateKey(value)
  const text = asText(value)
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (!match) return text || undefined
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function normalizeDirections(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return parseDirectionCell(item)
      if (!item || typeof item !== 'object') return []
      const direction = item as Record<string, unknown>
      const name = asText(direction.name ?? direction['方向'])
      if (!name) return []
      const count = asNumber(direction.count ?? direction['数量'])
      const weight = asNumber(direction.weight ?? direction['占比'])
      return [
        {
          name,
          ...(Number.isFinite(count) ? { count } : {}),
          ...(Number.isFinite(weight) ? { weight: weight > 1 ? weight : weight * 100 } : {}),
          strategy: asText(direction.strategy ?? direction['生图策略']) || undefined,
          copyRatio: asRatio(direction.copyRatio ?? direction['文案占比']),
          referenceFolder: asText(direction.referenceFolder ?? direction['参考图文件夹']) || undefined,
        },
      ]
    })
  }
  return parseDirectionCell(asText(value))
}

export function normalizeBatchTaskRows(rows: RawRow[]): BatchTaskInput[] {
  return rows.map((row, index) => {
    const directions = normalizeDirections(getValue(row, HEADER_ALIASES.directions))
    return {
      sourceId: asText(getValue(row, HEADER_ALIASES.sourceId)) || `row-${index + 1}`,
      date: asDate(getValue(row, HEADER_ALIASES.date)),
      sku: asText(getValue(row, HEADER_ALIASES.sku)),
      department: asText(getValue(row, HEADER_ALIASES.department)) || undefined,
      owner: asText(getValue(row, HEADER_ALIASES.owner)) || undefined,
      product: asText(getValue(row, HEADER_ALIASES.product)),
      channel: asText(getValue(row, HEADER_ALIASES.channel)),
      specification: asText(getValue(row, HEADER_ALIASES.specification)),
      quantity: asNumber(getValue(row, HEADER_ALIASES.quantity)),
      contact: asText(getValue(row, HEADER_ALIASES.contact)) || undefined,
      directions,
      strategy: asText(getValue(row, HEADER_ALIASES.strategy)) || undefined,
      copyRatio: asRatio(getValue(row, HEADER_ALIASES.copyRatio)),
      referenceFolder: asText(getValue(row, HEADER_ALIASES.referenceFolder)) || undefined,
      notes: asText(getValue(row, HEADER_ALIASES.notes)) || undefined,
    }
  })
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  row.push(field.replace(/\r$/, ''))
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function parseBatchTaskFile(text: string, extension: string): BatchTaskInput[] {
  const normalizedExtension = extension.toLowerCase().replace(/^\./, '')
  let rows: RawRow[]
  if (normalizedExtension === 'json') {
    const parsed = JSON.parse(text) as unknown
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown[] }).records)
        ? (parsed as { records: unknown[] }).records
        : null
    if (!items) throw new Error('JSON must be an array or an object with a records array')
    rows = items.filter((item): item is RawRow => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  } else {
    const [headers, ...dataRows] = parseCsv(text)
    if (!headers) return []
    rows = dataRows.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ''])),
    )
  }
  return normalizeBatchTaskRows(rows)
}
