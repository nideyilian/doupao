import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '1024x1024'
const DEFAULT_PROMPT = '保留主体结构，只微调整体色调与光影，让画面更干净自然。'
const DEFAULT_IMAGE_CANDIDATES = [
  path.resolve(process.cwd(), 'docs/images/example_pc_1.jpg'),
  path.resolve(process.cwd(), 'docs/images/example_pc_2.jpg'),
]
const FALLBACK_TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i]
    if (!current.startsWith('--')) continue
    const [rawKey, inlineValue] = current.slice(2).split('=', 2)
    const next = inlineValue ?? argv[i + 1]
    const needsAdvance = inlineValue == null && next && !next.startsWith('--')
    result[rawKey] = needsAdvance ? next : inlineValue ?? 'true'
    if (needsAdvance) i++
  }
  return result
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

function buildApiUrl(baseUrl, endpointPath) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const cleanPath = String(endpointPath || '').replace(/^\/+/, '')
  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? cleanPath
    : `v1/${cleanPath}`
  return `${normalizedBaseUrl}/${apiPath}`
}

function maskSecret(value, keep = 6) {
  const text = String(value || '')
  if (text.length <= keep * 2) return '*'.repeat(Math.max(8, text.length))
  return `${text.slice(0, keep)}...${text.slice(-keep)}`
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadInputImage(inputPath) {
  const preferred = inputPath ? path.resolve(process.cwd(), inputPath) : null
  const candidates = preferred ? [preferred, ...DEFAULT_IMAGE_CANDIDATES] : DEFAULT_IMAGE_CANDIDATES
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      const buffer = await fs.readFile(candidate)
      return {
        filePath: candidate,
        fileName: path.basename(candidate),
        mime: guessMimeByPath(candidate),
        buffer,
      }
    }
  }

  return {
    filePath: '(fallback embedded png)',
    fileName: 'tiny.png',
    mime: 'image/png',
    buffer: Buffer.from(FALLBACK_TINY_PNG_BASE64, 'base64'),
  }
}

function guessMimeByPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function summarizeBody(text) {
  const trimmed = text.trim()
  if (!trimmed) return '(empty body)'
  const maybeJson = tryParseJson(trimmed)
  const normalized = maybeJson ? JSON.stringify(redactLargePayload(maybeJson), null, 2) : trimmed
  return normalized.length > 4000 ? `${normalized.slice(0, 4000)}\n... [truncated ${normalized.length - 4000} chars]` : normalized
}

function tryParseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function redactLargePayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactLargePayload(item))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 240) {
      return `${value.slice(0, 80)}... [${value.length} chars] ...${value.slice(-40)}`
    }
    return value
  }

  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'b64_json' || key === 'result' || key === 'image') && typeof item === 'string') {
      output[key] = `[omitted base64, ${item.length} chars]`
      continue
    }
    output[key] = redactLargePayload(item)
  }
  return output
}

async function collectResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawText = await response.text()
  return {
    status: response.status,
    ok: response.ok,
    contentType,
    body: summarizeBody(rawText),
  }
}

async function runSingleTest(test, context) {
  const startedAt = Date.now()
  const timeoutMs = context.timeoutMs
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error(`请求超时，超过 ${timeoutMs} ms`)), timeoutMs)
  try {
    const request = await test.createRequest(context)
    const response = await fetch(request.url, {
      ...request.options,
      signal: controller.signal,
    })
    const result = await collectResponse(response)
    return {
      name: test.name,
      description: test.description,
      request: {
        method: request.options.method || 'GET',
        url: request.url,
        contentType: request.options.headers?.['Content-Type'] || '(multipart or auto)',
      },
      elapsedMs: Date.now() - startedAt,
      ...result,
    }
  } catch (error) {
    return {
      name: test.name,
      description: test.description,
      request: null,
      elapsedMs: Date.now() - startedAt,
      ok: false,
      status: null,
      contentType: '',
      body: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function createJsonRequest(url, apiKey, body) {
  return {
    url,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  }
}

function createMultipartRequest(url, apiKey, formData) {
  return {
    url,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    },
  }
}

function createBlob(buffer, mime) {
  return new Blob([buffer], { type: mime })
}

function createTests() {
  return [
    {
      name: 'generations-json',
      description: '验证文生图接口是否正常',
      createRequest: async ({ baseUrl, apiKey, model }) => {
        return createJsonRequest(buildApiUrl(baseUrl, 'images/generations'), apiKey, {
          model,
          prompt: '生成一张简单的浅色几何海报，用于接口联通性测试。',
          size: DEFAULT_SIZE,
          quality: 'low',
          output_format: 'png',
          moderation: 'low',
          n: 1,
        })
      },
    },
    {
      name: 'edits-multipart-image-array',
      description: '模拟当前程序默认图生图格式：multipart + image[]',
      createRequest: async ({ baseUrl, apiKey, model, image }) => {
        const formData = new FormData()
        formData.append('model', model)
        formData.append('prompt', DEFAULT_PROMPT)
        formData.append('size', DEFAULT_SIZE)
        formData.append('quality', 'low')
        formData.append('output_format', 'png')
        formData.append('moderation', 'low')
        formData.append('image[]', createBlob(image.buffer, image.mime), image.fileName)
        return createMultipartRequest(buildApiUrl(baseUrl, 'images/edits'), apiKey, formData)
      },
    },
    {
      name: 'edits-multipart-image-array-stream',
      description: '模拟当前程序图生图流式格式：multipart + image[] + stream',
      createRequest: async ({ baseUrl, apiKey, model, image }) => {
        const formData = new FormData()
        formData.append('model', model)
        formData.append('prompt', DEFAULT_PROMPT)
        formData.append('size', DEFAULT_SIZE)
        formData.append('quality', 'low')
        formData.append('output_format', 'png')
        formData.append('moderation', 'low')
        formData.append('stream', 'true')
        formData.append('partial_images', '1')
        formData.append('image[]', createBlob(image.buffer, image.mime), image.fileName)
        return createMultipartRequest(buildApiUrl(baseUrl, 'images/edits'), apiKey, formData)
      },
    },
    {
      name: 'edits-multipart-image-single',
      description: '测试服务是否要求单文件字段 image 而不是 image[]',
      createRequest: async ({ baseUrl, apiKey, model, image }) => {
        const formData = new FormData()
        formData.append('model', model)
        formData.append('prompt', DEFAULT_PROMPT)
        formData.append('size', DEFAULT_SIZE)
        formData.append('quality', 'low')
        formData.append('output_format', 'png')
        formData.append('moderation', 'low')
        formData.append('image', createBlob(image.buffer, image.mime), image.fileName)
        return createMultipartRequest(buildApiUrl(baseUrl, 'images/edits'), apiKey, formData)
      },
    },
    {
      name: 'edits-json-images',
      description: '测试服务是否支持新版 JSON 图生图格式 images[].image_url',
      createRequest: async ({ baseUrl, apiKey, model, imageDataUrl }) => {
        return createJsonRequest(buildApiUrl(baseUrl, 'images/edits'), apiKey, {
          model,
          prompt: DEFAULT_PROMPT,
          size: DEFAULT_SIZE,
          quality: 'low',
          output_format: 'png',
          moderation: 'low',
          images: [{ image_url: imageDataUrl }],
        })
      },
    },
  ]
}

function printHeader(context) {
  console.log('=== image-edit diagnosis start ===')
  console.log(`Base URL: ${normalizeBaseUrl(context.baseUrl)}`)
  console.log(`API Key: ${maskSecret(context.apiKey)}`)
  console.log(`Model: ${context.model}`)
  console.log(`Input Image: ${context.image.filePath}`)
  console.log(`Input Size: ${context.image.buffer.length} bytes`)
  console.log('')
}

function printResult(result) {
  console.log(`--- ${result.name} ---`)
  console.log(`Description: ${result.description}`)
  if (result.request) {
    console.log(`Request: ${result.request.method} ${result.request.url}`)
    console.log(`Request-Type: ${result.request.contentType}`)
  }
  console.log(`Elapsed: ${result.elapsedMs} ms`)
  console.log(`Status: ${result.status ?? '(network error)'}`)
  console.log(`Response-Type: ${result.contentType || '(unknown)'}`)
  console.log('Response-Body:')
  console.log(result.body)
  console.log('')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args['base-url'] || process.env.DIAG_BASE_URL
  const apiKey = args['api-key'] || process.env.DIAG_API_KEY
  const model = args.model || process.env.DIAG_MODEL || DEFAULT_MODEL
  const only = args.only || process.env.DIAG_ONLY || ''
  const timeoutMs = Number(args.timeout || process.env.DIAG_TIMEOUT || 70000)

  if (!baseUrl || !apiKey) {
    console.error('Usage: node scripts/diagnose-image-edit.mjs --base-url <url> --api-key <key> [--model gpt-image-2] [--image docs/images/example_pc_1.jpg] [--only test-name] [--timeout 70000]')
    process.exitCode = 1
    return
  }

  const image = await loadInputImage(args.image || process.env.DIAG_IMAGE)
  const context = {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 70000,
    image,
    imageDataUrl: toDataUrl(image.buffer, image.mime),
  }

  printHeader(context)
  const tests = createTests().filter((test) => !only || test.name === only)
  if (!tests.length) {
    console.error(`Unknown test name: ${only}`)
    process.exitCode = 1
    return
  }
  const results = []
  for (const test of tests) {
    const result = await runSingleTest(test, context)
    results.push(result)
    printResult(result)
  }

  const failingEditTests = results.filter((item) => item.name.startsWith('edits-') && !item.ok)
  const okGeneration = results.find((item) => item.name === 'generations-json' && item.ok)

  console.log('=== summary ===')
  console.log(`generation_ok: ${okGeneration ? 'yes' : 'no'}`)
  console.log(`edit_fail_count: ${failingEditTests.length}`)
  for (const item of failingEditTests) {
    console.log(`- ${item.name}: ${item.status ?? 'network error'}`)
  }
}

await main()
