import { describe, expect, it, vi } from 'vitest'
import { ByteLruCache } from './byteLruCache'

describe('ByteLruCache', () => {
  it('evicts the least recently used values until under budget', () => {
    const cache = new ByteLruCache<string, string>(10)
    cache.set('a', 'first', 6)
    cache.set('b', 'second', 4)
    cache.get('a')
    cache.set('c', 'third', 4)

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.bytes).toBe(10)
  })

  it('allows one oversized most-recent value', () => {
    const cache = new ByteLruCache<string, string>(10)
    cache.set('large', 'value', 12)

    expect(cache.has('large')).toBe(true)
    expect(cache.bytes).toBe(12)
  })

  it('disposes evicted, deleted and cleared values', () => {
    const dispose = vi.fn()
    const cache = new ByteLruCache<string, string>(5, dispose)
    cache.set('a', 'first', 3)
    cache.set('b', 'second', 3)
    cache.delete('b')
    cache.set('c', 'third', 2)
    cache.clear()

    expect(dispose).toHaveBeenCalledWith('first', 'a')
    expect(dispose).toHaveBeenCalledWith('second', 'b')
    expect(dispose).toHaveBeenCalledWith('third', 'c')
  })
})
