import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface StoredApiSecrets {
  version: 1
  imageProfiles: Record<string, string>
  agentProfiles: Record<string, string>
}

export interface ApiSecretsLoadResult {
  available: boolean
  secrets: StoredApiSecrets
  error?: string
}

const EMPTY_SECRETS: StoredApiSecrets = {
  version: 1,
  imageProfiles: {},
  agentProfiles: {},
}

function replaceFile(filePath: string, content: string | Buffer): void {
  const tempPath = `${filePath}.tmp`
  const backupPath = `${filePath}.bak.swap`
  writeFileSync(tempPath, content)
  rmSync(backupPath, { force: true })
  if (existsSync(filePath)) renameSync(filePath, backupPath)
  try {
    renameSync(tempPath, filePath)
    rmSync(backupPath, { force: true })
  } catch (error) {
    if (existsSync(backupPath) && !existsSync(filePath)) renameSync(backupPath, filePath)
    throw error
  } finally {
    rmSync(tempPath, { force: true })
  }
}

export function getApiSecretsPath(): string {
  return path.join(app.getPath('userData'), 'api-secrets.bin')
}

function normalizeSecretRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 && entry[0].length <= 512 && typeof entry[1] === 'string' && entry[1].length <= 16_384,
      )
      .map(([key, secret]) => [key, secret]),
  )
}

export function normalizeApiSecrets(value: unknown): StoredApiSecrets {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    version: 1,
    imageProfiles: normalizeSecretRecord(record.imageProfiles),
    agentProfiles: normalizeSecretRecord(record.agentProfiles),
  }
}

export function loadApiSecrets(): ApiSecretsLoadResult {
  if (!safeStorage.isEncryptionAvailable()) return { available: false, secrets: EMPTY_SECRETS }
  const filePath = getApiSecretsPath()
  if (!existsSync(filePath)) return { available: true, secrets: EMPTY_SECRETS }
  try {
    const decrypted = safeStorage.decryptString(readFileSync(filePath))
    return { available: true, secrets: normalizeApiSecrets(JSON.parse(decrypted)) }
  } catch (error) {
    return {
      available: true,
      secrets: EMPTY_SECRETS,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function saveApiSecrets(value: unknown): { success: boolean; error?: string } {
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: '系统安全存储不可用' }
  const filePath = getApiSecretsPath()
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(normalizeApiSecrets(value)))
    replaceFile(filePath, encrypted)
    scrubLegacyStateFiles()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function stripProfileApiKey(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...(value as Record<string, unknown>), apiKey: '' }
}

function stripSettingsApiKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const settings = value as Record<string, unknown>
  return {
    ...settings,
    apiKey: '',
    profiles: Array.isArray(settings.profiles) ? settings.profiles.map(stripProfileApiKey) : settings.profiles,
    agentProfiles: Array.isArray(settings.agentProfiles)
      ? settings.agentProfiles.map(stripProfileApiKey)
      : settings.agentProfiles,
    agentProfile: stripProfileApiKey(settings.agentProfile),
  }
}

function stripPersistedStateApiKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const root = value as Record<string, unknown>
  if (root.state && typeof root.state === 'object' && !Array.isArray(root.state)) {
    const state = root.state as Record<string, unknown>
    return {
      ...root,
      state: {
        ...state,
        settings: stripSettingsApiKeys(state.settings),
        dismissedCodexCliPrompts: [],
      },
    }
  }
  return {
    ...root,
    settings: stripSettingsApiKeys(root.settings),
    dismissedCodexCliPrompts: [],
  }
}

function scrubLegacyStateFiles(): void {
  const basePath = path.join(app.getPath('userData'), 'gpt-image-playground.json')
  for (const filePath of [basePath, `${basePath}.bak`]) {
    if (!existsSync(filePath)) continue
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      replaceFile(filePath, JSON.stringify(stripPersistedStateApiKeys(parsed), null, 2))
    } catch (error) {
      console.warn('[api-secrets] 清理旧状态文件中的 API Key 失败', filePath, error)
    }
  }
}
