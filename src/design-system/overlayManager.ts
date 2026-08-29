import type { RefObject } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverlayEntry {
  /** Unique id assigned at registration time. */
  id: number
  /** Called when Escape is pressed and this overlay is topmost. */
  onEscape: (() => void) | null
  /** Element that held focus before this overlay was opened. */
  returnFocus: HTMLElement | null
  /** Container whose focusable descendants are trapped for Tab. */
  containerRef: RefObject<HTMLElement | null> | null
  /** Optional element to focus first instead of the first focusable descendant. */
  initialFocusRef: RefObject<HTMLElement | null> | null
  /** Whether registration should lock body scroll (ref-counted). */
  lockScroll: boolean
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const overlayStack: OverlayEntry[] = []
let nextId = 0

// Body scroll lock (ref-counted)
let lockCount = 0
let savedBodyOverflow = ''

// Global keydown listener
let listenerAttached = false

// ---------------------------------------------------------------------------
// Focusable selector – mirrors the one from useDialogFocusTrap
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = [
  '[data-autofocus]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  )
}

function lockBodyScroll() {
  if (lockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = savedBodyOverflow
  }
}

function ensureGlobalListener() {
  if (listenerAttached) return
  listenerAttached = true
  document.addEventListener('keydown', globalKeyDown)
}

function globalKeyDown(event: KeyboardEvent) {
  if (overlayStack.length === 0) return

  const top = overlayStack[overlayStack.length - 1]

  // Escape – only the topmost overlay responds
  if (event.key === 'Escape') {
    if (top.onEscape) {
      event.preventDefault()
      top.onEscape()
    }
    return
  }

  // Tab – only the topmost overlay traps focus
  if (event.key === 'Tab') {
    const container = top.containerRef?.current ?? null
    if (!container) return

    const focusable = getFocusableElements(container)
    if (focusable.length === 0) {
      event.preventDefault()
      container.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (!container.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an overlay on the shared stack.
 *
 * - Pushes the entry onto the global stack.
 * - Locks body scroll (ref-counted) when `entry.lockScroll` is true.
 * - Attaches the global keydown listener on first registration.
 * - Auto-focuses the first focusable element (or `entry.initialFocusRef`)
 *   inside `entry.containerRef` on the next animation frame.
 *
 * @returns The numeric id to pass to `unregisterOverlay`.
 */
export function registerOverlay(entry: Omit<OverlayEntry, 'id'>): number {
  const id = nextId++
  const fullEntry: OverlayEntry = { ...entry, id }
  overlayStack.push(fullEntry)

  ensureGlobalListener()

  if (entry.lockScroll) {
    lockBodyScroll()
  }

  // Auto-focus the first focusable element (or initialFocusRef) on next rAF.
  const container = entry.containerRef?.current ?? null
  if (container) {
    const initialFocusTarget = entry.initialFocusRef?.current ?? null
    requestAnimationFrame(() => {
      // If the container already contains the active element, leave it alone.
      const currentFocus = document.activeElement
      if (currentFocus instanceof HTMLElement && container.contains(currentFocus)) return

      const target =
        initialFocusTarget && container.contains(initialFocusTarget)
          ? initialFocusTarget
          : container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)

      target?.focus()
    })
  }

  return id
}

/**
 * Remove an overlay from the shared stack.
 *
 * - Splices the entry out of the global stack.
 * - Unlocks body scroll (ref-counted) when the removed entry had `lockScroll`.
 * - Returns focus to the entry's `returnFocus` element (when still connected).
 * - Does nothing when the id is not found (safe to call multiple times).
 */
export function unregisterOverlay(id: number): void {
  const index = overlayStack.findIndex((entry) => entry.id === id)
  if (index < 0) return

  const [entry] = overlayStack.splice(index, 1)

  if (entry.lockScroll) {
    unlockBodyScroll()
  }

  // Return focus to the element that was focused before this overlay opened.
  if (entry.returnFocus?.isConnected) {
    entry.returnFocus.focus()
  }
}

/**
 * Return the topmost overlay entry (or undefined when the stack is empty).
 */
export function getTopOverlay(): OverlayEntry | undefined {
  return overlayStack[overlayStack.length - 1]
}

/**
 * Return the current stack depth (useful for assertions).
 */
export function getOverlayStackSize(): number {
  return overlayStack.length
}

/**
 * Reset all internal module state.  Intended **only** for test teardown;
 * never call this in production code.
 */
export function __resetOverlayManager(): void {
  // Restore body scroll if it was locked, then reset counters.
  if (lockCount > 0) {
    document.body.style.overflow = savedBodyOverflow
  }
  overlayStack.length = 0
  nextId = 0
  lockCount = 0
  savedBodyOverflow = ''
  if (listenerAttached) {
    document.removeEventListener('keydown', globalKeyDown)
    listenerAttached = false
  }
}
