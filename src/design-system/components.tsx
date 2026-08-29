import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
export type ControlSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ControlSize
  loading?: boolean
  leadingIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    leadingIcon,
    loading = false,
    size = 'md',
    type = 'button',
    variant = 'primary',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ds-button', `ds-button--${variant}`, size !== 'md' && `ds-button--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : leadingIcon}
      <span>{children}</span>
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  'aria-label': string
  icon: ReactNode
  size?: ControlSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, icon, size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ds-icon-button', size !== 'md' && `ds-icon-button--${size}`, className)}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
})

interface FieldChromeProps {
  id: string
  label: ReactNode
  required?: boolean
  helperText?: ReactNode
  error?: ReactNode
  children: (describedBy: string | undefined) => ReactNode
  className?: string
}

function FieldChrome({ id, label, required, helperText, error, children, className }: FieldChromeProps) {
  const message = error ?? helperText
  const messageId = message ? `${id}-message` : undefined

  return (
    <div className={cx('ds-field', className)}>
      <label className="ds-field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="ds-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(messageId)}
      {message && (
        <p
          id={messageId}
          className={cx('ds-field__message', Boolean(error) && 'ds-field__message--error')}
          role={error ? 'alert' : undefined}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode
  helperText?: ReactNode
  error?: ReactNode
  containerClassName?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, containerClassName, error, helperText, id: providedId, label, required, ...props },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId

  return (
    <FieldChrome
      id={id}
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      className={containerClassName}
    >
      {(describedBy) => (
        <input
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx('ds-input', className)}
          {...props}
        />
      )}
    </FieldChrome>
  )
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode
  helperText?: ReactNode
  error?: ReactNode
  containerClassName?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, containerClassName, error, helperText, id: providedId, label, required, ...props },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId

  return (
    <FieldChrome
      id={id}
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      className={containerClassName}
    >
      {(describedBy) => (
        <textarea
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx('ds-textarea', className)}
          {...props}
        />
      )}
    </FieldChrome>
  )
})

export type SurfaceTone = 'default' | 'subtle' | 'raised'

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone
}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { className, tone = 'default', ...props },
  ref,
) {
  return (
    <div ref={ref} className={cx('ds-surface', tone !== 'default' && `ds-surface--${tone}`, className)} {...props} />
  )
})

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = 'neutral', ...props },
  ref,
) {
  return <span ref={ref} className={cx('ds-badge', `ds-badge--${tone}`, className)} {...props} />
})

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ action, className, description, icon, title, ...props }: EmptyStateProps) {
  return (
    <div className={cx('ds-empty-state', className)} {...props}>
      {icon && (
        <div className="ds-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <div>
        <h3 className="ds-empty-state__title">{title}</h3>
        {description && <p className="ds-empty-state__description">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string
}

export function Skeleton({ className, label = '正在加载', ...props }: SkeletonProps) {
  return (
    <span className={cx('ds-skeleton', className)} role="status" {...props}>
      <span className="ds-sr-only">{label}</span>
    </span>
  )
}
