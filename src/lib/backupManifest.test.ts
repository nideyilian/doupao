import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../types'
import { sanitizeSettingsForBackup } from './backupManifest'

describe('sanitizeSettingsForBackup', () => {
  it('removes every API key by default without mutating live settings', () => {
    const settings = {
      apiKey: 'legacy-secret',
      profiles: [{ id: 'profile-a', apiKey: 'profile-secret' }],
      agentProfiles: [{ id: 'agent-a', apiKey: 'agent-secret' }],
      agentProfile: { id: 'agent-a', apiKey: 'agent-secret' },
    } as AppSettings

    const sanitized = sanitizeSettingsForBackup(settings, false)

    expect(sanitized.apiKey).toBe('')
    expect(sanitized.profiles[0]?.apiKey).toBe('')
    expect(sanitized.agentProfiles[0]?.apiKey).toBe('')
    expect(sanitized.agentProfile.apiKey).toBe('')
    expect(settings.apiKey).toBe('legacy-secret')
    expect(settings.profiles[0]?.apiKey).toBe('profile-secret')
  })

  it('preserves keys only when explicitly requested', () => {
    const settings = {
      apiKey: 'legacy-secret',
      profiles: [{ id: 'profile-a', apiKey: 'profile-secret' }],
      agentProfiles: [{ id: 'agent-a', apiKey: 'agent-secret' }],
      agentProfile: { id: 'agent-a', apiKey: 'agent-secret' },
    } as AppSettings

    expect(sanitizeSettingsForBackup(settings, true)).toEqual(settings)
  })
})
