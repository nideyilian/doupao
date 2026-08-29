type CacheEntry<V> = {
  value: V
  bytes: number
}

export class ByteLruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()
  private totalBytes = 0

  constructor(
    private readonly maxBytes: number,
    private readonly dispose?: (value: V, key: K) => void,
  ) {}

  get size() {
    return this.entries.size
  }

  get bytes() {
    return this.totalBytes
  }

  has(key: K) {
    return this.entries.has(key)
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V, bytes: number) {
    this.delete(key)
    const entry = { value, bytes: Math.max(0, bytes) }
    this.entries.set(key, entry)
    this.totalBytes += entry.bytes
    this.evict()
    return this
  }

  delete(key: K) {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    this.totalBytes -= entry.bytes
    this.dispose?.(entry.value, key)
    return true
  }

  clear() {
    for (const [key, entry] of this.entries) this.dispose?.(entry.value, key)
    this.entries.clear()
    this.totalBytes = 0
  }

  private evict() {
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value as K | undefined
      if (oldestKey === undefined) return
      this.delete(oldestKey)
    }
  }
}
