import type {
  StrategyAsset,
  StrategyFlowStep,
  StrategyGenerationMode,
  StrategyOutputs,
  StrategyPreset,
  StrategyPresetType,
  StrategyReferenceConfig,
  StrategyWorkflow,
} from './types'
import type {
  StrategyCatalog as RequirementCatalog,
  StrategyCatalogMaterialType as CatalogMaterialType,
} from './contracts'

type LegacyStrategyStep = {
  kind?: string
  label?: string
  value?: string
  sourceType?: string
  referenceImageIds?: string[]
}

type LegacyStrategyAsset = Omit<Partial<StrategyAsset>, 'generationMode' | 'workflow' | 'outputs'> & {
  generationMode?: StrategyGenerationMode | 'sop' | null
  workflow?: Partial<StrategyWorkflow>
  outputs?: Partial<StrategyOutputs>
  steps?: LegacyStrategyStep[]
  promptTemplate?: string
  sop?: string
  channelIds?: string[]
  ratios?: Array<'16:9' | '9:16'>
  exportPresetId?: string
  allocationPresetId?: string
}

export type StrategyCoreStage = 'sop' | 'ready'

export function strategyId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyOutputs(): StrategyOutputs {
  return {
    channels: { enabled: false, channelIds: [] },
    sizes: { enabled: false, ratios: [] },
    export: { enabled: false },
    allocation: { enabled: false },
  }
}

function normalizeReference(input: LegacyStrategyAsset): StrategyReferenceConfig | undefined {
  const workflowReference = input.workflow?.reference
  if (workflowReference?.source && workflowReference.imageIds?.length) {
    return {
      source: workflowReference.source,
      label: workflowReference.label ?? '参考素材',
      value: workflowReference.value ?? workflowReference.imageIds[0],
      imageIds: [...workflowReference.imageIds],
    }
  }
  const legacyReference = input.steps?.find((step) => step.kind === 'reference' && step.referenceImageIds?.length)
  if (!legacyReference?.referenceImageIds?.length) return undefined
  const source =
    legacyReference.sourceType === 'knowledge-material' ||
    legacyReference.sourceType === 'generated-image' ||
    legacyReference.sourceType === 'local-image'
      ? legacyReference.sourceType
      : 'local-image'
  return {
    source,
    label: legacyReference.label ?? '参考素材',
    value: legacyReference.value ?? legacyReference.referenceImageIds[0],
    imageIds: [...legacyReference.referenceImageIds],
  }
}

export function normalizeStrategyAsset(input: LegacyStrategyAsset): StrategyAsset {
  const reference = normalizeReference(input)
  const normalizedMode =
    input.generationMode === 'image-to-image' || (input.generationMode === 'sop' && reference)
      ? 'image-to-image'
      : input.generationMode === null
        ? null
        : 'text-to-image'
  const legacyInsightIds =
    input.steps
      ?.filter((step) => step.kind === 'knowledge' && step.sourceType === 'knowledge-term' && step.value)
      .map((step) => step.value!) ?? []
  const legacySop = input.sop?.trim() ?? ''
  const workflow: StrategyWorkflow = {
    reference: normalizedMode === 'image-to-image' ? reference : undefined,
    instruction: input.workflow?.instruction ?? input.promptTemplate ?? '',
    knowledge: {
      resolved: input.workflow?.knowledge?.resolved ?? true,
      insightIds: [...(input.workflow?.knowledge?.insightIds ?? legacyInsightIds)],
    },
    sop: {
      resolved: input.workflow?.sop?.resolved ?? true,
      mode: input.workflow?.sop?.mode ?? (legacySop ? 'custom' : 'none'),
      presetId: input.workflow?.sop?.presetId,
      name: input.workflow?.sop?.name,
      description: input.workflow?.sop?.description,
      content: input.workflow?.sop?.content ?? legacySop,
    },
  }
  const outputs: StrategyOutputs = input.outputs
    ? {
        channels: {
          enabled: input.outputs.channels?.enabled ?? false,
          channelIds: [...(input.outputs.channels?.channelIds ?? input.channelIds ?? [])],
        },
        sizes: {
          enabled: input.outputs.sizes?.enabled ?? false,
          ratios: [...(input.outputs.sizes?.ratios ?? input.ratios ?? [])],
        },
        export: {
          enabled: input.outputs.export?.enabled ?? false,
          presetId: input.outputs.export?.presetId ?? input.exportPresetId,
        },
        allocation: {
          enabled: input.outputs.allocation?.enabled ?? false,
          presetId: input.outputs.allocation?.presetId ?? input.allocationPresetId,
        },
      }
    : {
        channels: { enabled: false, channelIds: [...(input.channelIds ?? [])] },
        sizes: { enabled: false, ratios: [...(input.ratios ?? [])] },
        export: { enabled: false, presetId: input.exportPresetId },
        allocation: { enabled: false, presetId: input.allocationPresetId },
      }
  const now = Date.now()
  return {
    id: input.id ?? strategyId('strategy'),
    name: input.name ?? '未命名策略',
    productId: input.productId ?? '',
    materialTypeId: input.materialTypeId ?? '',
    description: input.description ?? '',
    coverImageId: input.coverImageId,
    generationMode: normalizedMode,
    workflow,
    outputs,
    quantity: input.quantity ?? 10,
    status: input.status ?? 'draft',
    version: input.version ?? 1,
    createdBy: input.createdBy ?? '',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    archived: input.archived,
    resultPromptOverrides: input.resultPromptOverrides,
  }
}

export function seedStrategyAssets(catalog: RequirementCatalog): StrategyAsset[] {
  const createdAt = Date.now()
  return catalog.products.flatMap((product) =>
    catalog.materialTypes.map((materialType) => {
      return {
        id: `strategy-${product.id}-${materialType.id}`,
        name: `${materialType.name}·标准方向`,
        productId: product.id,
        materialTypeId: materialType.id,
        description: materialType.summary,
        generationMode: 'text-to-image',
        workflow: {
          instruction: materialType.strategy,
          knowledge: { resolved: true, insightIds: [] },
          sop: { resolved: true, mode: 'none', content: '' },
        },
        outputs: {
          channels: { enabled: false, channelIds: catalog.channels[0] ? [catalog.channels[0].id] : [] },
          sizes: { enabled: false, ratios: ['16:9'] },
          export: { enabled: false },
          allocation: { enabled: false },
        },
        quantity: 10,
        status: 'published',
        version: 1,
        createdBy: 'user-strategist',
        createdAt,
        updatedAt: createdAt,
      } satisfies StrategyAsset
    }),
  )
}

export function seedStrategyPresets(): StrategyPreset[] {
  const createdAt = Date.now()
  return [
    {
      id: 'preset-export-channel-folders',
      name: '按渠道分目录导出',
      type: 'export',
      description: '结果先按渠道，再按 SKU、素材类型和日期归档。',
      value: '{channel}/{product}/{materialType}/{date}/{strategy}',
      global: true,
      createdBy: 'user-admin',
      createdAt,
    },
    {
      id: 'preset-allocation-even',
      name: '尺寸均分',
      type: 'allocation',
      description: '所选尺寸平均分配生产数量。',
      value: 'even-by-ratio',
      global: true,
      createdBy: 'user-admin',
      createdAt,
    },
  ]
}

export function createStrategyAsset(productId: string, materialTypeId: string, createdBy: string): StrategyAsset {
  const createdAt = Date.now()
  return {
    id: strategyId('strategy'),
    name: '未命名策略',
    productId,
    materialTypeId,
    description: '补充策略说明与适用场景',
    generationMode: null,
    workflow: {
      instruction: '',
      knowledge: { resolved: false, insightIds: [] },
      sop: { resolved: false, mode: 'none', content: '' },
    },
    outputs: emptyOutputs(),
    quantity: 10,
    status: 'draft',
    version: 1,
    createdBy,
    createdAt,
    updatedAt: createdAt,
  }
}

export function presetLabel(type: StrategyPresetType) {
  return type === 'export' ? '渠道导出预设' : '输出分配预设'
}

export function getStrategyCoreStage(strategy: StrategyAsset, materialType?: CatalogMaterialType): StrategyCoreStage {
  const sop = strategy.workflow.sop
  return sop.resolved && sop.mode !== 'none' && Boolean(sop.content.trim()) ? 'ready' : 'sop'
}

export function getRecommendedNextKinds(
  strategy: StrategyAsset,
  materialType?: CatalogMaterialType,
): Array<StrategyFlowStep['kind']> {
  const stage = getStrategyCoreStage(strategy, materialType)
  return stage === 'ready' ? [] : [stage]
}

export function validateStrategyForTest(strategy: StrategyAsset, materialType?: CatalogMaterialType) {
  const stage = getStrategyCoreStage(strategy, materialType)
  const errors: string[] = []
  if (stage === 'sop') errors.push('请选择或完成一份可执行的 SOP')
  if (strategy.outputs.channels.enabled && strategy.outputs.channels.channelIds.length === 0)
    errors.push('已启用输出渠道，请至少选择一个渠道')
  if (strategy.outputs.sizes.enabled && strategy.outputs.sizes.ratios.length === 0)
    errors.push('已启用输出尺寸，请至少选择一个尺寸')
  if (strategy.outputs.export.enabled) {
    if (!strategy.outputs.channels.enabled || strategy.outputs.channels.channelIds.length === 0)
      errors.push('渠道导出需要先启用并选择输出渠道')
    if (!strategy.outputs.export.presetId) errors.push('已启用渠道导出，请选择导出预设')
  }
  if (strategy.outputs.allocation.enabled) {
    if (!strategy.outputs.channels.enabled && !strategy.outputs.sizes.enabled)
      errors.push('输出分配需要先启用输出渠道或输出尺寸')
    if (!strategy.outputs.allocation.presetId) errors.push('已启用输出分配，请选择分配预设')
  }
  return errors
}

export function buildStrategyFlowSteps(strategy: StrategyAsset, catalog: RequirementCatalog): StrategyFlowStep[] {
  const steps: StrategyFlowStep[] = []
  if (strategy.generationMode) {
    steps.push({
      id: 'mode',
      kind: 'mode',
      label: strategy.generationMode === 'text-to-image' ? '文生图' : '图生图',
      value: strategy.generationMode,
    })
  }
  if (strategy.generationMode === 'image-to-image' && strategy.workflow.reference) {
    steps.push({
      id: 'reference',
      kind: 'reference',
      label: strategy.workflow.reference.label,
      value: strategy.workflow.reference.value,
      sourceType: strategy.workflow.reference.source,
      referenceImageIds: strategy.workflow.reference.imageIds,
    })
  }
  if (strategy.workflow.instruction.trim()) {
    steps.push({ id: 'instruction', kind: 'instruction', label: '核心生成要求', value: strategy.workflow.instruction })
  }
  if (strategy.workflow.knowledge.resolved) {
    const count = strategy.workflow.knowledge.insightIds.length
    steps.push({
      id: 'knowledge',
      kind: 'knowledge',
      label: count ? `已选择 ${count} 条知识` : '不使用知识库',
      value: String(count),
    })
  }
  if (strategy.workflow.sop.resolved && strategy.workflow.sop.mode !== 'none' && strategy.workflow.sop.content.trim()) {
    steps.push({
      id: 'sop',
      kind: 'sop',
      label: strategy.workflow.sop.name || '自定义 SOP',
      value: strategy.workflow.sop.presetId ?? strategy.workflow.sop.mode,
    })
  }
  if (strategy.outputs.channels.enabled) {
    const labels = strategy.outputs.channels.channelIds
      .map((id) => catalog.channels.find((channel) => channel.id === id)?.name ?? id)
      .join('、')
    steps.push({ id: 'channel', kind: 'channel', label: labels, value: strategy.outputs.channels.channelIds.join(',') })
  }
  if (strategy.outputs.sizes.enabled) {
    steps.push({
      id: 'size',
      kind: 'size',
      label: strategy.outputs.sizes.ratios.join('、'),
      value: strategy.outputs.sizes.ratios.join(','),
    })
  }
  if (strategy.outputs.export.enabled) {
    steps.push({ id: 'export', kind: 'export', label: '已启用渠道导出', value: strategy.outputs.export.presetId ?? '' })
  }
  if (strategy.outputs.allocation.enabled) {
    steps.push({
      id: 'allocation',
      kind: 'allocation',
      label: '已启用输出分配',
      value: strategy.outputs.allocation.presetId ?? '',
    })
  }
  return steps
}

export function buildStrategyTestPrompt(
  strategy: StrategyAsset,
  catalog: RequirementCatalog,
  knowledgeDescriptions: string[],
) {
  const product = catalog.products.find((item) => item.id === strategy.productId)
  const materialType = catalog.materialTypes.find((item) => item.id === strategy.materialTypeId)
  const channels = strategy.outputs.channels.enabled
    ? strategy.outputs.channels.channelIds
        .map((id) => catalog.channels.find((item) => item.id === id)?.name)
        .filter(Boolean)
        .join('、')
    : ''
  const sizes = strategy.outputs.sizes.enabled ? strategy.outputs.sizes.ratios.join('、') : ''
  return [
    `为产品「${product?.name ?? strategy.productId}」执行策略「${strategy.name}」。`,
    `素材方向：${materialType?.name ?? strategy.materialTypeId}。`,
    `生成方式：${strategy.generationMode === 'image-to-image' ? '图生图' : '文生图'}。`,
    strategy.workflow.reference ? `参考素材：${strategy.workflow.reference.label}。` : '',
    strategy.workflow.instruction ? `核心生成要求：${strategy.workflow.instruction}` : '',
    strategy.workflow.sop.mode !== 'none' && strategy.workflow.sop.content
      ? `必须执行的 SOP${strategy.workflow.sop.name ? `「${strategy.workflow.sop.name}」` : ''}${strategy.workflow.sop.description ? `（${strategy.workflow.sop.description}）` : ''}：\n${strategy.workflow.sop.content}`
      : '',
    knowledgeDescriptions.length ? `引用知识条目：\n${knowledgeDescriptions.join('\n')}` : '',
    channels ? `输出渠道：${channels}。` : '',
    sizes ? `输出尺寸：${sizes}。` : '',
    '同批结果必须主动差异化构图、场景、视觉焦点、色彩与文案表达，同时保持产品事实和策略目标一致。',
  ]
    .filter(Boolean)
    .join('\n')
}
