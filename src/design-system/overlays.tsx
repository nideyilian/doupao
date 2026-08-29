import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { IconButton, cx } from './components'
import { CloseIcon } from './icons'
import { registerOverlay, unregisterOverlay } from './overlayManager'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeLabel?: string
  closeOnBackdrop?: boolean
  className?: string
}

export function Dialog({
  children,
  className,
  closeLabel = '关闭对话框',
  closeOnBackdrop = true,
  description,
  footer,
  onOpenChange,
  open,
  size = 'md',
  title,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const overlayIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      // Cleanup when dialog closes while effect is still mounted (e.g. StrictMode).
      if (overlayIdRef.current !== null) {
        unregisterOverlay(overlayIdRef.current)
        overlayIdRef.current = null
      }
      return
    }

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = registerOverlay({
      onEscape: () => onOpenChange(false),
      returnFocus,
      containerRef: dialogRef,
      initialFocusRef: null,
      lockScroll: true,
    })
    overlayIdRef.current = id

    return () => {
      if (overlayIdRef.current !== null) {
        unregisterOverlay(overlayIdRef.current)
        overlayIdRef.current = null
      }
    }
  }, [open, onOpenChange])

  if (!open) return null

  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange(false)
  }

  return createPortal(
    <div className="ds-dialog-layer" onMouseDown={onBackdropClick}>
      <div className="ds-dialog__scrim" aria-hidden="true" />
      <div
        ref={dialogRef}
        className={cx('ds-dialog', `ds-dialog--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="ds-dialog__header">
          <div>
            <h2 id={titleId} className="ds-dialog__title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="ds-dialog__description">
                {description}
              </p>
            )}
          </div>
          <IconButton aria-label={closeLabel} icon={<CloseIcon size={17} />} onClick={() => onOpenChange(false)} />
        </header>
        <div className="ds-dialog__content">{children}</div>
        {footer && <footer className="ds-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export interface DrawerProps extends Omit<DialogProps, 'size'> {
  side?: 'left' | 'right' | 'bottom'
  width?: 'sm' | 'md' | 'lg'
}

export function Drawer({
  children,
  className,
  closeLabel = '关闭面板',
  description,
  footer,
  onOpenChange,
  open,
  side = 'right',
  title,
  width = 'md',
}: DrawerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={footer}
      closeLabel={closeLabel}
      className={cx('ds-drawer', `ds-drawer--${side}`, `ds-drawer--${width}`, className)}
    >
      {children}
    </Dialog>
  )
}

export interface DialogWorkspaceProps extends HTMLAttributes<HTMLDivElement> {
  layout?: 'single' | 'split' | 'triple'
}

export function DialogWorkspace({ className, layout = 'single', ...props }: DialogWorkspaceProps) {
  return <div className={cx('ds-dialog-workspace', `ds-dialog-workspace--${layout}`, className)} {...props} />
}

export interface DialogPaneProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'aside' | 'div'
  tone?: 'sidebar' | 'content' | 'canvas'
  scroll?: boolean
}

export function DialogPane({
  as: Component = 'section',
  className,
  scroll = true,
  tone = 'content',
  ...props
}: DialogPaneProps) {
  return (
    <Component
      className={cx('ds-dialog-pane', `ds-dialog-pane--${tone}`, scroll && 'ds-dialog-pane--scroll', className)}
      {...props}
    />
  )
}

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'content'> {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function Tooltip({ children, className, content, side = 'top', ...props }: TooltipProps) {
  const id = useId()
  return (
    <span className={cx('ds-tooltip', className)} aria-describedby={id} {...props}>
      {children}
      <span id={id} role="tooltip" className={cx('ds-tooltip__content', `ds-tooltip__content--${side}`)}>
        {content}
      </span>
    </span>
  )
}

export interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  arrow?: boolean
}

export function Popover({ arrow = true, children, className, label, ...props }: PopoverProps) {
  return (
    <div className={cx('ds-popover', className)} role="dialog" aria-label={label} {...props}>
      {arrow && <span className="ds-popover__arrow" aria-hidden="true" />}
      {children}
    </div>
  )
}

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

export function Menu({ className, label, onKeyDown, ...props }: MenuProps) {
  return (
    <div
      className={cx('ds-menu', className)}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
        )
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        let next = index
        if (event.key === 'ArrowDown') next = (index + 1) % items.length
        else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        items[next]?.focus()
      }}
      {...props}
    />
  )
}

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon?: ReactNode
  shortcut?: ReactNode
  tone?: 'default' | 'danger'
}

export function MenuItem({ children, className, icon, shortcut, tone = 'default', ...props }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx('ds-menu__item', tone === 'danger' && 'ds-menu__item--danger', className)}
      {...props}
    >
      {icon && (
        <span className="ds-menu__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ds-menu__label">{children}</span>
      {shortcut && <span className="ds-menu__shortcut">{shortcut}</span>}
    </button>
  )
}

export function MenuSeparator({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx('ds-menu__separator', className)} role="separator" {...props} />
}
