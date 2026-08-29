import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onDismissTooltips } from '../lib/tooltipDismiss'

interface ViewportTooltipProps {
  visible: boolean
  children: ReactNode
  className?: string
}

/** 统一工具提示视觉：复用设计系统 ds-tooltip 的深色气泡 token（.ds-tooltip--viewport）。 */
export function getViewportTooltipClasses(className = '') {
  return `ds-tooltip--viewport ${className}`.trim()
}

export default function ViewportTooltip({ visible, children, className = '' }: ViewportTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Global dismiss: when any modal opens, suppress the tooltip even if
  // the parent still passes visible=true.  Reset when visible goes back
  // to false (so the next hover cycle works normally).
  const [suppressed, setSuppressed] = useState(false)

  useEffect(() => {
    if (!visible) {
      setSuppressed(false)
      return
    }
    return onDismissTooltips(() => setSuppressed(true))
  }, [visible])

  const effectiveVisible = visible && !suppressed

  useEffect(() => {
    if (!effectiveVisible) return

    const hideIfOutside = (event: PointerEvent | TouchEvent) => {
      const target = event.target
      const anchorParent = anchorRef.current?.parentElement
      if (!(target instanceof Node)) return
      if (anchorParent?.contains(target) || tooltipRef.current?.contains(target)) return
      setSuppressed(true)
    }

    document.addEventListener('pointerdown', hideIfOutside, true)
    document.addEventListener('touchstart', hideIfOutside, true)
    return () => {
      document.removeEventListener('pointerdown', hideIfOutside, true)
      document.removeEventListener('touchstart', hideIfOutside, true)
    }
  }, [effectiveVisible])

  useEffect(() => {
    if (!effectiveVisible) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current?.parentElement
      const el = tooltipRef.current
      if (!anchor || !el) return

      const margin = 8
      const gap = 8
      const anchorRect = anchor.getBoundingClientRect()
      if (!anchor.getClientRects().length || (anchorRect.width === 0 && anchorRect.height === 0)) {
        setPosition(null)
        return
      }

      const tooltipRect = el.getBoundingClientRect()
      const anchorCenter = anchorRect.left + anchorRect.width / 2
      const maxLeft = Math.max(margin, window.innerWidth - tooltipRect.width - margin)
      const left = Math.min(Math.max(anchorCenter - tooltipRect.width / 2, margin), maxLeft)
      const aboveTop = anchorRect.top - tooltipRect.height - gap
      const placement = aboveTop >= margin ? 'top' : 'bottom'
      const top = placement === 'top' ? aboveTop : anchorRect.bottom + gap

      setPosition({ left, top })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [effectiveVisible, children])

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden />
      {effectiveVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            className={getViewportTooltipClasses(className)}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
