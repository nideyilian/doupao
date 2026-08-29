/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetOverlayManager,
  getOverlayStackSize,
  getTopOverlay,
  registerOverlay,
  unregisterOverlay,
  type OverlayEntry,
} from './overlayManager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): { ref: { current: HTMLElement | null }; element: HTMLElement } {
  const element = document.createElement('div')
  // Add a focusable button inside so auto-focus and focus trap have a target.
  element.innerHTML = '<button id="btn1">Btn 1</button><button id="btn2">Btn 2</button>'
  document.body.appendChild(element)
  return { ref: { current: element }, element }
}

function makeEntry(
  overrides: Partial<Omit<OverlayEntry, 'id'>> & { containerRef: OverlayEntry['containerRef'] },
): Omit<OverlayEntry, 'id'> {
  return {
    onEscape: null,
    returnFocus: null,
    initialFocusRef: null,
    lockScroll: false,
    ...overrides,
  }
}

afterEach(() => {
  __resetOverlayManager()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('overlayManager', () => {
  describe('stack management', () => {
    it('registers an overlay and returns a unique id', () => {
      const { ref } = makeContainer()
      const id = registerOverlay(makeEntry({ containerRef: ref }))
      expect(typeof id).toBe('number')
      expect(getOverlayStackSize()).toBe(1)
    })

    it('unregisters an overlay by id', () => {
      const { ref } = makeContainer()
      const id = registerOverlay(makeEntry({ containerRef: ref }))
      unregisterOverlay(id)
      expect(getOverlayStackSize()).toBe(0)
    })

    it('unregister is idempotent (safe to call twice)', () => {
      const { ref } = makeContainer()
      const id = registerOverlay(makeEntry({ containerRef: ref }))
      unregisterOverlay(id)
      unregisterOverlay(id) // should not throw
      expect(getOverlayStackSize()).toBe(0)
    })

    it('unregister with unknown id does nothing', () => {
      const { ref } = makeContainer()
      registerOverlay(makeEntry({ containerRef: ref }))
      unregisterOverlay(999)
      expect(getOverlayStackSize()).toBe(1)
    })

    it('returns the topmost overlay via getTopOverlay', () => {
      const { ref: ref1 } = makeContainer()
      const { ref: ref2 } = makeContainer()
      const id1 = registerOverlay(makeEntry({ containerRef: ref1 }))
      const id2 = registerOverlay(makeEntry({ containerRef: ref2 }))
      expect(getTopOverlay()?.id).toBe(id2)
      unregisterOverlay(id2)
      expect(getTopOverlay()?.id).toBe(id1)
    })

    it('getTopOverlay returns undefined when stack is empty', () => {
      expect(getTopOverlay()).toBeUndefined()
    })
  })

  describe('Escape handling', () => {
    it('calls onEscape only on the topmost overlay', () => {
      const { ref: ref1 } = makeContainer()
      const { ref: ref2 } = makeContainer()
      const calls: string[] = []
      registerOverlay(makeEntry({ containerRef: ref1, onEscape: () => calls.push('first') }))
      registerOverlay(makeEntry({ containerRef: ref2, onEscape: () => calls.push('second') }))

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(event)
      expect(calls).toEqual(['second'])
    })

    it('does nothing when no overlay has an onEscape callback', () => {
      const { ref } = makeContainer()
      registerOverlay(makeEntry({ containerRef: ref, onEscape: null }))

      // Should not throw
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
    })

    it('does nothing when stack is empty', () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
    })

    it('prevents default when Escape is handled', () => {
      const { ref } = makeContainer()
      let closed = false
      registerOverlay(makeEntry({ containerRef: ref, onEscape: () => (closed = true) }))

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
      document.dispatchEvent(event)
      expect(closed).toBe(true)
      expect(event.defaultPrevented).toBe(true)
    })
  })

  describe('Tab trapping', () => {
    it('traps Tab within the topmost overlay container', () => {
      const { ref: ref1 } = makeContainer()
      const { ref: ref2 } = makeContainer()
      registerOverlay(makeEntry({ containerRef: ref1 }))
      registerOverlay(makeEntry({ containerRef: ref2 }))

      // Focus the last button in ref2's container.
      const buttons = ref2.current!.querySelectorAll('button')
      const btn2 = buttons[buttons.length - 1] as HTMLElement
      btn2.focus()

      // Press Tab without Shift – should wrap to first button.
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      expect(document.activeElement).toBe(buttons[0])
      expect(event.defaultPrevented).toBe(true)
    })

    it('traps Shift+Tab within the topmost overlay container', () => {
      const { ref } = makeContainer()
      registerOverlay(makeEntry({ containerRef: ref }))

      const buttons = ref.current!.querySelectorAll('button')
      const btn1 = buttons[0] as HTMLElement
      btn1.focus()

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      expect(document.activeElement).toBe(buttons[buttons.length - 1])
      expect(event.defaultPrevented).toBe(true)
    })

    it('does not trap Tab when stack is empty', () => {
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      btn.focus()

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      // Should not have been prevented – browser handles it
      expect(event.defaultPrevented).toBe(false)
    })

    it('focuses the container itself when there are no focusable children', () => {
      const element = document.createElement('div')
      element.tabIndex = -1
      document.body.appendChild(element)
      const ref = { current: element }
      registerOverlay(makeEntry({ containerRef: ref }))

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(element)
    })
  })

  describe('scroll lock (ref-counted)', () => {
    it('locks body scroll when the first lockScroll overlay registers', () => {
      const { ref } = makeContainer()
      document.body.style.overflow = 'auto'
      registerOverlay(makeEntry({ containerRef: ref, lockScroll: true }))
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('restores body scroll when the last lockScroll overlay unregisters', () => {
      const { ref } = makeContainer()
      document.body.style.overflow = 'auto'
      const id = registerOverlay(makeEntry({ containerRef: ref, lockScroll: true }))
      unregisterOverlay(id)
      expect(document.body.style.overflow).toBe('auto')
    })

    it('keeps scroll locked when nested lockScroll overlays close inner first', () => {
      const { ref: ref1 } = makeContainer()
      const { ref: ref2 } = makeContainer()
      document.body.style.overflow = 'auto'

      const id1 = registerOverlay(makeEntry({ containerRef: ref1, lockScroll: true }))
      const id2 = registerOverlay(makeEntry({ containerRef: ref2, lockScroll: true }))

      // Close the inner (topmost) overlay first.
      unregisterOverlay(id2)
      // Scroll should still be locked because the outer overlay is still open.
      expect(document.body.style.overflow).toBe('hidden')

      // Close the outer overlay.
      unregisterOverlay(id1)
      expect(document.body.style.overflow).toBe('auto')
    })

    it('does not lock scroll when lockScroll is false', () => {
      const { ref } = makeContainer()
      document.body.style.overflow = 'auto'
      registerOverlay(makeEntry({ containerRef: ref, lockScroll: false }))
      expect(document.body.style.overflow).toBe('auto')
    })

    it('does not restore scroll prematurely when a non-lockScroll overlay unregisters', () => {
      const { ref: ref1 } = makeContainer()
      const { ref: ref2 } = makeContainer()
      document.body.style.overflow = 'auto'

      registerOverlay(makeEntry({ containerRef: ref1, lockScroll: true }))
      const id2 = registerOverlay(makeEntry({ containerRef: ref2, lockScroll: false }))

      // Unregister the non-lockScroll overlay.
      unregisterOverlay(id2)
      // Scroll should still be locked.
      expect(document.body.style.overflow).toBe('hidden')
    })
  })

  describe('focus return', () => {
    it('returns focus to the saved element when unregistering', () => {
      const { ref } = makeContainer()
      const returnTo = document.createElement('button')
      document.body.appendChild(returnTo)
      returnTo.focus()

      const id = registerOverlay(makeEntry({ containerRef: ref, returnFocus: returnTo }))
      unregisterOverlay(id)
      expect(document.activeElement).toBe(returnTo)
    })

    it('does not try to focus a disconnected element', () => {
      const { ref } = makeContainer()
      const returnTo = document.createElement('button')
      returnTo.focus()

      const id = registerOverlay(makeEntry({ containerRef: ref, returnFocus: returnTo }))
      // Remove the element from the DOM before unregistering.
      returnTo.remove()

      // Should not throw.
      expect(() => unregisterOverlay(id)).not.toThrow()
    })
  })

  describe('auto-focus', () => {
    it('focuses the first focusable element on registration', async () => {
      const { ref } = makeContainer()
      registerOverlay(makeEntry({ containerRef: ref }))

      // Wait for the rAF to fire.
      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(document.activeElement).toBe(ref.current!.querySelectorAll('button')[0])
    })

    it('focuses initialFocusRef when provided', async () => {
      const { ref } = makeContainer()
      const buttons = ref.current!.querySelectorAll('button')
      const initialRef = { current: buttons[1] as HTMLElement }

      registerOverlay(makeEntry({ containerRef: ref, initialFocusRef: initialRef }))

      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(document.activeElement).toBe(buttons[1])
    })

    it('does not steal focus when the container already contains activeElement', async () => {
      const { ref } = makeContainer()
      const buttons = ref.current!.querySelectorAll('button')
      const btn2 = buttons[1] as HTMLElement
      btn2.focus()

      registerOverlay(makeEntry({ containerRef: ref }))

      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(document.activeElement).toBe(btn2)
    })
  })

  describe('__resetOverlayManager', () => {
    it('clears all state', () => {
      const { ref } = makeContainer()
      document.body.style.overflow = 'auto'
      registerOverlay(makeEntry({ containerRef: ref, lockScroll: true }))

      __resetOverlayManager()

      expect(getOverlayStackSize()).toBe(0)
      expect(document.body.style.overflow).toBe('auto')
    })
  })
})
