import type { CompositeV2BackgroundImage } from './compositeV2Types'

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function supportsCompositeBackground(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return SUPPORTED_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

export function normalizeCompositeRelativeDir(relativeDir: string): string {
  return relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export function naturalSortBackgrounds(items: CompositeV2BackgroundImage[]): CompositeV2BackgroundImage[] {
  return [...items].sort((a, b) => {
    const folderCompare = collator.compare(
      normalizeCompositeRelativeDir(a.relativeDir),
      normalizeCompositeRelativeDir(b.relativeDir),
    )
    if (folderCompare !== 0) return folderCompare
    return collator.compare(a.name, b.name)
  })
}

export type CompositePreviewHistorySnapshot = { entries: string[]; index: number }

export function createPreviewHistory(initial: string[] | CompositePreviewHistorySnapshot = []) {
  let entries = Array.isArray(initial) ? [...initial] : [...initial.entries]
  let index = Array.isArray(initial)
    ? entries.length
      ? 0
      : -1
    : clampPreviewHistoryIndex(initial.index, entries.length)

  const api = {
    current() {
      return index >= 0 ? entries[index] : null
    },
    push(path: string) {
      entries = entries.slice(0, index + 1)
      entries.push(path)
      index = entries.length - 1
      return api
    },
    previous() {
      if (index > 0) index -= 1
      return api
    },
    next() {
      if (index < entries.length - 1) index += 1
      return api
    },
    snapshot() {
      return { entries: [...entries], index }
    },
  }

  return api
}

function clampPreviewHistoryIndex(index: number, length: number): number {
  if (length === 0) return -1
  return Math.min(Math.max(index, 0), length - 1)
}
