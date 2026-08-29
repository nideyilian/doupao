import { describe, expect, it } from 'vitest'
import { VAR_END, VAR_START } from './promptImageMentions'
import { normalizePromptVariableMarkers, replaceVariableNameInPrompt } from './promptVariableEditor'

const variable = (name: string) => `${VAR_START}${name}${VAR_END}`

describe('prompt variable editor helpers', () => {
  it('renames only matching variable markers in a prompt', () => {
    const prompt = `A ${variable('style')} portrait with ${variable('style2')} and ${variable('style')}`

    expect(replaceVariableNameInPrompt(prompt, 'style', 'mood')).toBe(
      `A ${variable('mood')} portrait with ${variable('style2')} and ${variable('mood')}`,
    )
  })

  it('leaves the prompt unchanged when the name does not change', () => {
    const prompt = `A ${variable('style')} portrait`

    expect(replaceVariableNameInPrompt(prompt, 'style', 'style')).toBe(prompt)
  })

  it('converts deleted variable markers back to plain text', () => {
    const prompt = `A ${variable('style')} portrait with ${variable('lighting')}`

    expect(normalizePromptVariableMarkers(prompt, ['style'])).toBe(`A ${variable('style')} portrait with lighting`)
  })

  it('trims variable names before checking active entries', () => {
    const prompt = `A ${variable(' style ')} portrait`

    expect(normalizePromptVariableMarkers(prompt, ['style'])).toBe(prompt)
  })
})
