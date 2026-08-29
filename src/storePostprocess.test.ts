import { beforeEach, describe, expect, it } from 'vitest'
import { getPostprocessPersistedState, replacePostprocessPersistedState, usePostprocessStore } from './storePostprocess'

describe('postprocess backup snapshot', () => {
  beforeEach(() => {
    usePostprocessStore.setState({ templates: [], rules: [], groups: [] })
  })

  it('round trips templates, rules and groups', () => {
    const snapshot = {
      templates: [{ id: 'template-a', name: 'A' }],
      rules: [{ id: 'rule-a', name: 'R' }],
      groups: [{ id: 'group-a', name: 'G' }],
    } as any

    replacePostprocessPersistedState(snapshot)

    expect(getPostprocessPersistedState()).toEqual(snapshot)
  })
})
