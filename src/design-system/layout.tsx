import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './components'

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12
  align?: CSSProperties['alignItems']
}

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { align, className, gap = 4, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-stack', className)}
      style={{ ...style, alignItems: align, gap: `var(--ds-space-${gap})` }}
      {...props}
    />
  )
})

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8
  align?: CSSProperties['alignItems']
  justify?: CSSProperties['justifyContent']
  wrap?: boolean
}

export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { align = 'center', className, gap = 2, justify, style, wrap = true, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-inline', className)}
      style={{
        ...style,
        alignItems: align,
        gap: `var(--ds-space-${gap})`,
        justifyContent: justify,
        flexWrap: wrap ? 'wrap' : 'nowrap',
      }}
      {...props}
    />
  )
})

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  minColumnWidth?: string
  gap?: 2 | 3 | 4 | 5 | 6 | 8
}

export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { className, gap = 4, minColumnWidth = '16rem', style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-grid', className)}
      style={{
        ...style,
        gap: `var(--ds-space-${gap})`,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}), 1fr))`,
      }}
      {...props}
    />
  )
})

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'full'
}

export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { className, size = 'lg', ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-container', `ds-container--${size}`, className)} {...props} />
})

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical'
}

export const Divider = forwardRef<HTMLHRElement, DividerProps>(function Divider(
  { className, orientation = 'horizontal', ...props },
  ref,
) {
  return (
    <hr
      ref={ref}
      aria-orientation={orientation}
      className={cx('ds-divider', `ds-divider--${orientation}`, className)}
      {...props}
    />
  )
})

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  maxHeight?: string
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { className, maxHeight, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-scroll-area', className)}
      style={{ ...style, maxHeight }}
      tabIndex={0}
      {...props}
    />
  )
})

export interface SplitPaneProps extends HTMLAttributes<HTMLDivElement> {
  sidebar: ReactNode
  sidebarPosition?: 'start' | 'end'
  sidebarWidth?: string
}

export function SplitPane({
  children,
  className,
  sidebar,
  sidebarPosition = 'start',
  sidebarWidth = '20rem',
  style,
  ...props
}: SplitPaneProps) {
  return (
    <div
      className={cx('ds-split-pane', `ds-split-pane--${sidebarPosition}`, className)}
      style={{ ...style, '--ds-split-sidebar': sidebarWidth } as CSSProperties}
      {...props}
    >
      <aside className="ds-split-pane__sidebar">{sidebar}</aside>
      <div className="ds-split-pane__content">{children}</div>
    </div>
  )
}
