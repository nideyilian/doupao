import { allocateDirections, type BatchTaskInput } from './agentBatchPlanner'

export type BatchTaskField = 'sku' | 'product' | 'channel' | 'specification' | 'quantity' | 'directions'

export interface BatchTaskValidationIssue {
  rowIndex: number
  sourceId: string
  field: BatchTaskField
  message: string
}

const FIELD_LABELS: Record<BatchTaskField, string> = {
  sku: 'SKU',
  product: '产品',
  channel: '渠道',
  specification: '素材规格',
  quantity: '数量',
  directions: '方向',
}

function requiredIssue(rowIndex: number, task: BatchTaskInput, field: BatchTaskField) {
  return {
    rowIndex,
    sourceId: task.sourceId,
    field,
    message: `第 ${rowIndex + 1} 行「${FIELD_LABELS[field]}」不能为空`,
  }
}

export function validateBatchTaskRows(tasks: BatchTaskInput[]): BatchTaskValidationIssue[] {
  const issues: BatchTaskValidationIssue[] = []

  tasks.forEach((task, rowIndex) => {
    if (!task.sku.trim()) issues.push(requiredIssue(rowIndex, task, 'sku'))
    if (!task.product.trim()) issues.push(requiredIssue(rowIndex, task, 'product'))
    if (!task.channel.trim()) issues.push(requiredIssue(rowIndex, task, 'channel'))
    if (!task.specification.trim()) issues.push(requiredIssue(rowIndex, task, 'specification'))

    if (!Number.isFinite(task.quantity) || task.quantity <= 0 || !Number.isInteger(task.quantity)) {
      issues.push({
        rowIndex,
        sourceId: task.sourceId,
        field: 'quantity',
        message: `第 ${rowIndex + 1} 行「数量」必须是大于 0 的整数`,
      })
    }

    if (task.directions.length === 0) {
      issues.push(requiredIssue(rowIndex, task, 'directions'))
      return
    }

    if (task.directions.some((direction) => !direction.name.trim())) {
      issues.push({
        rowIndex,
        sourceId: task.sourceId,
        field: 'directions',
        message: `第 ${rowIndex + 1} 行「方向」包含空名称`,
      })
      return
    }

    if (Number.isFinite(task.quantity) && task.quantity > 0) {
      try {
        allocateDirections(Math.trunc(task.quantity), task.directions)
      } catch (reason) {
        issues.push({
          rowIndex,
          sourceId: task.sourceId,
          field: 'directions',
          message: `第 ${rowIndex + 1} 行「方向」无效：${reason instanceof Error ? reason.message : String(reason)}`,
        })
      }
    }
  })

  return issues
}

export function groupBatchValidationIssues(issues: BatchTaskValidationIssue[]) {
  const grouped = new Map<number, BatchTaskValidationIssue[]>()
  for (const issue of issues) {
    const rowIssues = grouped.get(issue.rowIndex) ?? []
    rowIssues.push(issue)
    grouped.set(issue.rowIndex, rowIssues)
  }
  return grouped
}
