import type { AssistantActionResult } from './types'

export const INFORMATION_FLOW_AD_COMPLIANCE_PROMPT = [
  '【信息流广告合规负面约束，所有技能强制执行】',
  '以下约束同时适用于文字、画面主体、背景、道具、标识、数据图表、人物身份、前后对比和变量词条；即使用户原文或参考图包含风险内容，也不得在生成字段中照抄或强化，必须改写为客观、中性、可核验的表达。',
  '1. 禁止虚假或误导：不得捏造销量、排名、获奖、认证、专利、媒体报道、用户评价、实验数据、订单/支付/聊天截图；不得伪造官方通知、系统弹窗、新闻页面、印章、证书或专家身份。',
  '2. 禁止绝对化与无法证明的承诺：不得使用国家级、最高级、最佳、顶级、极品、第一品牌、行业第一、销量第一、全网第一、全国第一、全球第一等排名或极限表述；不得使用100%有效、百分之百、零风险、永久有效、绝对安全、保证有效等承诺。普通的序数、步骤编号或有合法依据且限定范围的数据，不得被误判为广告排名。',
  '3. 医疗健康与美容：不得承诺疗效、治愈率或有效率，不得写包治、根治、药到病除、无效退款；非医疗商品不得暗示疾病治疗功能；不得虚构医生、患者、专家背书，不得制造容貌或健康焦虑，不得生成夸张病灶、手术血腥特写或失真的使用前后对比。依法须审查的医疗、药品、医疗器械、保健食品等广告，不得通过技能改写规避审查或擅自改变审查内容。',
  '4. 金融理财：不得承诺保本、保收益、稳赚不赔、收益保证或无风险，不得用虚构盈利截图、单向上涨曲线、权威背书诱导投资；涉及收益可能性时必须保留清晰风险提示。',
  '5. 教育培训、招商加盟和房地产：不得保证考试通过、升学、就业、收益、回本、升值或投资结果；不得伪造学员成绩、录取通知、成交记录或成功案例。',
  '6. 禁止违法和不良视觉元素：不得生成烟草或电子烟推广、赌博博彩、毒品、色情裸露、低俗性暗示、血腥暴力、恐怖、自残、武器犯罪、封建迷信、歧视侮辱或危害未成年人身心健康的内容。',
  '7. 禁止不当借势和欺骗点击：不得使用国家机关、工作人员、国旗国徽等作商业背书；不得仿冒平台按钮、关闭按钮、播放按钮、未读消息、领奖通知或系统警告诱骗点击。',
  '8. 未成年人保护：不得让未成年人为医疗、药品、保健食品、医疗器械、化妆品、酒类或美容服务作推荐、示范或消费引导，不得把未成年人置于危险、成人化或不适宜场景。',
  '9. 合法性不确定时，删除风险卖点和风险画面，改成产品事实、使用场景、设计特征或品牌氛围；不要自行补造免责声明来保留违规承诺。',
  '输出要求：finalPrompt、variablePrompt、prompts、wordEntries 和普通建议中不得出现上述违规表述或引导生成上述元素；风险分析如需指出问题，只能使用“绝对化承诺”“虚假背书”等风险类别，不复述原违规词句。',
].join('\n')

const COMPLIANCE_REWRITES: Array<[RegExp, string]> = [
  [/(国家级|世界级|全球级|最高级|最佳|顶级|极品|第一品牌|行业第一|销量第一|全网第一|全国第一|全球第一)/gi, '高品质'],
  [
    /(100\s*%\s*(?:有效|安全|治愈|成功)?|百分之百(?:有效|安全|治愈|成功)?|零风险|永久有效|绝对安全|绝对有效|保证有效|保证治愈)/gi,
    '以实际情况为准',
  ],
  [/(包治百病|包治|根治|药到病除|无效退款)/gi, '提供规范服务'],
  [/(保本保收益|稳赚不赔|收益保证|保证收益|承诺收益|无风险投资)/gi, '收益存在风险'],
  [/(包过|保过|保证升学|保证就业|保证回本|保证升值)/gi, '结果因实际情况而异'],
  [/(伪造|假冒)(官方通知|系统弹窗|新闻页面|公章|印章|证书|医生|专家)/gi, '未经证实的$2'],
  [/(烟草|电子烟|处方药)/gi, '受限商品'],
  [/(色情裸露|色情|赌博博彩|赌博|毒品|血腥暴力|血腥|自残|恐怖|封建迷信|歧视侮辱)/gi, '不适宜内容'],
]

export function sanitizeInformationFlowAdText(value: string): string {
  return COMPLIANCE_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

export function sanitizeInformationFlowAdResult(result: AssistantActionResult): AssistantActionResult {
  const sanitizeList = (items?: string[]) => items?.map(sanitizeInformationFlowAdText)
  return {
    ...result,
    content: sanitizeInformationFlowAdText(result.content),
    prompt: sanitizeInformationFlowAdText(result.prompt),
    alternativePrompt: result.alternativePrompt
      ? sanitizeInformationFlowAdText(result.alternativePrompt)
      : result.alternativePrompt,
    primaryText: result.primaryText ? sanitizeInformationFlowAdText(result.primaryText) : result.primaryText,
    variablePrompt: result.variablePrompt
      ? sanitizeInformationFlowAdText(result.variablePrompt)
      : result.variablePrompt,
    candidates: sanitizeList(result.candidates),
    sections: result.sections?.map((section) => ({
      ...section,
      title: sanitizeInformationFlowAdText(section.title),
      items: section.items.map(sanitizeInformationFlowAdText),
    })),
    wordEntries: result.wordEntries?.map((group) => ({
      category: sanitizeInformationFlowAdText(group.category),
      entries: group.entries.map(sanitizeInformationFlowAdText),
    })),
  }
}
