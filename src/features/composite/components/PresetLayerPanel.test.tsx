import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCompositeV2Store } from '../storeV2'
import { PresetLayerPanel } from './PresetLayerPanel'

describe('PresetLayerPanel', () => {
  it('shows layer order and selected layer properties in the bottom panel', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    store.getState().addTextLayer(presetId)
    store.getState().addImageLayer(presetId)
    store.getState().replaceOrAddLogoLayer(presetId, { kind: 'path', path: 'D:/logos/a.png' })
    const currentPreset = store.getState().presets[0]!
    store.getState().updatePreset(presetId, {
      layers: currentPreset.layers.map((layer, index) =>
        index === 0
          ? {
              ...layer,
              position: {
                mode: 'anchor',
                anchor: 'center',
                marginX: 0,
                marginY: 0,
                offsetX: 0,
                offsetY: 0,
                width: layer.position.width,
                height: layer.position.height,
              },
            }
          : layer,
      ),
    })
    const preset = store.getState().presets[0]!
    const selectedLayerId = preset.layers[0]!.id

    const html = renderToStaticMarkup(
      <PresetLayerPanel
        preset={preset}
        selectedLayerId={selectedLayerId}
        onSelectLayer={() => {}}
        onUpdatePreset={() => {}}
      />,
    )

    expect(html).toContain('图层信息')
    expect(html.indexOf('Text Layer')).toBeLessThan(html.indexOf('Image Layer'))
    expect(html).toContain('LOGO Layer')
    expect(html).toContain('LOGO ·')
    expect(html).toContain('data-layout="layer-properties"')
    expect(html).toContain('grid-cols-[300px_minmax(0,1fr)]')
    expect(html).toContain('data-layer-row="true"')
    expect(html).toContain('whitespace-nowrap')
    expect(html).not.toContain('data-layout="layer-properties" class="min-w-0 overflow-y-auto')
    expect(html).toContain('data-property-group="content"')
    expect(html).toContain('data-property-group="position-size"')
    expect(html).toContain('data-property-group="appearance"')
    expect(html).toContain('data-property-group="effects"')
    expect(html).toContain('内容')
    expect(html).toContain('位置与尺寸')
    expect(html).toContain('外观')
    expect(html).toContain('效果')
    expect(html).toContain('显示')
    expect(html).toContain('锁定')
    expect(html).toContain('透明度')
    expect(html).toContain('定位模式')
    expect(html).toContain('基础水平边距')
    expect(html).toContain('基础垂直边距')
    expect(html).toContain('额外水平偏移')
    expect(html).toContain('额外垂直偏移')
    expect(html).toContain('文字对齐')
    expect(html).toContain('左对齐')
    expect(html).toContain('居中对齐')
    expect(html).toContain('右对齐')
  })

  it('shows the real anchor margins for a default logo layer', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    const logoLayerId = store
      .getState()
      .replaceOrAddLogoLayer(presetId, { kind: 'path', path: 'D:/logos/软件LOGO.png' })
    const preset = store.getState().presets[0]!

    const html = renderToStaticMarkup(
      <PresetLayerPanel
        preset={preset}
        selectedLayerId={logoLayerId}
        onSelectLayer={() => {}}
        onUpdatePreset={() => {}}
      />,
    )

    expect(html).toContain('基础水平边距')
    expect(html).toContain('基础垂直边距')
    expect((html.match(/value="20"/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('描边')
    expect(html).toContain('描边颜色')
    expect(html).toContain('描边宽度')
    expect(html).toContain('软件LOGO')
  })
})
