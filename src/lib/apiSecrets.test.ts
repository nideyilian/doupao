import { describe, expect, it } from 'vitest'
import {
  createDefaultAgentProfile,
  createDefaultOpenAIProfile,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from './apiProfiles'
import { applyApiSecrets, extractApiSecrets, stripApiSecrets } from './apiSecrets'

describe('API secret persistence', () => {
  it('removes API keys from the ordinary settings payload', () => {
    const image = createDefaultOpenAIProfile({ id: 'image-a', apiKey: 'image-secret' })
    const agent = createDefaultAgentProfile({ id: 'agent-a', apiKey: 'agent-secret' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [image],
      activeProfileId: image.id,
      agentProfiles: [agent],
      activeAgentProfileId: agent.id,
      agentProfile: agent,
    })

    const stripped = stripApiSecrets(settings)

    expect(stripped.apiKey).toBe('')
    expect(stripped.profiles[0]?.apiKey).toBe('')
    expect(stripped.agentProfiles[0]?.apiKey).toBe('')
    expect(stripped.agentProfile.apiKey).toBe('')
  })

  it('restores image and Agent keys by stable profile id', () => {
    const image = createDefaultOpenAIProfile({ id: 'image-a', apiKey: 'image-secret' })
    const agent = createDefaultAgentProfile({ id: 'agent-a', apiKey: 'agent-secret' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [image],
      activeProfileId: image.id,
      agentProfiles: [agent],
      activeAgentProfileId: agent.id,
      agentProfile: agent,
    })
    const secrets = extractApiSecrets(settings)
    const restored = applyApiSecrets(stripApiSecrets(settings), secrets)

    expect(restored.apiKey).toBe('image-secret')
    expect(restored.profiles[0]?.apiKey).toBe('image-secret')
    expect(restored.agentProfiles[0]?.apiKey).toBe('agent-secret')
    expect(restored.agentProfile.apiKey).toBe('agent-secret')
  })
})
