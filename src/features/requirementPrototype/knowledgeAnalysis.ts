import { getAgentTextApiProfile } from '../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import { useStore } from '../../store'
import type { KnowledgeInsight } from './types'

type InsightInput = Omit<KnowledgeInsight, 'id' | 'batchId' | 'createdAt'>

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const output = (payload as { output?: unknown[] }).output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown[] }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n')
}

function parseInsights(text: string): InsightInput[] {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('视觉分析模型未返回可识别的知识条目')
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
  if (!Array.isArray(parsed)) throw new Error('视觉分析结果格式不正确')
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const title = String(value.title ?? '').trim()
    const description = String(value.description ?? '').trim()
    if (!title || !description) return []
    return [
      {
        title,
        description,
        category: value.category === 'exploratory' ? ('exploratory' as const) : ('stable' as const),
        evidence: String(value.evidence ?? '来自本批素材的视觉特征归纳').trim(),
        smallSampleOpportunity: Boolean(value.smallSampleOpportunity),
      },
    ]
  })
}

async function analyzeChunk(images: string[], context: { product: string; channel: string; materialType: string }) {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  if (!profile.apiKey.trim()) throw new Error('管理员尚未配置视觉分析 API 密钥')
  if (profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    throw new Error('视觉分析需要管理员配置 OpenAI Responses 兼容模型')
  }
  const proxy = readClientDevProxyConfig()
  const content: Array<Record<string, string>> = [
    {
      type: 'input_text',
      text: [
        '你是信息流广告素材分析师。分析附带的历史广告图片，提炼可复用的跑量知识与可探索机会。',
        `产品：${context.product}；渠道：${context.channel}；素材类型：${context.materialType || '待判断'}。`,
        '结合画面构图、主体、视觉焦点、文案层级、色彩、场景、利益表达与合规风险进行判断。',
        '将高频、可重复验证的方向标为 stable；有价值但样本少、可能是偶然高表现的方向标为 exploratory，并将 smallSampleOpportunity 设为 true。',
        '不要虚构曝光、点击或转化数据。只返回 JSON 数组，不要 Markdown。',
        '每项结构：{"title":"短标题","description":"可直接指导生图的结构化描述","category":"stable|exploratory","evidence":"从图片观察到的证据","smallSampleOpportunity":true|false}。',
        '合并近义项，本组返回 2-6 条。',
      ].join('\n'),
    },
  ]
  for (const image of images) content.push({ type: 'input_image', image_url: image })

  const response = await fetch(
    buildApiUrl(profile.baseUrl, 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy)),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        model: profile.model || settings.model,
        instructions: '只执行广告图片分析与结构化知识提炼，不生成图片，不调用工具。',
        input: [{ role: 'user', content }],
        max_output_tokens: 2000,
      }),
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`视觉分析失败（${response.status}）：${body.slice(0, 180)}`)
  }
  return parseInsights(extractResponseText(await response.json()))
}

export async function analyzeKnowledgeFolder(
  folderPath: string,
  context: { product: string; channel: string; materialType: string },
  onProgress: (analyzed: number, total: number) => void,
) {
  const api = window.electronAPI
  if (!api?.listImageFiles || !api.readImageFile) throw new Error('当前环境不支持读取本地素材')
  const recursiveFiles = api.listCompositeBackgroundFiles
    ? await api.listCompositeBackgroundFiles(folderPath, true)
    : null
  const files = recursiveFiles?.length ? recursiveFiles : await api.listImageFiles(folderPath)
  if (files.length === 0) throw new Error('文件夹内没有可分析的图片')
  const allInsights: InsightInput[] = []
  for (let index = 0; index < files.length; index += 4) {
    const chunk = files.slice(index, index + 4)
    const loaded = await Promise.all(
      chunk.map(async (file) => {
        if ('dataUrl' in file && file.dataUrl) return file.dataUrl
        return (await api.readImageFile(file.path))?.dataUrl ?? ''
      }),
    )
    const dataUrls = loaded.filter(Boolean)
    if (dataUrls.length > 0) allInsights.push(...(await analyzeChunk(dataUrls, context)))
    onProgress(Math.min(files.length, index + chunk.length), files.length)
  }
  const deduplicated = [...new Map(allInsights.map((insight) => [insight.title, insight])).values()]
  if (deduplicated.length === 0) throw new Error('没有提炼出可发布的知识条目')
  return deduplicated
}
