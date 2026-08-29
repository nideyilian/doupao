import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { Button, cx, EmptyState } from './components'
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon, TriangleAlertIcon } from './icons'

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger'

const feedbackIcons = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: TriangleAlertIcon,
  danger: AlertCircleIcon,
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: FeedbackTone
  title?: ReactNode
  actions?: ReactNode
}

export function Alert({ actions, children, className, role, title, tone = 'info', ...props }: AlertProps) {
  const Icon = feedbackIcons[tone]
  return (
    <div
      className={cx('ds-alert', `ds-alert--${tone}`, className)}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      {...props}
    >
      <Icon className="ds-alert__icon" size={18} aria-hidden="true" />
      <div className="ds-alert__copy">
        {title && <div className="ds-alert__title">{title}</div>}
        <div className="ds-alert__content">{children}</div>
      </div>
      {actions && <div className="ds-alert__actions">{actions}</div>}
    </div>
  )
}

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Spinner({ className, label = '正在加载', size = 'md', ...props }: SpinnerProps) {
  return (
    <span className={cx('ds-spinner', `ds-spinner--${size}`, className)} role="status" aria-label={label} {...props} />
  )
}

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
  label: string
  showValue?: boolean
  tone?: 'primary' | FeedbackTone
}

export function Progress({
  className,
  label,
  max = 100,
  showValue = false,
  tone = 'primary',
  value,
  ...props
}: ProgressProps) {
  const bounded = value === undefined ? undefined : Math.min(max, Math.max(0, value))
  const percentage = bounded === undefined ? undefined : Math.round((bounded / max) * 100)

  return (
    <div className={cx('ds-progress', className)} {...props}>
      <div className="ds-progress__label-row">
        <span>{label}</span>
        {showValue && percentage !== undefined && <span>{percentage}%</span>}
      </div>
      <div
        className="ds-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={bounded}
        aria-busy={bounded === undefined || undefined}
      >
        <span
          className={cx(
            'ds-progress__bar',
            `ds-progress__bar--${tone}`,
            bounded === undefined && 'ds-progress__bar--indeterminate',
          )}
          style={bounded === undefined ? undefined : { transform: `scaleX(${percentage! / 100})` }}
        />
      </div>
    </div>
  )
}

export interface StatusIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | FeedbackTone
  pulse?: boolean
}

export function StatusIndicator({ children, className, pulse, tone = 'neutral', ...props }: StatusIndicatorProps) {
  return (
    <span className={cx('ds-status', `ds-status--${tone}`, className)} {...props}>
      <span className={cx('ds-status__dot', pulse && 'ds-status__dot--pulse')} aria-hidden="true" />
      {children}
    </span>
  )
}

export interface ToastMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: FeedbackTone
  title?: ReactNode
  /** 可选的操作按钮（例如「查看」跳转）。渲染在文案与关闭按钮之间。 */
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
}

export const ToastMessage = forwardRef<HTMLDivElement, ToastMessageProps>(function ToastMessage(
  { action, children, className, dismissLabel = '关闭通知', onDismiss, role, title, tone = 'info', ...props },
  ref,
) {
  const Icon = feedbackIcons[tone]
  return (
    <div
      ref={ref}
      className={cx('ds-toast', `ds-toast--${tone}`, className)}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <div className="ds-toast__copy">
        {title && <div className="ds-toast__title">{title}</div>}
        <div>{children}</div>
      </div>
      {action && <div className="ds-toast__action">{action}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel}>
          <CloseIcon size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  description: ReactNode
  onRetry?: () => void
  retryLabel?: string
  details?: ReactNode
}

export function ErrorState({
  className,
  description,
  details,
  onRetry,
  retryLabel = '重试',
  title = '操作未完成',
  ...props
}: ErrorStateProps) {
  return (
    <EmptyState
      className={className}
      icon={<AlertCircleIcon size={22} />}
      title={title}
      description={
        <>
          {description}
          {details && <span className="ds-error-state__details">{details}</span>}
        </>
      }
      action={onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
      {...props}
    />
  )
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

export function Kbd({ className, ...props }: KbdProps) {
  return <kbd className={cx('ds-kbd', className)} {...props} />
}
