import type {
  CompositeOutputPresetGroup,
  CompositeProductSizeRule,
  CompositeSelectedOutputRule,
} from './compositeTypes'

function rule(id: string, name: string, width: number, height: number, maxSizeKb: number): CompositeProductSizeRule {
  return {
    id,
    name,
    enabled: false,
    width,
    height,
    outputPath: '',
    namingTemplate: '{date}-{product}-{size}-{category}-{index}',
    maxSizeKb,
    format: 'jpg',
  }
}

export function createDefaultCompositeOutputPresetGroups(): CompositeOutputPresetGroup[] {
  return [
    {
      id: 'gdt-toutiao',
      name: '广点通/头条',
      rules: [
        rule('gdt-toutiao-1280x720', '1280x720', 1280, 720, 399),
        rule('gdt-toutiao-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'baidu',
      name: '百度',
      rules: [
        rule('baidu-1140x640', '1140x640', 1140, 640, 299),
        rule('baidu-370x245', '370x245', 370, 245, 299),
        rule('baidu-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'vendor',
      name: '厂商',
      rules: [
        rule('vendor-1280x720', '1280x720', 1280, 720, 99),
        rule('vendor-1080x1920', '1080x1920', 1080, 1920, 99),
        rule('vendor-320x211', '320x211', 320, 211, 80),
        rule('vendor-320x210', '320x210', 320, 210, 80),
      ],
    },
  ]
}

export function getSelectedCompositeOutputRules(groups: CompositeOutputPresetGroup[]): CompositeSelectedOutputRule[] {
  return groups.flatMap((group) =>
    group.rules.filter((rule) => rule.enabled).map((rule) => ({ ...rule, categoryName: group.name })),
  )
}
