import { strToU8, zipSync } from 'fflate'
import type { TaskRecord } from '../../types'
import { joinPath } from '../../lib/localSave'
import type { RequirementCatalog, RequirementOrder } from './types'

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtml(value: unknown) {
  return escapeXml(value)
}

function buildXlsx(rows: Array<Array<string | number>>) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          let column = ''
          let number = columnIndex + 1
          while (number > 0) {
            const remainder = (number - 1) % 26
            column = String.fromCharCode(65 + remainder) + column
            number = Math.floor((number - 1) / 26)
          }
          const ref = `${column}${rowIndex + 1}`
          return typeof value === 'number'
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="生成概览" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  }
  return zipSync(files, { level: 6 })
}

export async function writeRequirementManifests(
  order: RequirementOrder,
  catalog: RequirementCatalog,
  tasks: TaskRecord[],
) {
  const api = window.electronAPI
  if (!api?.saveText || !api.saveJson || !api.saveZipBuffer) return false
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const productById = new Map(catalog.products.map((item) => [item.id, item.name]))
  const channelById = new Map(catalog.channels.map((item) => [item.id, item.name]))
  const typeById = new Map(catalog.materialTypes.map((item) => [item.id, item.name]))
  const rows = order.units.map((unit) => {
    const task = unit.taskId ? taskById.get(unit.taskId) : undefined
    return {
      订单号: order.number,
      产品: productById.get(unit.productId) ?? unit.productId,
      渠道: channelById.get(unit.channelId) ?? unit.channelId,
      尺寸: unit.ratio,
      素材类型: typeById.get(unit.materialTypeId) ?? unit.materialTypeId,
      计划数量: unit.quantity,
      成功数量: task?.outputImages?.length ?? 0,
      状态: unit.status,
      错误: unit.error ?? '',
      保存目录: task?.scheduledOutputPath ?? '',
      提示词: unit.prompt,
    }
  })
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    order: {
      id: order.id,
      number: order.number,
      createdBy: order.createdByName,
      createdAt: new Date(order.createdAt).toISOString(),
      status: order.status,
      totalImages: order.totalImages,
      completedImages: order.completedImages,
      failedImages: order.failedImages,
      urgentRequested: order.urgentRequested,
      urgentApproved: order.urgentApproved,
      excluded: order.excluded,
    },
    units: rows,
  }
  const htmlRows = rows
    .map(
      (row) =>
        `<tr>${Object.values(row)
          .slice(0, 10)
          .map((value) => `<td>${escapeHtml(value)}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(order.number)} 生成概览</title><style>body{font-family:Segoe UI,Microsoft YaHei,sans-serif;margin:32px;color:#172033}h1{font-size:24px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d9dee8;padding:8px;text-align:left}th{background:#f4f7fb}.summary{display:flex;gap:24px;margin:20px 0}.summary b{font-size:20px;color:#2563eb}</style></head><body><h1>${escapeHtml(order.number)} 生成概览</h1><div class="summary"><span>计划 <b>${order.totalImages}</b> 张</span><span>完成 <b>${order.completedImages}</b> 张</span><span>失败 <b>${order.failedImages}</b> 张</span></div><table><thead><tr>${['订单号', '产品', '渠道', '尺寸', '素材类型', '计划数量', '成功数量', '状态', '错误', '保存目录'].map((item) => `<th>${item}</th>`).join('')}</tr></thead><tbody>${htmlRows}</tbody></table></body></html>`
  const xlsxRows: Array<Array<string | number>> = [
    ['订单号', '产品', '渠道', '尺寸', '素材类型', '计划数量', '成功数量', '状态', '错误', '保存目录', '提示词'],
    ...rows.map((row) => Object.values(row)),
  ]
  const xlsx = buildXlsx(xlsxRows)
  const outputPaths = [
    ...new Set(
      order.units
        .map((unit) => (unit.taskId ? taskById.get(unit.taskId)?.scheduledOutputPath : undefined))
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  if (outputPaths.length === 0) return false
  await Promise.all(
    outputPaths.map(async (outputPath) => {
      await api.ensureDir(outputPath)
      const jsonPath = await joinPath(outputPath, `${order.number}-manifest.json`)
      const htmlPath = await joinPath(outputPath, `${order.number}-overview.html`)
      const xlsxPath = await joinPath(outputPath, `${order.number}-manifest.xlsx`)
      await Promise.all([
        api.saveJson(jsonPath, payload),
        api.saveText(htmlPath, html),
        api.saveZipBuffer(
          xlsxPath,
          xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer,
        ),
      ])
    }),
  )
  return true
}
