import { useEffect, useRef, type RefObject } from 'react'
import { registerOverlay, unregisterOverlay } from './overlayManager'

/**
 * Registers the container on the shared overlay stack so that only the topmost
 * overlay traps Tab and returns focus.  Escape handling and body scroll lock
 * are managed separately by the caller (e.g. `useCloseOnEscape` and
 * `usePreventBackgroundScroll`).
 *
 * The public API is unchanged from the pre-overlayManager version.
 */
export function useDialogFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const overlayIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      // Cleanup when the trap deactivates while the effect is still mounted
      // (e.g. React StrictMode double-invoke).
      if (overlayIdRef.current !== null) {
        unregisterOverlay(overlayIdRef.current)
        overlayIdRef.current = null
      }
      return
    }

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = registerOverlay({
      onEscape: null,
      returnFocus,
      containerRef,
      initialFocusRef: initialFocusRef ?? null,
      lockScroll: false,
    })
    overlayIdRef.current = id

    return () => {
      if (overlayIdRef.current !== null) {
        unregisterOverlay(overlayIdRef.current)
        overlayIdRef.current = null
      }
    }
  }, [active, containerRef, initialFocusRef])
}
