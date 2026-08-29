import { describe, expect, it } from 'vitest'
import { REQUIREMENT_PROTOTYPE_STORE_VERSION, migrateRequirementPrototypeState } from './store'
import { seedSopMetaInstructions } from '../strategy/sopLibrary'

describe('requirement prototype store migration', () => {
  it('upgrades existing workspaces and injects the prompt reverse SOP compiler', () => {
    const existingInstruction = {
      ...seedSopMetaInstructions()[0],
      instruction: '用户修改后的通用元指令',
    }

    const migrated = migrateRequirementPrototypeState({
      strategyAssets: [],
      strategyPresets: [],
      sopGroups: [],
      sopLibrary: [],
      sopMetaInstructions: [existingInstruction],
      strategyAssetVersions: {},
    })

    expect(REQUIREMENT_PROTOTYPE_STORE_VERSION).toBe(5)
    expect(migrated.sopMetaInstructions.find((item) => item.id === existingInstruction.id)?.instruction).toBe(
      '用户修改后的通用元指令',
    )
    expect(migrated.sopMetaInstructions.find((item) => item.id === 'sop-meta-prompt-reverse')).toMatchObject({
      name: '提示词反推 SOP 编译器',
      kind: 'prompt-reverse',
    })
    expect(migrated.sopVersionHistory).toEqual({})
  })
})
