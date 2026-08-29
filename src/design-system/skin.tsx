import type { ColorScheme } from '../types'
import { SKIN_IDS, SKIN_REGISTRY } from '../theme/registry'
import { SegmentedControl } from './forms'

export type ColorSchemeValue = ColorScheme

export interface ColorSchemeOption {
  value: ColorSchemeValue
  label: string
  /** 主色预览色值，用于紧凑色板圆点 */
  swatch: string
  /** 渐变预览，用于预设卡片 */
  gradient: string
  description?: string
}

/** 皮肤（配色方案）选项，由 src/theme/registry.ts 注册表自动推导（单一来源）。 */
export const COLOR_SCHEME_OPTIONS: ColorSchemeOption[] = SKIN_IDS.map((id) => {
  const def = SKIN_REGISTRY[id]
  return {
    value: id,
    label: def.label,
    swatch: def.swatch,
    gradient: def.preview,
    description: def.description,
  }
})

export interface ColorSchemeSwitcherProps {
  value: ColorSchemeValue
  onChange: (value: ColorSchemeValue) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/**
 * 皮肤（配色方案）切换器：在注册表驱动的全部整体视觉预设之间切换。
 * 基于 SegmentedControl 实现，选项带主色色板预览，颜色不作为唯一信息信号。
 */
export function ColorSchemeSwitcher({
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel = '配色方案',
}: ColorSchemeSwitcherProps) {
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => onChange(next as ColorSchemeValue)}
      size={size}
      className={className}
      options={COLOR_SCHEME_OPTIONS.map((option) => ({
        value: option.value,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/20"
              style={{ background: option.swatch }}
            />
            {option.label}
          </span>
        ),
      }))}
    />
  )
}

export interface ColorPresetGridProps {
  value: ColorSchemeValue
  onChange: (value: ColorSchemeValue) => void
  className?: string
  /** 列数，移动端固定 2 列 */
  columns?: 2 | 3 | 4
  'aria-label'?: string
}

/**
 * 配色预设网格：参考「主题设置」中的卡片式预设选择器。
 * 每张卡片展示渐变预览、名称与简短描述，选中时显示勾标与主题色描边。
 */
export function ColorPresetGrid({
  value,
  onChange,
  className = '',
  columns = 3,
  'aria-label': ariaLabel = '配色预设',
}: ColorPresetGridProps) {
  const gridCols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid grid-cols-2 gap-3 ${gridCols[columns]} ${className}`}
    >
      {COLOR_SCHEME_OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`group relative flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
              selected
                ? 'border-[hsl(var(--ds-color-primary))] bg-[hsl(var(--ds-color-primary-subtle))] ring-1 ring-[hsl(var(--ds-color-primary))]'
                : 'border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface))] hover:border-[hsl(var(--ds-color-border-strong))]'
            }`}
          >
            <span
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10"
              style={{ background: option.gradient }}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[hsl(var(--ds-color-text))]">{option.label}</span>
              {option.description && (
                <span className="block truncate text-xs text-[hsl(var(--ds-color-text-muted))]">
                  {option.description}
                </span>
              )}
            </span>
            {selected && (
              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--ds-color-primary))] text-[hsl(var(--ds-color-text-inverse))] shadow-sm">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
