import type {
  CompositeLayer,
  CompositeProductSizeRule,
  CompositePreset,
  CompositeWatermarkGroup,
  CompositeWatermarkKind,
  CompositeWatermarkPreset,
} from './compositeTypes'

function cloneLayer(layer: CompositeLayer): CompositeLayer {
  return JSON.parse(JSON.stringify(layer)) as CompositeLayer
}

function inferWatermarkKind(layers: CompositeLayer[]): CompositeWatermarkKind {
  const hasText = layers.some((layer) => layer.type === 'text' || layer.type === 'watermark')
  const hasIcon = layers.some((layer) => layer.type === 'logo' || layer.type === 'image')
  if (hasText && hasIcon) return 'iconText'
  if (hasText) return 'text'
  if (hasIcon) return 'icon'
  return 'custom'
}

function createDefaultSizeRule(id: string): CompositeProductSizeRule {
  return {
    id,
    name: '主尺寸输出',
    enabled: true,
    width: 1280,
    height: 720,
    outputPath: '',
    namingTemplate: '{date}-{product}-{size}-{category}-{index}',
    maxSizeKb: 350,
    format: 'jpg',
  }
}

export function createWatermarkPresetFromLayers({
  id,
  name,
  layers,
}: {
  id: string
  name: string
  layers: CompositeLayer[]
}): CompositeWatermarkPreset {
  const watermarkLayers = layers.filter((layer) => layer.type !== 'background').map((layer) => cloneLayer(layer))
  return {
    id,
    name,
    kind: inferWatermarkKind(watermarkLayers),
    enabled: true,
    layers: watermarkLayers,
    sizeRules: [createDefaultSizeRule(`${id}-main`)],
    namingTokens: [],
    distribution: {
      enabled: false,
      outputPath: '',
      count: 0,
    },
  }
}

export function duplicateWatermarkPreset(preset: CompositeWatermarkPreset, nextId: string): CompositeWatermarkPreset {
  return {
    ...(JSON.parse(JSON.stringify(preset)) as CompositeWatermarkPreset),
    id: nextId,
    name: `${preset.name} 副本`,
  }
}

export function resolveWatermarkPresetSelection(
  presets: CompositeWatermarkPreset[],
  groups: CompositeWatermarkGroup[],
  presetIds: string[],
  groupIds: string[],
) {
  const byPresetId = new Map(presets.map((preset) => [preset.id, preset]))
  const orderedIds = [
    ...presetIds,
    ...groupIds.flatMap((groupId) => groups.find((group) => group.id === groupId)?.presetIds ?? []),
  ]
  const seen = new Set<string>()
  const resolved: CompositeWatermarkPreset[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const preset = byPresetId.get(id)
    if (!preset || !preset.enabled) continue
    seen.add(id)
    resolved.push(preset)
  }
  return resolved
}

export function applyWatermarkPresetsToPreset(
  basePreset: CompositePreset,
  presets: CompositeWatermarkPreset[],
): CompositePreset {
  const generatedLayers = presets.flatMap((preset) =>
    preset.layers.map(
      (layer, index) =>
        ({
          ...cloneLayer(layer),
          id: `${preset.id}-${layer.id}-${index}`,
          watermarkPresetId: preset.id,
        }) as CompositeLayer,
    ),
  )
  return {
    ...basePreset,
    layers: [...basePreset.layers.filter((layer) => !layer.watermarkPresetId), ...generatedLayers],
  }
}
