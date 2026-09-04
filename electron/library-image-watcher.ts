import { existsSync, watch, type FSWatcher } from 'fs'
import path from 'path'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export interface RemovedManagedImageFile {
  path: string
  imageId?: string
}

export function parseManagedImagePath(root: string, relativeName: string): RemovedManagedImageFile | null {
  const normalized = relativeName.replaceAll('\\', '/')
  if (normalized.split('/').some((segment) => segment === '..')) return null
  const extension = path.extname(normalized).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) return null
  if (!normalized.startsWith('cache-images/') && !normalized.startsWith('images/')) return null
  const filePath = path.join(root, ...normalized.split('/'))
  if (normalized.startsWith('cache-images/')) {
    return { path: filePath, imageId: path.basename(normalized, extension) }
  }
  return { path: filePath }
}

export class LibraryImageWatcher {
  private watcher: FSWatcher | null = null
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  start(root: string, onRemoved: (file: RemovedManagedImageFile) => void): void {
    this.close()
    if (!existsSync(root)) return
    this.watcher = watch(root, { recursive: true }, (_eventType, fileName) => {
      if (!fileName) return
      const parsed = parseManagedImagePath(root, String(fileName))
      if (!parsed) return
      const key = parsed.path.toLowerCase()
      const previous = this.timers.get(key)
      if (previous) clearTimeout(previous)
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key)
          if (!existsSync(parsed.path)) onRemoved(parsed)
        }, 200),
      )
    })
  }

  close(): void {
    this.watcher?.close()
    this.watcher = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
