import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './trusted-renderer'

describe('isTrustedRendererUrl', () => {
  it('accepts only the configured development origin', () => {
    expect(isTrustedRendererUrl('http://127.0.0.1:41731/settings', 'http://127.0.0.1:41731')).toBe(true)
    expect(isTrustedRendererUrl('http://127.0.0.1:41732/', 'http://127.0.0.1:41731')).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:41731.evil.test/', 'http://127.0.0.1:41731')).toBe(false)
  })

  it('rejects unrelated local files in packaged mode', () => {
    expect(isTrustedRendererUrl('file:///C:/Windows/System32/drivers/etc/hosts', '')).toBe(false)
  })
})
