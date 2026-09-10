import { beforeEach, describe, expect, it } from 'vitest'
import type { ExportGroup, ExportRule, WatermarkTemplate } from './storePostprocess'
import { getPostprocessPersistedState, replacePostprocessPersistedState, usePostprocessStore } from './storePostprocess'

describe('postprocess backup snapshot', () => {
  beforeEach(() => {
    usePostprocessStore.setState({ templates: [], rules: [], groups: [] })
  })

  it('round trips templates, rules and groups', () => {
    const snapshot = {
      templates: [
        {
          id: 'template-a',
          name: 'A',
          type: 'text',
          anchor: 'center',
          scalePercent: 6,
          marginPercent: 5,
        } satisfies WatermarkTemplate,
      ],
      rules: [
        {
          id: 'rule-a',
          name: 'R',
          templateId: 'template-a',
          resizeEnabled: false,
          targetWidth: null,
          targetHeight: null,
          resizeMode: 'contain',
          compressEnabled: false,
          format: 'png',
          maxSizeKb: null,
          outputDir: '',
          fileNamePattern: '{image}',
        } satisfies ExportRule,
      ],
      groups: [{ id: 'group-a', name: 'G', ruleIds: ['rule-a'] } satisfies ExportGroup],
    }

    replacePostprocessPersistedState(snapshot)

    expect(getPostprocessPersistedState()).toEqual(snapshot)
  })
})
