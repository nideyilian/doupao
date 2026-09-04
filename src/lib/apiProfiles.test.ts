import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE } from '../types'
import {
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  createDefaultAgentProfile,
  createDefaultOpenAIProfile,
  createDefaultFalProfile,
  findEquivalentApiProfile,
  getAgentImageApiProfile,
  getAgentProfileValidationError,
  getAgentTextApiProfile,
  importCustomProviderDefinitionFromJson,
  importCustomProviderSettingsFromJson,
  isGeminiModel,
  mergeImportedSettings,
  normalizeSettings,
  switchApiProfileProvider,
  validateApiProfile,
} from './apiProfiles'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('backup settings', () => {
  it('uses 600 minutes as the default automatic backup interval', () => {
    expect(DEFAULT_SETTINGS.backupInterval).toBe(600)
    expect(normalizeSettings({}).backupInterval).toBe(600)
  })

  it('keeps an explicit zero-minute backup interval for every-save backups', () => {
    expect(normalizeSettings({ backupInterval: 0 }).backupInterval).toBe(0)
  })
})

describe('API transport mode', () => {
  it('defaults to automatic transport and preserves the renderer fallback', () => {
    expect(normalizeSettings({}).apiTransportMode).toBe('auto')
    expect(normalizeSettings({ apiTransportMode: 'renderer' }).apiTransportMode).toBe('renderer')
    expect(normalizeSettings({ apiTransportMode: 'invalid' as never }).apiTransportMode).toBe('auto')
  })
})

describe('Agent API configuration mode', () => {
  it('defaults to native mode and preserves hybrid mode', () => {
    expect(normalizeSettings({}).agentApiConfigMode).toBe('native')
    expect(normalizeSettings({ agentApiConfigMode: 'hybrid' }).agentApiConfigMode).toBe('hybrid')
    expect(normalizeSettings({}).allowPromptRewrite).toBe(false)
    expect(normalizeSettings({ allowPromptRewrite: true }).allowPromptRewrite).toBe(true)
    expect(normalizeSettings({}).agentTextProtocol).toBe('responses')
    expect(normalizeSettings({ agentTextProtocol: 'chat-completions' }).agentTextProtocol).toBe('chat-completions')
  })

  it('shares connection parameters while keeping a separate Agent model', () => {
    const imageProfile = createDefaultOpenAIProfile({
      id: 'gallery-image',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'shared-key',
      model: 'image-model',
      timeout: 180,
    })
    const settings = normalizeSettings({
      profiles: [imageProfile],
      activeProfileId: imageProfile.id,
      agentShareApiParameters: true,
      agentProfile: createDefaultOpenAIProfile({
        id: 'agent-text',
        model: 'text-model',
        apiMode: 'responses',
      }),
    })

    expect(getAgentTextApiProfile(settings)).toMatchObject({
      id: 'agent-text',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'shared-key',
      model: 'text-model',
      timeout: 180,
      apiMode: 'responses',
    })
    expect(getAgentImageApiProfile(settings).model).toBe('text-model')
  })

  it('migrates the legacy shared Agent default to a Responses model', () => {
    const settings = normalizeSettings({
      agentUseCustomProfile: false,
      agentProfile: createDefaultOpenAIProfile({ id: 'agent-default', name: 'Agent 默认' }),
    })

    expect(settings.agentShareApiParameters).toBe(true)
    expect(settings.agentProfile.model).toBe(DEFAULT_RESPONSES_MODEL)
    expect(settings.agentProfile.apiMode).toBe('responses')
  })

  it('uses the Agent profile for text and the active gallery profile for hybrid images', () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'gallery-image' })
    const settings = normalizeSettings({
      agentApiConfigMode: 'hybrid',
      agentProfileId: textProfile.id,
      activeProfileId: imageProfile.id,
      profiles: [textProfile, imageProfile],
    })

    expect(getAgentTextApiProfile(settings)?.id).toBe(textProfile.id)
    expect(getAgentImageApiProfile(settings)?.id).toBe(imageProfile.id)
  })

  it('automatically uses Chat Completions hybrid mode for Gemini models', () => {
    const imageProfile = createDefaultOpenAIProfile({
      id: 'image-profile',
      apiKey: 'image-key',
      model: 'gpt-image-2',
    })
    const settings = normalizeSettings({
      agentProfile: createDefaultOpenAIProfile({
        id: 'agent-gemini',
        baseUrl: 'https://jbbt.pages.dev/v1',
        apiKey: 'test-key',
        model: 'google/gemini-2.5-pro',
        apiMode: 'responses',
      }),
      agentShareApiParameters: false,
      agentApiConfigMode: 'native',
      agentTextProtocol: 'responses',
      profiles: [imageProfile],
      activeProfileId: imageProfile.id,
    })

    expect(isGeminiModel('gemini-2.5-pro')).toBe(true)
    expect(settings.agentApiConfigMode).toBe('hybrid')
    expect(settings.agentTextProtocol).toBe('chat-completions')
    expect(getAgentTextApiProfile(settings).model).toBe('google/gemini-2.5-pro')
    expect(getAgentProfileValidationError(settings)).toBeNull()
  })

  it('keeps Responses mode for non-Gemini models', () => {
    const settings = normalizeSettings({
      agentApiConfigMode: 'native',
      agentTextProtocol: 'responses',
      agentProfile: createDefaultAgentProfile({ model: 'gpt-5.5' }),
    })

    expect(isGeminiModel('gpt-5.5')).toBe(false)
    expect(settings.agentApiConfigMode).toBe('native')
    expect(settings.agentTextProtocol).toBe('responses')
  })

  it('normalizes multiple Agent services and keeps the active one as the mirror', () => {
    const first = createDefaultOpenAIProfile({ id: 'agent-a', name: '服务 A', apiMode: 'responses' })
    const second = createDefaultOpenAIProfile({ id: 'agent-b', name: '服务 B', apiMode: 'responses' })
    const settings = normalizeSettings({
      agentShareApiParameters: false,
      agentProfiles: [first, second],
      activeAgentProfileId: 'agent-b',
    })

    expect(settings.agentProfiles.map((profile) => profile.id)).toEqual(['agent-a', 'agent-b'])
    expect(settings.activeAgentProfileId).toBe('agent-b')
    expect(settings.agentProfile.id).toBe('agent-b')
    expect(settings.agentProfile.name).toBe('服务 B')
    expect(getAgentTextApiProfile(settings).id).toBe('agent-b')
  })

  it('falls back to a single Agent service when no list is persisted', () => {
    const legacy = createDefaultOpenAIProfile({ id: 'agent-legacy', name: '旧 Agent', apiMode: 'responses' })
    const settings = normalizeSettings({
      agentShareApiParameters: false,
      agentProfile: legacy,
    })

    expect(settings.agentProfiles).toHaveLength(1)
    expect(settings.agentProfiles[0]?.id).toBe('agent-legacy')
    expect(settings.activeAgentProfileId).toBe('agent-legacy')
    expect(settings.agentProfile.id).toBe('agent-legacy')
  })
})

describe('generated image filename settings', () => {
  it('enables the generation date and disables the prompt by default', () => {
    const settings = normalizeSettings({})

    expect(settings.imageFilenameDatePrefix).toBe(true)
    expect(settings.imageFilenameUsePrompt).toBe(false)
  })

  it('preserves explicit filename settings', () => {
    const settings = normalizeSettings({
      imageFilenameDatePrefix: false,
      imageFilenameUsePrompt: true,
    })

    expect(settings.imageFilenameDatePrefix).toBe(false)
    expect(settings.imageFilenameUsePrompt).toBe(true)
  })

  it('keeps flat image saving as the default layout', () => {
    expect(DEFAULT_SETTINGS.imageSaveLayout).toBe('flat')
    expect(normalizeSettings({}).imageSaveLayout).toBe('flat')
    expect(normalizeSettings({ imageSaveLayout: 'batch-folder' }).imageSaveLayout).toBe('batch-folder')
  })
})

describe('word library derivative rule settings', () => {
  it('creates the built-in default rule as the enabled default', () => {
    const settings = normalizeSettings({})

    expect(settings.wordLibraryDerivativeRuleMode).toBe('single')
    expect(settings.wordLibraryDerivativeRules).toEqual([
      {
        id: 'default',
        name: '默认规则',
        content: DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE,
        enabled: true,
        builtIn: true,
      },
    ])
  })

  it('migrates a legacy custom derivative rule into an enabled custom rule', () => {
    const settings = normalizeSettings({
      wordLibraryDerivativeRule: 'Only replace color adjectives.',
    })

    expect(settings.wordLibraryDerivativeRuleMode).toBe('single')
    expect(settings.wordLibraryDerivativeRules).toEqual([
      {
        id: 'default',
        name: '默认规则',
        content: DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE,
        enabled: false,
        builtIn: true,
      },
      {
        id: 'custom-legacy',
        name: '自定义规则',
        content: 'Only replace color adjectives.',
        enabled: true,
      },
    ])
  })
})

describe('validateApiProfile', () => {
  it('allows empty API URL when API proxy is enabled and available', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')

    expect(
      validateApiProfile(
        createDefaultOpenAIProfile({
          baseUrl: '',
          apiKey: 'test-key',
          apiProxy: true,
        }),
      ),
    ).toBeNull()
  })

  it('still requires API URL when API proxy is unavailable', () => {
    expect(
      validateApiProfile(
        createDefaultOpenAIProfile({
          baseUrl: '',
          apiKey: 'test-key',
          apiProxy: true,
        }),
      ),
    ).toBe('缺少 API URL')
  })
})

describe('mergeImportedSettings', () => {
  it('replaces the default OpenAI profile with legacy imported settings when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })

    expect(merged.profiles).toHaveLength(1)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })
  })

  it('replaces the default provider list with imported profiles when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-fal',
          name: 'Imported fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-fal',
    })

    expect(merged.profiles.map((profile) => profile.id)).toEqual(['imported-openai', 'imported-fal'])
    expect(merged.activeProfileId).toBe('imported-fal')
  })

  it('deduplicates imported profiles when replacing untouched default settings', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai-a',
          name: 'Imported OpenAI A',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-openai-b',
          name: 'Imported OpenAI B',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1/',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
      ],
      activeProfileId: 'imported-openai-b',
    })

    expect(merged.profiles).toHaveLength(1)
    expect(merged.profiles[0].id).toBe('imported-openai-a')
    expect(merged.activeProfileId).toBe('imported-openai-a')
  })

  it('appends imported legacy settings as a new profile when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })
    expect(merged.profiles[1].id).not.toBe(DEFAULT_OPENAI_PROFILE_ID)
  })

  it('appends imported profiles as new profiles when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://imported.example.com/v1',
          apiKey: 'imported-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-fal',
          name: 'Imported fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-fal',
    })

    expect(merged.profiles).toHaveLength(3)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({ name: 'Imported OpenAI', provider: 'openai', apiKey: 'imported-key' })
    expect(merged.profiles[2]).toMatchObject({ name: 'Imported fal', provider: 'fal', apiKey: 'fal-key' })
    expect(new Set(merged.profiles.map((profile) => profile.id)).size).toBe(3)
  })

  it('skips imported profiles that already exist in current customized settings', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'duplicate-openai',
          name: 'Duplicate OpenAI',
          provider: 'openai',
          baseUrl: 'https://current.example.com/v1/',
          apiKey: 'current-key',
          model: 'current-model',
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
        {
          id: 'new-fal',
          name: 'New fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles[1]).toMatchObject({ provider: 'fal', apiKey: 'fal-key', model: DEFAULT_FAL_MODEL })
  })

  it('reuses an existing keyed profile when importing the same custom profile without an API key', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      customProviders: [
        {
          id: 'custom-json',
          name: 'Custom JSON',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
          },
        },
      ],
      profiles: [
        {
          id: 'existing-custom',
          name: 'Existing Custom',
          provider: 'custom-json',
          baseUrl: 'https://custom.example.com/v1',
          apiKey: 'existing-key',
          model: 'custom-model',
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'existing-custom',
    })
    const imported = normalizeSettings({
      customProviders: [
        {
          id: 'custom-json',
          name: 'Custom JSON',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
          },
        },
      ],
      profiles: [
        {
          id: 'imported-custom',
          name: 'Imported Custom',
          provider: 'custom-json',
          baseUrl: 'https://custom.example.com/v1',
          apiKey: '',
          model: 'custom-model',
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })
    const merged = mergeImportedSettings(current, imported)
    const match = findEquivalentApiProfile(merged, imported.profiles[0], imported.customProviders)

    expect(merged.profiles).toHaveLength(1)
    expect(match?.id).toBe('existing-custom')
  })

  it('does not replace existing custom providers when only the default profile remains', () => {
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [
        {
          id: 'custom-existing',
          name: 'Existing Provider',
          submit: { path: 'images/generations' },
        },
      ],
    })
    const merged = mergeImportedSettings(current, {
      customProviders: [
        {
          id: 'custom-imported',
          name: 'Imported Provider',
          submit: { path: 'images/generations' },
        },
      ],
      profiles: [
        {
          id: 'imported-custom',
          name: 'Imported Custom',
          provider: 'custom-imported',
          baseUrl: 'https://custom.example.com/v1',
          apiKey: '',
          model: 'custom-model',
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(merged.customProviders.map((provider) => provider.id)).toEqual(['custom-existing', 'custom-imported'])
    expect(merged.profiles).toHaveLength(2)
  })

  it('appends imported custom providers and keeps imported custom profile references', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      customProviders: [
        {
          id: 'custom-json',
          name: 'Custom JSON',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
          },
        },
      ],
      profiles: [
        {
          id: 'imported-custom',
          name: 'Imported Custom',
          provider: 'custom-json',
          baseUrl: 'https://custom.example.com/v1',
          apiKey: 'custom-key',
          model: 'custom-model',
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(merged.customProviders).toHaveLength(1)
    expect(merged.customProviders[0]).toMatchObject({ id: 'custom-json', name: 'Custom JSON' })
    expect(merged.profiles).toHaveLength(2)
    expect(merged.profiles[1]).toMatchObject({
      name: 'Imported Custom',
      provider: 'custom-json',
      apiKey: 'custom-key',
      model: 'custom-model',
    })
  })
})

describe('custom providers', () => {
  it('normalizes custom provider definitions and keeps custom profiles', () => {
    const settings = normalizeSettings({
      customProviders: [
        {
          id: 'custom-async',
          name: 'Custom Async',
          template: 'openai-compatible-async',
          generationPath: '/v1/images/generations',
          editPath: '/v1/images/edits',
          taskPath: '/v1/images/tasks/{task_id}',
        },
      ],
      profiles: [
        {
          id: 'profile-custom',
          name: 'Custom Profile',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'key',
          model: 'model',
          timeout: 60,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'profile-custom',
    })

    expect(settings.customProviders[0]).toMatchObject({
      id: 'custom-async',
      template: 'http-image',
      submit: {
        path: 'images/generations',
        query: { async: 'true' },
        taskIdPath: 'data',
      },
      editSubmit: {
        path: 'images/edits',
        query: { async: 'true' },
        taskIdPath: 'data',
      },
      poll: {
        path: 'images/tasks/{task_id}',
      },
    })
    expect(settings.profiles[0].provider).toBe('custom-async')
  })

  it('normalizes an Apimart-style task manifest', () => {
    const provider = importCustomProviderDefinitionFromJson(
      JSON.stringify({
        name: 'Apimart GPT-Image-2',
        template: 'http-image',
        submit: {
          path: '/v1/images/generations',
          method: 'POST',
          contentType: 'json',
          body: {
            model: '$profile.model',
            prompt: '$prompt',
            n: '$params.n',
            size: '$params.size',
            resolution: '2k',
            image_urls: '$inputImages.dataUrls',
          },
          taskIdPath: 'data.0.task_id',
        },
        poll: {
          path: '/v1/tasks/{task_id}',
          method: 'GET',
          query: { language: 'zh' },
          statusPath: 'data.status',
          successValues: ['completed'],
          failureValues: ['failed', 'cancelled'],
          result: {
            imageUrlPaths: ['data.result.images.*.url.*'],
          },
        },
      }),
    )

    expect(provider).toMatchObject({
      template: 'http-image',
      submit: {
        path: 'images/generations',
        taskIdPath: 'data.0.task_id',
      },
      poll: {
        path: 'tasks/{task_id}',
        query: { language: 'zh' },
        successValues: ['completed'],
        result: {
          imageUrlPaths: ['data.result.images.*.url.*'],
        },
      },
    })
  })

  it('imports wrapped custom provider settings with profiles', () => {
    const imported = importCustomProviderSettingsFromJson(
      JSON.stringify({
        customProviders: [
          {
            id: 'custom-json',
            name: 'Custom JSON',
            submit: {
              path: 'images/generations',
              method: 'POST',
              contentType: 'json',
              body: { model: '$profile.model', prompt: '$prompt' },
              result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
            },
          },
        ],
        profiles: [
          {
            name: 'Custom JSON',
            provider: 'custom-json',
            baseUrl: 'https://custom.example.com/v1',
            model: 'custom-model',
            apiMode: 'images',
          },
        ],
      }),
    )

    expect(imported.customProviders[0]).toMatchObject({ id: 'custom-json', name: 'Custom JSON' })
    expect(imported.profiles[0]).toMatchObject({
      name: 'Custom JSON',
      provider: 'custom-json',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: '',
      model: 'custom-model',
      apiMode: 'images',
    })
  })

  it('imports wrapped custom provider settings from a json code block', () => {
    const imported = importCustomProviderSettingsFromJson(`\`\`\`json
{"customProviders":[{"id":"custom-json","name":"Custom JSON","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt"},"result":{"imageUrlPaths":["data.result.images.*.url.*"],"b64JsonPaths":[]}}}],"profiles":[{"name":"Custom JSON","provider":"custom-json","baseUrl":"https://custom.example.com/v1","model":"custom-model","apiMode":"images"}]}
\`\`\``)

    expect(imported.customProviders[0]).toMatchObject({ id: 'custom-json' })
    expect(imported.customProviders[0].submit.result).toMatchObject({
      imageUrlPaths: ['data.result.images.*.url.*'],
    })
    expect(imported.profiles[0]).toMatchObject({
      provider: 'custom-json',
      baseUrl: 'https://custom.example.com/v1',
    })
  })

  it('rejects markdown-corrupted profile fields when importing wrapped settings', () => {
    expect(() =>
      importCustomProviderSettingsFromJson(
        JSON.stringify({
          customProviders: [
            {
              id: 'custom-apimart',
              name: 'APIMart',
              submit: { path: 'images/generations' },
            },
          ],
          profiles: [
            {
              name: 'APIMart',
              provider: 'custom-apimart',
              baseUrl: '[https://api.apimart.ai/v1',
              model: 'gpt-image-2-official',
              apiMode:
                'images](https://api.apimart.ai/v1%22,%22model%22:%22gpt-image-2-official%22,%22apiMode%22:%22images)',
            },
          ],
        }),
      ),
    ).toThrow('JSON 包含 Markdown 链接')
  })

  it('does not inherit fal URL and model when switching to a custom provider', () => {
    const provider = importCustomProviderDefinitionFromJson(
      JSON.stringify({
        name: 'Custom Provider',
        template: 'http-image',
        submit: { path: 'images/generations' },
      }),
    )
    const profile = switchApiProfileProvider(createDefaultFalProfile(), provider.id, provider)

    expect(profile.provider).toBe(provider.id)
    expect(profile.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
    expect(profile.model).toBe(DEFAULT_IMAGES_MODEL)
  })

  it('enables streaming by default and preserves partial image count', () => {
    expect(createDefaultOpenAIProfile().streamImages).toBe(true)
    expect(createDefaultOpenAIProfile().streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.streamImages).toBe(true)
    expect(DEFAULT_SETTINGS.streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.profiles[0].streamImages).toBe(true)
    expect(DEFAULT_SETTINGS.profiles[0].streamPartialImages).toBe(1)

    const normalized = normalizeSettings({
      profiles: [createDefaultOpenAIProfile({ streamImages: false, streamPartialImages: 3 })],
    })

    expect(normalized.streamImages).toBe(false)
    expect(normalized.streamPartialImages).toBe(3)
    expect(normalized.profiles[0].streamImages).toBe(false)
    expect(normalized.profiles[0].streamPartialImages).toBe(3)

    const clamped = normalizeSettings({
      profiles: [createDefaultOpenAIProfile({ streamPartialImages: 8 })],
    })

    expect(clamped.profiles[0].streamPartialImages).toBe(3)
  })

  it('enables Agent submit auto scroll by default', () => {
    expect(DEFAULT_SETTINGS.agentScrollToBottomAfterSubmit).toBe(true)
    expect(normalizeSettings({}).agentScrollToBottomAfterSubmit).toBe(true)
    expect(normalizeSettings({ agentScrollToBottomAfterSubmit: false }).agentScrollToBottomAfterSubmit).toBe(false)
  })

  it('restores OpenAI-compatible URL after switching through fal.ai', () => {
    const openaiProfile = createDefaultOpenAIProfile({
      baseUrl: 'https://api.compat.example.com/v1',
      model: 'custom-openai-model',
      apiProxy: false,
    })

    const falProfile = switchApiProfileProvider(openaiProfile, 'fal')
    const restoredProfile = switchApiProfileProvider(falProfile, 'openai')

    expect(falProfile.baseUrl).toBe(DEFAULT_FAL_BASE_URL)
    expect(restoredProfile.baseUrl).toBe('https://api.compat.example.com/v1')
    expect(restoredProfile.model).toBe('custom-openai-model')
    expect(restoredProfile.apiProxy).toBe(false)
  })
})
