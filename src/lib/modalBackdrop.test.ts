import { describe, expect, it } from 'vitest'
import { isModalBackdropEvent } from './modalBackdrop'

describe('modal backdrop interaction', () => {
  it('recognizes an interaction on the backdrop itself', () => {
    const backdrop = new EventTarget()
    expect(isModalBackdropEvent({ target: backdrop, currentTarget: backdrop })).toBe(true)
  })

  it('ignores interactions that started inside the modal content', () => {
    expect(
      isModalBackdropEvent({
        target: new EventTarget(),
        currentTarget: new EventTarget(),
      }),
    ).toBe(false)
  })
})
