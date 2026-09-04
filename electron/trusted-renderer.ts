import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const packagedRendererPath = path.resolve(moduleDir, '../dist/index.html')

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isTrustedRendererUrl(rawUrl: string, devServerUrl = process.env.VITE_DEV_SERVER_URL): boolean {
  try {
    const url = new URL(rawUrl)
    if (devServerUrl) {
      const devUrl = new URL(devServerUrl)
      return url.protocol === devUrl.protocol && url.host === devUrl.host
    }
    if (url.protocol !== 'file:') return false
    return comparablePath(fileURLToPath(url)) === comparablePath(packagedRendererPath)
  } catch {
    return false
  }
}
