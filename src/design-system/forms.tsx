import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type FieldsetHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { cx } from './components'
import { CloseIcon, SearchIcon } from './icons'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  tone?: 'primary' | 'danger'
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    checked,
    className,
    description,
    disabled,
    id: providedId,
    indeterminate = false,
    label,
    onChange,
    tone = 'primary',
    ...props
  },
  forwardedRef,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const localRef = useRef<HTMLInputElement>(null)
  const descriptionId = description ? `${id}-description` : undefined

  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const setRefs = (node: HTMLInputElement | null) => {
    localRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  return (
    <label className={cx('ds-check', disabled && 'ds-check--disabled', className)} htmlFor={id}>
      <span className="ds-check__control">
        <input
          ref={setRefs}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={descriptionId}
          data-tone={tone}
          onChange={(event) => onChange(event.target.checked)}
          {...props}
        />
        <span className="ds-check__mark" aria-hidden="true">
          {indeterminate ? '−' : '✓'}
        </span>
      </span>
      {(label || description) && (
        <span className="ds-check__copy">
          {label && <span className="ds-check__label">{label}</span>}
          {description && (
            <span id={descriptionId} className="ds-check__description">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
})

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'role'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  labelPosition?: 'start' | 'end'
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  {
    checked,
    className,
    description,
    disabled,
    id: providedId,
    label,
    labelPosition = 'start',
    onCheckedChange,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const descriptionId = description ? `${id}-description` : undefined
  const copy = (
    <span className="ds-switch__copy">
      <span className="ds-switch__label">{label}</span>
      {description && (
        <span id={descriptionId} className="ds-switch__description">
          {description}
        </span>
      )}
    </span>
  )

  return (
    <label
      className={cx(
        'ds-switch',
        labelPosition === 'end' && 'ds-switch--reverse',
        disabled && 'ds-switch--disabled',
        className,
      )}
      htmlFor={id}
    >
      {labelPosition === 'start' && copy}
      <span className="ds-switch__control">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => onCheckedChange(event.target.checked)}
          {...props}
        />
        <span className="ds-switch__track" aria-hidden="true">
          <span className="ds-switch__thumb" />
        </span>
      </span>
      {labelPosition === 'end' && copy}
    </label>
  )
})

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps<T extends string> {
  label: ReactNode
  value: T
  options: Array<RadioOption<T>>
  onValueChange: (value: T) => void
  name?: string
  orientation?: 'horizontal' | 'vertical'
  className?: string
  disabled?: boolean
}

export function RadioGroup<T extends string>({
  className,
  disabled,
  label,
  name,
  onValueChange,
  options,
  orientation = 'vertical',
  value,
}: RadioGroupProps<T>) {
  const generatedName = useId()
  const groupName = name ?? generatedName

  return (
    <fieldset className={cx('ds-radio-group', className)} disabled={disabled}>
      <legend className="ds-radio-group__legend">{label}</legend>
      <div className={cx('ds-radio-group__options', `ds-radio-group__options--${orientation}`)}>
        {options.map((option) => (
          <label key={option.value} className={cx('ds-radio', option.disabled && 'ds-radio--disabled')}>
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
            />
            <span className="ds-radio__circle" aria-hidden="true" />
            <span className="ds-radio__copy">
              <span className="ds-radio__label">{option.label}</span>
              {option.description && <span className="ds-radio__description">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  'aria-label': string
  value: T
  options: Array<SegmentedOption<T> | T>
  onValueChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<T extends string>({
  'aria-label': ariaLabel,
  className,
  onValueChange,
  options,
  size = 'md',
  value,
}: SegmentedControlProps<T>) {
  const normalizedOptions = options.map((item) => (typeof item === 'string' ? { value: item, label: item } : item))

  const moveFocus = (currentIndex: number, direction: 1 | -1, container: HTMLElement) => {
    const enabled = normalizedOptions
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled)
    if (!enabled.length) return

    const enabledIndex = enabled.findIndex(({ index }) => index === currentIndex)
    const next = enabled[(enabledIndex + direction + enabled.length) % enabled.length]
    container.querySelector<HTMLButtonElement>(`[data-segment-index="${next.index}"]`)?.focus()
    onValueChange(next.option.value)
  }

  return (
    <div
      className={cx('ds-segmented', size === 'sm' && 'ds-segmented--sm', className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {normalizedOptions.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            data-segment-index={index}
            className="ds-segmented__item"
            data-selected={selected || undefined}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              moveFocus(index, event.key === 'ArrowRight' ? 1 : -1, event.currentTarget.parentElement!)
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> {
  label: ReactNode
  options: SelectOption[]
  helperText?: ReactNode
  error?: ReactNode
  containerClassName?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { className, containerClassName, error, helperText, id: providedId, label, options, required, ...props },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const message = error ?? helperText
  const messageId = message ? `${id}-message` : undefined

  return (
    <div className={cx('ds-field', containerClassName)}>
      <label className="ds-field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="ds-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <span className="ds-select">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className={cx('ds-select__control', className)}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="ds-select__chevron" aria-hidden="true">
          ▾
        </span>
      </span>
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
})

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  label: string
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  /** 控件高度档位，与 --ds-control-* 尺度 Token 一致：sm 32px（紧凑工具栏）/ md 36px / lg 40px（默认）。 */
  size?: 'sm' | 'md' | 'lg'
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, id: providedId, label, onChange, onClear, size = 'lg', value, ...props },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const sizeClass = size === 'lg' ? undefined : `ds-search--${size}`

  return (
    <div className={cx('ds-search', sizeClass, className)}>
      <label className="ds-sr-only" htmlFor={id}>
        {label}
      </label>
      <SearchIcon className="ds-search__icon" size={16} aria-hidden="true" />
      <input
        ref={ref}
        id={id}
        type="search"
        value={value}
        className="ds-search__input"
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {value && onClear && (
        <button type="button" className="ds-search__clear" aria-label={`清除${label}`} onClick={onClear}>
          <CloseIcon size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

export interface FieldsetProps extends FieldsetHTMLAttributes<HTMLFieldSetElement> {
  legend: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function Fieldset({ actions, children, className, description, legend, ...props }: FieldsetProps) {
  return (
    <fieldset className={cx('ds-fieldset', className)} {...props}>
      <div className="ds-fieldset__header">
        <div>
          <legend className="ds-fieldset__legend">{legend}</legend>
          {description && <p className="ds-fieldset__description">{description}</p>}
        </div>
        {actions && <div className="ds-fieldset__actions">{actions}</div>}
      </div>
      <div className="ds-fieldset__content">{children}</div>
    </fieldset>
  )
}

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  disabled?: boolean
  className?: string
}

export function Stepper({
  className,
  disabled,
  label,
  max = Number.POSITIVE_INFINITY,
  min = Number.NEGATIVE_INFINITY,
  onChange,
  step = 1,
  value,
}: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next))

  return (
    <div className={cx('ds-stepper', className)} role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`减少${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`增加${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  )
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  /** 滑动条左侧的说明文字 */
  label?: ReactNode
  /** 右侧当前值展示 */
  valueDisplay?: ReactNode
  onChange?: (value: number) => void
}

/** 数值滑动条：原生 range 的统一样式封装（标签 + 滑轨 + 当前值）。 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, disabled, label, max, min, onChange, step, value, valueDisplay, ...props },
  ref,
) {
  return (
    <div className={cx('ds-slider', className)}>
      {label && <span className="ds-slider__label">{label}</span>}
      <input
        ref={ref}
        type="range"
        className="ds-slider__input"
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        value={value}
        aria-label={typeof label === 'string' ? label : undefined}
        onChange={(event) => onChange?.(Number(event.target.value))}
        {...props}
      />
      {valueDisplay != null && <output className="ds-slider__value">{valueDisplay}</output>}
    </div>
  )
})
