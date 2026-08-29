import {
  IMAGE_GENERATION_STRATEGY_META_PRESET,
  IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
  PROMPT_REVERSE_SOP_META_PRESET,
  SOP_GENERATOR_META_PRESET,
} from './sopGeneration'
import type { SopGroup, SopLibraryItem, SopMetaInstruction } from './types'

export function seedSopGroups(): SopGroup[] {
  const now = Date.now()
  return [
    { id: 'sop-group-general', name: '通用 SOP', createdAt: now, updatedAt: now },
    { id: 'sop-group-image', name: '图片提示词 SOP', createdAt: now, updatedAt: now },
  ]
}

/**
 * 首次启动的 SOP 库种子：直接内置一个通用合规 SOP。
 * 历史版本曾从旧「SOP 预设」（StrategyPreset.type === 'sop'）迁移生成，该预设体系已移除；
 * 已持久化的旧数据不受影响（迁移仅在库为空时执行）。
 */
export function seedSopLibrary(): SopLibraryItem[] {
  const now = Date.now()
  return [
    {
      id: 'preset-sop-compliance',
      groupId: 'sop-group-general',
      name: '信息流合规基础 SOP',
      description: '统一约束信息层级、真实性与平台合规。',
      content:
        '先确认产品事实与渠道禁用项，再确定单一传播目标；画面信息不超过三层，不伪造系统界面、通知、中奖或权威背书；批量结果必须主动改变构图、场景和视觉焦点。',
      source: 'manual',
      createdBy: 'user-admin',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function seedSopMetaInstructions(): SopMetaInstruction[] {
  const now = Date.now()
  return [
    {
      id: 'sop-meta-general',
      name: SOP_GENERATOR_META_PRESET.name,
      description: SOP_GENERATOR_META_PRESET.description,
      instruction: SOP_GENERATOR_META_PRESET.instruction,
      kind: 'general',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-prompt-reverse',
      name: PROMPT_REVERSE_SOP_META_PRESET.name,
      description: PROMPT_REVERSE_SOP_META_PRESET.description,
      instruction: PROMPT_REVERSE_SOP_META_PRESET.instruction,
      kind: 'prompt-reverse',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-image-prompt',
      name: '图片画风多变体 SOP 编译器',
      description: '根据画风参考图生成多变体中文绘图提示词直出型 SOP。',
      instruction: IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
      kind: 'image-prompt',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-extract-image-generation-strategies-1',
      name: IMAGE_GENERATION_STRATEGY_META_PRESET.name,
      description: IMAGE_GENERATION_STRATEGY_META_PRESET.description,
      instruction: IMAGE_GENERATION_STRATEGY_META_PRESET.instruction,
      kind: 'image-prompt',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function mergeSopMetaInstructions(items: SopMetaInstruction[] | undefined): SopMetaInstruction[] {
  if (!items?.length) return seedSopMetaInstructions()
  const current = items
  const existingIds = new Set(current.map((item) => item.id))
  const requiredIds = new Set(['sop-meta-prompt-reverse', 'sop-meta-extract-image-generation-strategies-1'])
  return [
    ...current,
    ...seedSopMetaInstructions().filter((item) => requiredIds.has(item.id) && !existingIds.has(item.id)),
  ]
}

export function sopLibraryId(prefix: 'group' | 'sop' | 'meta') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
