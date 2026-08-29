/**
 * 两阶段衍生的第一阶段：参考图 → 结构化视觉档案。
 *
 * 视觉档案是「干净的事实摘要」：只描述参考图中可观察的视觉事实，
 * 不写模板、不编选项。第二阶段基于档案生成变量提示词，避免
 * 「看图 + 写模板 + 编选项」一步到位导致选项浅层、趋同。
 */

export const VISUAL_PROFILE_INSTRUCTION = `你是图片视觉档案分析器。逐张分析用户提供的参考图片，输出一份结构化视觉档案，供后续模板生成器使用。

只描述可观察的视觉事实，不要生成提示词、不要编造模板、不要输出画面之外的推测。

对每张图输出以下字段（用 JSON）：
{
  "subject": "主体是什么：类别 + 具体形态，如「柴犬，坐姿，橙色毛发」",
  "subjectCategory": "主体所属上位类别（用于跨类衍生），如「萌宠/犬科动物」",
  "style": "视觉风格流派，如「日系水彩插画」；及上位媒介类别，如「手绘插画」",
  "composition": "构图机制，如「中心构图，主体居中，留白均衡」",
  "color": "配色体系，如「暖橙主色 + 米白背景」；色板特征",
  "scene": "场景/背景类型，如「室内客厅，暖光」；及上位类别，如「室内环境」",
  "lighting": "光影特征，如「柔光，无明显阴影」",
  "material": "材质质感，如「纸质纹理，水彩晕染」",
  "mood": "氛围情绪，如「温馨治愈」",
  "textElements": "画面中的文字元素（无则空数组）：逐字记录可见文字内容",
  "coreVisualMechanism": "这张图最核心的视觉机制/结构关系（1-2 句），如「主体与背景负形融合」",
  "derivableDimensions": ["列出此图可以安全衍生的维度，如 主体、风格、配色、场景", "只列与画面事实相符的维度"],
  "lockedFacts": ["必须保持不变的事实，如 品牌标识、特定产品形态、文字内容", "无则空数组"]
}

要求：
1. 每张图独立输出一份档案，用 JSON 数组包装：[{...}, {...}]。
2. 只输出 JSON，不要 Markdown、解释或编号。
3. OCR 不确定的文字标记为 [OCR不确定]，不得自行补写。
4. 多张图时，字段值只描述该图本身，不做跨图归纳。`

export interface VisualProfile {
  subject: string
  subjectCategory: string
  style: string
  composition: string
  color: string
  scene: string
  lighting: string
  material: string
  mood: string
  textElements: string[]
  coreVisualMechanism: string
  derivableDimensions: string[]
  lockedFacts: string[]
}

/**
 * 把 AI 返回的视觉档案 JSON 解析为结构化对象数组。
 */
export function parseVisualProfiles(text: string): VisualProfile[] {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end <= start) {
    // 兼容单个对象
    const objStart = trimmed.indexOf('{')
    const objEnd = trimmed.lastIndexOf('}')
    if (objStart < 0 || objEnd <= objStart) {
      throw new Error(`视觉档案解析失败：模型返回不是合法 JSON。返回内容：${trimmed.slice(0, 200) || '(空)'}`)
    }
    const single = JSON.parse(trimmed.slice(objStart, objEnd + 1)) as Partial<VisualProfile>
    return [normalizeProfile(single)]
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('视觉档案解析失败：空数组')
  return parsed.map((item) => normalizeProfile(item as Partial<VisualProfile>))
}

function normalizeProfile(item: Partial<VisualProfile>): VisualProfile {
  return {
    subject: String(item.subject ?? '未识别'),
    subjectCategory: String(item.subjectCategory ?? ''),
    style: String(item.style ?? ''),
    composition: String(item.composition ?? ''),
    color: String(item.color ?? ''),
    scene: String(item.scene ?? ''),
    lighting: String(item.lighting ?? ''),
    material: String(item.material ?? ''),
    mood: String(item.mood ?? ''),
    textElements: Array.isArray(item.textElements) ? item.textElements.map(String) : [],
    coreVisualMechanism: String(item.coreVisualMechanism ?? ''),
    derivableDimensions: Array.isArray(item.derivableDimensions) ? item.derivableDimensions.map(String) : [],
    lockedFacts: Array.isArray(item.lockedFacts) ? item.lockedFacts.map(String) : [],
  }
}

/**
 * 把视觉档案压缩成第二阶段模板生成器的输入文本。
 * 只保留与衍生相关的字段，避免把整段 JSON 塞进指令导致注意力分散。
 */
export function buildProfileSummary(profiles: VisualProfile[]): string {
  return profiles
    .map((profile, index) => {
      const lines = [
        `参考图 ${index + 1}：`,
        `- 主体：${profile.subject}${profile.subjectCategory ? `（上位类别：${profile.subjectCategory}）` : ''}`,
        `- 风格：${profile.style}`,
        `- 构图：${profile.composition}`,
        `- 配色：${profile.color}`,
        `- 场景：${profile.scene}`,
        `- 光影：${profile.lighting}`,
        `- 材质：${profile.material}`,
        `- 氛围：${profile.mood}`,
        profile.textElements.length > 0 ? `- 画面文字：${profile.textElements.join('、')}` : '',
        profile.coreVisualMechanism ? `- 核心视觉机制：${profile.coreVisualMechanism}` : '',
        profile.derivableDimensions.length > 0 ? `- 可衍生维度：${profile.derivableDimensions.join('、')}` : '',
        profile.lockedFacts.length > 0 ? `- 必须锁定的事实：${profile.lockedFacts.join('、')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      return lines
    })
    .join('\n\n')
}
