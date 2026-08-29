function createRng(seed: number) {
  let s = seed | 0
  return {
    random: (): number => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
    .slice(0, 48)
}

export function normalize_entries(entries: unknown): string[] {
  if (Array.isArray(entries)) {
    return Array.from(new Set(entries.filter((e) => typeof e === 'string' && e !== '')))
  }
  if (typeof entries === 'string') {
    return Array.from(new Set(entries.split('\n').filter((e) => e !== '')))
  }
  return []
}

export function normalize_draw_count(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || Number.isNaN(n)) return 1
  if (n < 1 || n > 999) return 1
  return n
}

interface LibraryEntry {
  entries: string[]
  draw_count: number
  label: string
}

interface Segment {
  type?: string
  id?: string
  text?: string
}

interface PromptState {
  segments: Segment[]
  library: Record<string, unknown>
}

interface DrawReport {
  id: string
  label: string
  drawn: string[]
}

function fisherYatesShuffle<T>(arr: T[], random: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function normalizeLibrary(raw: Record<string, unknown>): Record<string, LibraryEntry> {
  const result: Record<string, LibraryEntry> = {}
  for (const key of Object.keys(raw)) {
    const val = raw[key]
    if (Array.isArray(val)) {
      result[key] = {
        entries: normalize_entries(val),
        draw_count: 1,
        label: '',
      }
    } else if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>
      result[key] = {
        entries: normalize_entries(obj.entries),
        draw_count: normalize_draw_count(obj.draw_count),
        label: typeof obj.label === 'string' ? obj.label : '',
      }
    }
  }
  return result
}

export function render_prompt(
  state: PromptState | string,
  seed = 0,
  missing_policy: 'keep_label' | 'empty' = 'keep_label',
): [string, DrawReport[]] {
  let parsed: PromptState
  if (typeof state === 'string') {
    if (state === '') return ['', []]
    try {
      parsed = JSON.parse(state) as PromptState
    } catch {
      return ['', []]
    }
  } else {
    parsed = state
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    return ['', []]
  }
  if (!parsed.library || typeof parsed.library !== 'object') {
    return ['', []]
  }

  const library = normalizeLibrary(parsed.library)
  const rng = seed > 0 ? createRng(seed) : null
  const random = rng ? () => rng.random() : () => Math.random()

  const parts: string[] = []
  const reports: DrawReport[] = []

  for (const seg of parsed.segments) {
    if (seg.type === 'text') {
      parts.push(seg.text ?? '')
    } else if (seg.type === 'wildcard') {
      const id = seg.id ?? ''
      const entry = library[id]
      if (entry && entry.entries.length > 0) {
        const count = Math.min(entry.draw_count, entry.entries.length)
        const shuffled = fisherYatesShuffle(entry.entries, random)
        const drawn = shuffled.slice(0, count)
        parts.push(drawn.join(', '))
        reports.push({ id, label: entry.label, drawn })
      } else {
        if (missing_policy === 'keep_label') {
          parts.push(entry ? entry.label : '')
        } else {
          parts.push('')
        }
      }
    }
  }

  return [parts.join(''), reports]
}
