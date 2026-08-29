import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import { apiFetch as fetch } from './desktopApiFetch'

export type ModelType = 'multimodal' | 'text' | 'image' | 'unknown'

export interface AvailableModel {
  id: string
  type: ModelType
}

export function inferModelType(modelId: string): ModelType {
  const id = modelId.trim().toLowerCase()
  if (!id) return 'unknown'
  if (id.includes('image') || id.includes('imagen')) return 'image'
  if (id.startsWith('gpt-4o') || id.startsWith('gpt-5') || /^o\d/.test(id)) return 'multimodal'
  if (id.includes('embedding') || id.includes('text') || id.includes('chat')) return 'text'
  return 'unknown'
}

function createModelHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function parseModelResponse(payload: unknown): AvailableModel[] {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
  const data = Array.isArray(record.data) ? record.data : Array.isArray(payload) ? payload : []
  const seen = new Set<string>()
  const models: AvailableModel[] = []
  for (const item of data) {
    const id =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
          ? String((item as Record<string, unknown>).id).trim()
          : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, type: inferModelType(id) })
  }
  return models
}

export async function fetchAvailableModels(profile: ApiProfile, signal?: AbortSignal): Promise<AvailableModel[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const response = await fetch(buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy), {
    method: 'GET',
    headers: createModelHeaders(profile),
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  return parseModelResponse(await response.json())
}
