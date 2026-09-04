import type { ApiProfile, AppSettings } from '../types'

export interface ApiSecretBundle {
  version: 1
  imageProfiles: Record<string, string>
  agentProfiles: Record<string, string>
}

function stripProfileSecret(profile: ApiProfile): ApiProfile {
  return profile.apiKey ? { ...profile, apiKey: '' } : profile
}

export function extractApiSecrets(settings: AppSettings): ApiSecretBundle {
  return {
    version: 1,
    imageProfiles: Object.fromEntries(
      settings.profiles.filter((profile) => profile.apiKey).map((profile) => [profile.id, profile.apiKey]),
    ),
    agentProfiles: Object.fromEntries(
      settings.agentProfiles.filter((profile) => profile.apiKey).map((profile) => [profile.id, profile.apiKey]),
    ),
  }
}

export function stripApiSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKey: '',
    profiles: settings.profiles.map(stripProfileSecret),
    agentProfiles: settings.agentProfiles.map(stripProfileSecret),
    agentProfile: stripProfileSecret(settings.agentProfile),
  }
}

export function applyApiSecrets(settings: AppSettings, secrets: ApiSecretBundle): AppSettings {
  const profiles = settings.profiles.map((profile) => ({
    ...profile,
    apiKey: secrets.imageProfiles[profile.id] ?? profile.apiKey,
  }))
  const agentProfiles = settings.agentProfiles.map((profile) => ({
    ...profile,
    apiKey: secrets.agentProfiles[profile.id] ?? profile.apiKey,
  }))
  const activeProfile = profiles.find((profile) => profile.id === settings.activeProfileId) ?? profiles[0]
  const activeAgentProfile =
    agentProfiles.find((profile) => profile.id === settings.activeAgentProfileId) ?? agentProfiles[0]
  return {
    ...settings,
    apiKey: activeProfile?.apiKey ?? settings.apiKey,
    profiles,
    agentProfiles,
    agentProfile: activeAgentProfile ?? settings.agentProfile,
  }
}
