import { describe, expect, it } from 'vitest'
import { measureCompositeTextBox } from './compositeTextLayout'
import type { CompositeV2TextLayer } from './compositeV2Types'

function textLayer(patch: Partial<CompositeV2TextLayer> = {}): CompositeV2TextLayer {
  return {
    id: 'text-a',
    type: 'text',
    name: 'Text Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free', x: 0, y: 0, width: 1, height: 1 },
    shadow: { enabled: false, color: '#000000', x: 0, y: 0, blur: 0, opacity: 0 },
    text: 'AB',
    fontFamily: 'sans-serif',
    fontSize: 20,
    fontWeight: 400,
    color: '#000000',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: 5,
    stroke: { enabled: false, color: '#000000', width: 0 },
    ...patch,
  }
}

describe('composite text layout', () => {
  it('sizes a single line from measured width and padding', () => {
    expect(measureCompositeTextBox(textLayer(), () => 20)).toEqual({
      width: 30,
      height: 34,
    })
  })

  it('uses the longest line, line count, letter spacing, and padding', () => {
    const layer = textLayer({
      text: 'ABC\nD',
      letterSpacing: 2,
      padding: 6,
    })

    expect(measureCompositeTextBox(layer, (line) => line.length * 10)).toEqual({
      width: 46,
      height: 60,
    })
  })
})
