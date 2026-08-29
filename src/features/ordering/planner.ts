import type {
  OrderingCatalog,
  OrderingChannel,
  OrderingDraft,
  OrderingMaterialType,
  OrderingPreview,
  OrderingProduct,
  OrderingUnit,
} from './types'

function unitId(productId: string, channelId: string, ratio: string, materialTypeId: string) {
  return `${productId}__${channelId}__${ratio.replace(':', 'x')}__${materialTypeId}`
}

function ratioInstruction(ratio: '16:9' | '9:16') {
  return ratio === '16:9'
    ? '横版 16:9 构图，使用水平视觉动线，核心主体与关键信息避开左右裁切安全区。'
    : '竖版 9:16 构图，使用自上而下视觉动线，核心主体位于首屏视觉中心，避开顶部与底部遮挡区。'
}

export function composeOrderingPrompt(
  product: OrderingProduct,
  channel: OrderingChannel,
  materialType: OrderingMaterialType,
  ratio: '16:9' | '9:16',
  quantity: number,
) {
  const strategy =
    materialType.mode === 'fixed'
      ? [
          `严格执行「${materialType.name}」固定生成规范：`,
          ...(materialType.fixedRules ?? []),
          '仅在固定规则允许的范围内变化，不得回退到通用生成方案。',
        ]
      : [
          `采用「${materialType.name}」智能策略：${materialType.strategy}`,
          '同批图片主动改变构图、场景、视觉焦点、色彩和文案表达，不得只依赖随机种子。',
          '默认 80% 使用稳定跑量方向，20% 使用潜力探索方向；没有潜力知识时全部使用稳定方向。',
        ]

  return [
    `为产品「${product.name}」生成 ${quantity} 张用于「${channel.name}」的信息流广告图片。`,
    `产品事实：${product.facts.join('；')}。`,
    `目标人群：${product.audience}。`,
    `适用场景：${product.scenes.join('、')}。`,
    `渠道要求：${channel.requirements.join('；')}。`,
    ratioInstruction(ratio),
    ...strategy,
    `产品禁用项：${product.forbidden.join('；') || '无'}。`,
    `渠道禁用项：${channel.forbidden.join('；') || '无'}。`,
    '不得伪造系统界面、通知、按钮、订单、收益、权威背书或投放效果数据。',
  ].join('\n')
}

function getCombinationError(
  product: OrderingProduct,
  channel: OrderingChannel,
  materialType: OrderingMaterialType,
  ratio: '16:9' | '9:16',
) {
  if (!product.published || product.archived) return '产品未发布或已归档'
  if (!channel.published || channel.archived) return '渠道未发布或已归档'
  if (!materialType.published || materialType.archived) return '素材类型未发布或已归档'
  if (!channel.ratios.includes(ratio)) return `渠道不支持 ${ratio}`
  if (materialType.compatibleProductIds && !materialType.compatibleProductIds.includes(product.id))
    return '素材类型与产品不兼容'
  if (materialType.compatibleChannelIds && !materialType.compatibleChannelIds.includes(channel.id))
    return '素材类型与渠道不兼容'
  if (materialType.mode === 'fixed' && !materialType.supportedRatios?.includes(ratio))
    return `固定规则缺少 ${ratio} 适配`
  if (materialType.mode === 'fixed' && !materialType.fixedRules?.length) return '固定规则内容不完整'
  return ''
}

export function planOrderingOrder(
  draft: OrderingDraft,
  catalog: OrderingCatalog,
  limits: { maxImagesPerOrder: number; remainingDailyQuota: number },
): OrderingPreview {
  const units: OrderingUnit[] = []
  const excluded: OrderingPreview['excluded'] = []
  const errors: string[] = []
  const productById = new Map(catalog.products.map((item) => [item.id, item]))
  const channelById = new Map(catalog.channels.map((item) => [item.id, item]))
  const typeById = new Map(catalog.materialTypes.map((item) => [item.id, item]))

  if (draft.productIds.length === 0) errors.push('请选择至少一个产品')
  if (draft.channels.length === 0 || draft.channels.every((item) => item.ratios.length === 0))
    errors.push('请选择至少一个渠道规格')
  if (draft.materialTypeIds.length === 0) errors.push('请选择至少一个素材类型')
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) errors.push('每组合数量必须是正整数')

  for (const productId of draft.productIds) {
    const product = productById.get(productId)
    if (!product) continue
    for (const selection of draft.channels) {
      const channel = channelById.get(selection.channelId)
      if (!channel) continue
      for (const ratio of selection.ratios) {
        for (const materialTypeId of draft.materialTypeIds) {
          const materialType = typeById.get(materialTypeId)
          if (!materialType) continue
          const reason = getCombinationError(product, channel, materialType, ratio)
          if (reason) {
            excluded.push({ productId, channelId: channel.id, ratio, materialTypeId, reason })
            continue
          }
          units.push({
            id: unitId(productId, channel.id, ratio, materialTypeId),
            productId,
            channelId: channel.id,
            ratio,
            materialTypeId,
            quantity: draft.quantity,
            prompt: composeOrderingPrompt(product, channel, materialType, ratio, draft.quantity),
            status: 'queued',
          })
        }
      }
    }
  }

  const totalImages = units.reduce((sum, unit) => sum + unit.quantity, 0)
  if (totalImages === 0 && errors.length === 0) errors.push('没有可执行的有效组合')
  if (totalImages > limits.maxImagesPerOrder)
    errors.push(`计划 ${totalImages} 张，超过单张需求上限 ${limits.maxImagesPerOrder} 张`)
  if (totalImages > limits.remainingDailyQuota)
    errors.push(`计划 ${totalImages} 张，超过今日剩余额度 ${limits.remainingDailyQuota} 张`)

  return { units, excluded, totalImages, valid: errors.length === 0, errors }
}

export const composeRequirementPrompt = composeOrderingPrompt
export const planRequirementOrder = planOrderingOrder
