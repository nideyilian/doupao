import { stripImageMentionMarkers } from '../../lib/promptImageMentions'
import type { InputImage } from '../../types'
import type { AssistantInputContext, GroundingFact, GroundingProfile } from './types'

export function buildAssistantInputContext(prompt: string, inputImages: InputImage[]): AssistantInputContext {
  const text = stripImageMentionMarkers(prompt).trim()
  return {
    text,
    hasText: text.length > 0,
    images: inputImages,
    hasImage: inputImages.length > 0,
    imageCount: inputImages.length,
  }
}

export function getAssistantContextLabel(context: AssistantInputContext) {
  if (context.hasImage && context.hasText) return '图片+提示词'
  if (context.hasImage) return context.imageCount > 1 ? `${context.imageCount} 张图片` : '图片'
  if (context.hasText) return '提示词'
  return '灵感'
}

/** Build the unified "content fact card" from the raw input.
 *  Every skill consumes the same profile instead of re-guessing the input.
 *  Inference/derivation done later by the model must be recorded separately as
 *  inferred facts; this function only captures what is already observable. */
export function buildGroundingProfile(context: AssistantInputContext): GroundingProfile {
  const observedFacts: GroundingFact[] = []
  const userRequirements: string[] = []
  const sourceEvidence: string[] = []

  if (context.hasText) {
    const sentences = context.text
      .split(/[。；;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    sentences.forEach((sentence, index) => {
      observedFacts.push({
        fact: sentence,
        source: 'text',
        confidence: 'high',
        lockPolicy: 'must-keep',
        sourceRef: `文字第 ${index + 1} 句`,
      })
      userRequirements.push(sentence)
    })
    sourceEvidence.push(`文字输入：${context.text}`)
  }

  if (context.hasImage) {
    const imageFact: GroundingFact = {
      fact: `参考图存在，共 ${context.imageCount} 张`,
      source: 'image',
      confidence: 'high',
      lockPolicy: 'must-keep',
      sourceRef: `${context.imageCount} 张参考图`,
    }
    observedFacts.push(imageFact)
    sourceEvidence.push(`图片输入：${context.imageCount} 张`)
  }

  const missingInformation: string[] = []
  if (!context.hasText && !context.hasImage) {
    missingInformation.push('缺少产品、素材或文字信息，无法建立事实卡')
  } else if (!context.hasText) {
    missingInformation.push('缺少文字描述，产品/卖点/目标需由参考图推断')
  }

  return {
    observedFacts,
    userRequirements,
    inferredFacts: [],
    lockedFacts: observedFacts.filter((fact) => fact.lockPolicy === 'must-keep'),
    visualIdentity: { subject: '', composition: '', color: '', scene: '', textLayout: '', style: '' },
    missingInformation,
    sourceEvidence,
  }
}
