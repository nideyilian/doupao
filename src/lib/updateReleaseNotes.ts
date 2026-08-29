const FALLBACK_RELEASE_NOTES = '本次更新未提供详细更新说明。'

type ReleaseNoteItem = {
  version?: unknown
  note?: unknown
}

function isReleaseNoteItem(value: unknown): value is ReleaseNoteItem {
  return Boolean(value && typeof value === 'object')
}

export function formatUpdateReleaseNotes(releaseNotes: unknown): string {
  if (typeof releaseNotes === 'string') {
    const trimmed = releaseNotes.trim()
    return trimmed || FALLBACK_RELEASE_NOTES
  }

  if (Array.isArray(releaseNotes)) {
    const text = releaseNotes
      .map((item) => {
        if (!isReleaseNoteItem(item)) return ''

        const version = typeof item.version === 'string' ? item.version.trim() : ''
        const note = typeof item.note === 'string' ? item.note.trim() : ''
        if (!version && !note) return ''

        const title = version ? `v${version.replace(/^v/, '')}` : ''
        return [title, note].filter(Boolean).join('\n')
      })
      .filter(Boolean)
      .join('\n\n')

    return text || FALLBACK_RELEASE_NOTES
  }

  return FALLBACK_RELEASE_NOTES
}
