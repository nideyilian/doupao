import { type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './components'
import { ChevronRightIcon } from './icons'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps<T extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  'aria-label': string
  value: T
  items: Array<TabItem<T>>
  onValueChange: (value: T) => void
  size?: 'sm' | 'md'
  stretch?: boolean
}

export function Tabs<T extends string>({
  'aria-label': ariaLabel,
  className,
  items,
  onValueChange,
  size = 'md',
  stretch,
  value,
  ...props
}: TabsProps<T>) {
  const moveFocus = (currentIndex: number, direction: 1 | -1, container: HTMLElement) => {
    const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled)
    const enabledIndex = enabled.findIndex(({ index }) => index === currentIndex)
    const next = enabled[(enabledIndex + direction + enabled.length) % enabled.length]
    const button = container.querySelector<HTMLButtonElement>(`[data-tab-index="${next.index}"]`)
    button?.focus()
    onValueChange(next.item.value)
  }

  return (
    <div
      className={cx('ds-tabs', size === 'sm' && 'ds-tabs--sm', stretch && 'ds-tabs--stretch', className)}
      role="tablist"
      aria-label={ariaLabel}
      {...props}
    >
      {items.map((item, index) => {
        const selected = value === item.value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            data-tab-index={index}
            className="ds-tabs__item"
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              moveFocus(index, event.key === 'ArrowRight' ? 1 : -1, event.currentTarget.parentElement!)
            }}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

export function Toolbar({ className, label, ...props }: ToolbarProps) {
  return <div className={cx('ds-toolbar', className)} role="toolbar" aria-label={label} {...props} />
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  breadcrumbs?: ReactNode
}

export function PageHeader({
  actions,
  breadcrumbs,
  className,
  description,
  eyebrow,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header className={cx('ds-page-header', className)} {...props}>
      {breadcrumbs}
      <div className="ds-page-header__row">
        <div>
          {eyebrow && <div className="ds-page-header__eyebrow">{eyebrow}</div>}
          <h1 className="ds-page-header__title">{title}</h1>
          {description && <p className="ds-page-header__description">{description}</p>}
        </div>
        {actions && <div className="ds-page-header__actions">{actions}</div>}
      </div>
    </header>
  )
}

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function SectionHeader({ actions, className, description, title, ...props }: SectionHeaderProps) {
  return (
    <header className={cx('ds-section-header', className)} {...props}>
      <div>
        <h2 className="ds-section-header__title">{title}</h2>
        {description && <p className="ds-section-header__description">{description}</p>}
      </div>
      {actions && <div className="ds-section-header__actions">{actions}</div>}
    </header>
  )
}

export interface BreadcrumbItem {
  label: ReactNode
  href?: string
  onClick?: () => void
}

export interface BreadcrumbsProps extends HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
  label?: string
}

export function Breadcrumbs({ className, items, label = '面包屑导航', ...props }: BreadcrumbsProps) {
  return (
    <nav className={cx('ds-breadcrumbs', className)} aria-label={label} {...props}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li key={`${String(item.label)}-${index}`}>
              {index > 0 && <ChevronRightIcon size={13} aria-hidden="true" />}
              {item.href ? (
                <a href={item.href} aria-current={current ? 'page' : undefined}>
                  {item.label}
                </a>
              ) : item.onClick ? (
                <button type="button" onClick={item.onClick} aria-current={current ? 'page' : undefined}>
                  {item.label}
                </button>
              ) : (
                <span aria-current={current ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export interface NavItem<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export interface NavListProps<T extends string> extends HTMLAttributes<HTMLElement> {
  label: string
  value: T
  items: Array<NavItem<T>>
  onValueChange: (value: T) => void
}

export function NavList<T extends string>({
  className,
  items,
  label,
  onValueChange,
  value,
  ...props
}: NavListProps<T>) {
  return (
    <nav className={cx('ds-nav-list', className)} aria-label={label} {...props}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="ds-nav-list__item"
          aria-current={value === item.value ? 'page' : undefined}
          disabled={item.disabled}
          onClick={() => onValueChange(item.value)}
        >
          {item.icon && <span aria-hidden="true">{item.icon}</span>}
          <span>{item.label}</span>
          {item.badge && <span className="ds-nav-list__badge">{item.badge}</span>}
        </button>
      ))}
    </nav>
  )
}
