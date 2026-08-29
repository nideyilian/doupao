import type {
  CompositeV2OutputRuleGroup,
  CompositeV2OutputSizeRule,
  CompositeV2Preset,
  CompositeV2PresetGroup,
  CompositeV2State,
} from './compositeV2Types'

function rule(id: string, name: string, width: number, height: number, maxSizeKb: number): CompositeV2OutputSizeRule {
  return {
    id,
    name,
    enabled: false,
    width,
    height,
    maxSizeKb,
    format: 'jpg',
    filenameTemplate: '{preset}-{source}-{index}',
  }
}

export function createDefaultCompositeV2OutputRuleGroups(): CompositeV2OutputRuleGroup[] {
  return [
    {
      id: 'gdt',
      name: '广点通',
      rules: [rule('gdt-1280x720', '1280x720', 1280, 720, 399), rule('gdt-1080x1920', '1080x1920', 1080, 1920, 399)],
      distributionPaths: [],
    },
    {
      id: 'baidu',
      name: '百度',
      rules: [
        rule('baidu-1140x640', '1140x640', 1140, 640, 299),
        rule('baidu-370x245', '370x245', 370, 245, 299),
        rule('baidu-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
      distributionPaths: [],
    },
    {
      id: 'vendor',
      name: '厂商',
      rules: [
        rule('vendor-1280x720', '1280x720', 1280, 720, 99),
        rule('vendor-1080x1920', '1080x1920', 1080, 1920, 99),
        rule('vendor-320x211', '320x211', 320, 211, 80),
        rule('vendor-320x210', '320x210', 320, 210, 80),
        rule('vendor-720x1280', '720x1280', 720, 1280, 99),
        rule('vendor-720x498', '720x498', 720, 498, 99),
        rule('vendor-474x768', '474x768', 474, 768, 99),
        rule('vendor-1080x528', '1080x528', 1080, 528, 99),
      ],
      distributionPaths: [],
    },
    {
      id: 'toutiao',
      name: '头条',
      rules: [
        rule('toutiao-1080x1920', '1080x1920', 1080, 1920, 399),
        rule('toutiao-1280x720', '1280x720', 1280, 720, 399),
      ],
      distributionPaths: [],
    },
  ]
}

export function createDefaultCompositeV2Preset(now = Date.now()): CompositeV2Preset {
  return {
    id: 'preset-default',
    name: '默认产品预设',
    outputRootPath: '',
    distributionPath: '',
    filenameTemplate: '{preset}-{source}-{index}',
    customVariableValues: {},
    baseCanvas: { width: 1280, height: 720 },
    sampleBackgroundPath: '',
    layers: [],
    useOutputOverrides: false,
    outputRuleGroupsOverride: [],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2PresetGroup(now = Date.now()): CompositeV2PresetGroup {
  return {
    id: 'group-default',
    name: '默认预设组',
    presetIds: ['preset-default'],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2State(now = Date.now()): CompositeV2State {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return {
    logoLibraryPath: '',
    logoOrder: [],
    projectLogos: [],
    customVariables: [],
    presets: [createDefaultCompositeV2Preset(now)],
    presetGroups: [createDefaultCompositeV2PresetGroup(now)],
    outputRuleGroups: createDefaultCompositeV2OutputRuleGroups(),
    globalFitMode: 'crop-fill',
    historyRetention: 10,
    history: [],
    distributionConfig: {
      enabled: false,
      startDate: dateStr,
      days: 5,
      mode: 'copy',
      randomize: true,
      skipWeekends: false,
      renameMode: 'date',
      modifyMd5: false,
    },
  }
}
