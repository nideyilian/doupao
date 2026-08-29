import {
  forwardRef,
  type ButtonHTMLAttributes,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'
import { cx } from './components'
import { ChevronDownIcon } from './icons'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-card', className)} {...props} />
})

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ds-card__header', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx('ds-card__title', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('ds-card__description', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ds-card__content', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ds-card__footer', className)} {...props} />
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}

export function Panel({ actions, children, className, description, footer, title, ...props }: PanelProps) {
  return (
    <section className={cx('ds-panel', className)} {...props}>
      <header className="ds-panel__header">
        <div className="ds-panel__heading">
          <h2 className="ds-panel__title">{title}</h2>
          {description && <p className="ds-panel__description">{description}</p>}
        </div>
        {actions && <div className="ds-panel__actions">{actions}</div>}
      </header>
      <div className="ds-panel__content">{children}</div>
      {footer && <footer className="ds-panel__footer">{footer}</footer>}
    </section>
  )
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  selected?: boolean
  variant?: 'default' | 'divided'
  interactive?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'>
}

export function ListRow({
  actions,
  className,
  description,
  interactive,
  leading,
  meta,
  selected,
  title,
  variant = 'default',
  ...props
}: ListRowProps) {
  const content = (
    <>
      {leading && <div className="ds-list-row__leading">{leading}</div>}
      <div className="ds-list-row__copy">
        <div className="ds-list-row__title">{title}</div>
        {description && <div className="ds-list-row__description">{description}</div>}
      </div>
      {meta && <div className="ds-list-row__meta">{meta}</div>}
    </>
  )
  const { className: interactiveClassName, ...interactiveProps } = interactive ?? {}

  return (
    <div
      className={cx(
        'ds-list-row',
        selected && 'ds-list-row--selected',
        variant === 'divided' && 'ds-list-row--divided',
        className,
      )}
      {...props}
    >
      {interactive ? (
        <button type="button" className={cx('ds-list-row__interactive', interactiveClassName)} {...interactiveProps}>
          {content}
        </button>
      ) : (
        content
      )}
      {actions && <div className="ds-list-row__actions">{actions}</div>}
    </div>
  )
}

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  value: ReactNode
  trend?: ReactNode
}

export function Stat({ className, label, trend, value, ...props }: StatProps) {
  return (
    <div className={cx('ds-stat', className)} {...props}>
      <span className="ds-stat__label">{label}</span>
      <strong className="ds-stat__value">{value}</strong>
      {trend && <span className="ds-stat__trend">{trend}</span>}
    </div>
  )
}

export interface KeyValueProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  value: ReactNode
}

export function KeyValue({ className, label, value, ...props }: KeyValueProps) {
  return (
    <div className={cx('ds-key-value', className)} {...props}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export interface AspectRatioProps extends HTMLAttributes<HTMLDivElement> {
  ratio?: number
}

export function AspectRatio({ className, ratio = 1, style, ...props }: AspectRatioProps) {
  return (
    <div className={cx('ds-aspect-ratio', className)} style={{ ...style, aspectRatio: String(ratio) }} {...props} />
  )
}

export interface ThumbnailProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  ratio?: number
  selected?: boolean
}

export function Thumbnail({ alt, className, ratio = 1, selected, src, ...props }: ThumbnailProps) {
  return (
    <span
      className={cx('ds-thumbnail', selected && 'ds-thumbnail--selected', className)}
      style={{ aspectRatio: String(ratio) }}
    >
      <img src={src} alt={alt} loading="lazy" {...props} />
    </span>
  )
}

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode
}

export function Disclosure({ children, className, summary, ...props }: DisclosureProps) {
  return (
    <details className={cx('ds-disclosure', className)} {...props}>
      <summary>
        <span>{summary}</span>
        <ChevronDownIcon size={16} aria-hidden="true" />
      </summary>
      <div className="ds-disclosure__content">{children}</div>
    </details>
  )
}

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  language?: string
}

export function CodeBlock({ children, className, language, ...props }: CodeBlockProps) {
  return (
    <div className="ds-code-block">
      {language && <div className="ds-code-block__language">{language}</div>}
      <pre className={className} {...props}>
        <code>{children}</code>
      </pre>
    </div>
  )
}

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(function Table(
  { className, ...props },
  ref,
) {
  return (
    <div className="ds-table-container" tabIndex={0}>
      <table ref={ref} className={cx('ds-table', className)} {...props} />
    </div>
  )
})

export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cx('ds-table__row', className)} {...props} />
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cx('ds-table__head', className)} {...props} />
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('ds-table__cell', className)} {...props} />
}
