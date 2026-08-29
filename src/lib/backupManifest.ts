import type { AppSettings } from '../types'

export function sanitizeSettingsForBackup(settings: AppSettings, includeSecrets: boolean): AppSettings {
  if (includeSecrets) return settings
  return {
    ...settings,
    apiKey: '',
    profiles: settings.profiles.map((profile) => ({ ...profile, apiKey: '' })),
    agentProfiles: settings.agentProfiles.map((profile) => ({ ...profile, apiKey: '' })),
    agentProfile: { ...settings.agentProfile, apiKey: '' },
  }
}
