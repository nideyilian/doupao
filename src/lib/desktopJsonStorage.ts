import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import { createCoalescedJsonStorage } from './coalescedJsonStorage'

type LegacyJsonAdapter = {
  read: () => Promise<string | null>
}

type DesktopAppDataApi = {
  isElectron?: boolean
  appDataGet?: (namespace: string, id: string) => Promise<unknown>
  appDataPut?: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
}

function getApi(): DesktopAppDataApi | null {
  const globalWindow = globalThis as typeof globalThis & { window?: { electronAPI?: DesktopAppDataApi } }
  const api = globalWindow.window?.electronAPI
  return api?.isElectron && api.appDataGet && api.appDataPut ? api : null
}

export function createDesktopJsonStorage(namespace: string, legacy?: LegacyJsonAdapter) {
  return createJSONStorage((): StateStorage => {
    const api = getApi()
    if (!api) return localStorage

    return createCoalescedJsonStorage(
      {
        read: async () => {
          const value = await api.appDataGet!(namespace, 'state')
          if (typeof value === 'string' && value.length > 0) {
            try {
              JSON.parse(value)
              return value
            } catch {
              console.warn(`[storage] SQLite 状态记录损坏，回退旧存储：${namespace}`)
            }
          }
          const legacyValue = (await legacy?.read()) ?? null
          if (legacyValue) {
            const result = await api.appDataPut!(namespace, 'state', legacyValue)
            if (!result.success) throw new Error(`应用状态迁移失败：${namespace}`)
          }
          return legacyValue
        },
        write: async (content) => {
          const result = await api.appDataPut!(namespace, 'state', content)
          if (!result.success) throw new Error(`应用状态写入失败：${namespace}`)
          return true
        },
      },
      {
        onWriteError: (error) => {
          console.error(`[storage] 应用状态写入失败，将自动重试：${namespace}`, error)
          const runtime = globalThis as typeof globalThis & {
            dispatchEvent?: (event: unknown) => void
            CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown
          }
          if (runtime.dispatchEvent && runtime.CustomEvent) {
            runtime.dispatchEvent(new runtime.CustomEvent('doupao:persist-error', { detail: { namespace } }))
          }
        },
      },
    )
  })
}
