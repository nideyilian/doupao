import { memo, useState } from 'react'
import type { AssetLibraryFilters, FilterControlKey } from '../../types'
import { CheckIcon, PlusIcon } from '../../design-system/icons'
import { COLOR_LABEL_OPTIONS } from './colorLabels'
import { useAssetLibraryStore } from './store'

/**
 * 顶部工具栏筛选控件条：用户通过「+」菜单自主选择把哪些「整个筛选参数（维度）」
 * 常驻在工具栏直接操作（选值即筛选）。未放出的维度仍从筛选弹层使用。
 * 控件交互与筛选面板一致；配置（visibleFilterControls）本地持久化。
 */

const SOURCE_MODE_LABELS: Record<NonNullable<AssetLibraryFilters['sourceMode']>, string> = {
  gallery: '画廊',
  agent: 'Agent',
  schedule: '日程',
  sop: 'SOP',
  unknown: '未知',
}

const ORIENTATION_LABELS: Record<NonNullable<AssetLibraryFilters['orientation']>, string> = {
  landscape: '横向',
  portrait: '纵向',
  square: '方形',
}

const CONTROL_OPTIONS: Array<{ key: FilterControlKey; label: string }> = [
  { key: 'favoriteOnly', label: '仅看收藏' },
  { key: 'minRating', label: '最低评分' },
  { key: 'provider', label: '服务商' },
  { key: 'model', label: '模型' },
  { key: 'orientation', label: '形状' },
  { key: 'sourceMode', label: '生成来源' },
  { key: 'colorLabel', label: '颜色' },
  { key: 'dateRange', label: '生成日期' },
  { key: 'widthRange', label: '宽度' },
]

const CONTROL_SELECT_CLASS =
  'h-7 rounded border border-ds-border bg-ds-surface px-1.5 text-xs text-ds-text outline-none transition focus:border-ds-primary'
const CONTROL_INPUT_CLASS =
  'h-7 rounded border border-ds-border bg-ds-surface px-1.5 text-xs text-ds-text outline-none transition placeholder:text-ds-muted focus:border-ds-primary'

interface FilterControlStripProps {
  /** 服务商筛选选项（来自素材来源） */
  providerOptions?: string[]
}

function FilterControlStrip({ providerOptions = [] }: FilterControlStripProps) {
  const filters = useAssetLibraryStore((s) => s.filters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const visibleControls = useAssetLibraryStore((s) => s.visibleFilterControls)
  const setVisibleFilterControls = useAssetLibraryStore((s) => s.setVisibleFilterControls)
  const [menuOpen, setMenuOpen] = useState(false)

  const patchFilters = (patch: Partial<AssetLibraryFilters>) => {
    setFilters({ ...filters, ...patch })
  }

  const toggleControl = (key: FilterControlKey) => {
    const next = visibleControls.includes(key)
      ? visibleControls.filter((item) => item !== key)
      : [...visibleControls, key]
    setVisibleFilterControls(next)
  }

  const visible = new Set(visibleControls)
  const hasControls = visible.size > 0

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="asset-filter-control-strip">
      {hasControls && (
        <div className="custom-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {visible.has('favoriteOnly') && (
            <label
              className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded border border-ds-border bg-ds-surface px-1.5 text-xs text-ds-text"
              title="仅看收藏"
            >
              <input
                type="checkbox"
                aria-label="仅看收藏"
                data-testid="filter-control-favoriteOnly"
                checked={filters.favoriteOnly === true}
                onChange={(event) => patchFilters({ favoriteOnly: event.target.checked || undefined })}
              />
              仅看收藏
            </label>
          )}

          {visible.has('minRating') && (
            <select
              aria-label="最低评分"
              data-testid="filter-control-minRating"
              title="最低评分"
              value={filters.minRating ?? 0}
              onChange={(event) => {
                const value = Number(event.target.value)
                patchFilters({ minRating: value > 0 ? value : undefined })
              }}
              className={`${CONTROL_SELECT_CLASS} shrink-0`}
            >
              <option value={0}>评分不限</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating} 星及以上
                </option>
              ))}
            </select>
          )}

          {visible.has('provider') && (
            <select
              aria-label="服务商"
              data-testid="filter-control-provider"
              title="服务商"
              value={filters.provider ?? ''}
              onChange={(event) => {
                const value = event.target.value
                patchFilters({ provider: value || undefined })
              }}
              className={`${CONTROL_SELECT_CLASS} shrink-0`}
            >
              <option value="">服务商不限</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          )}

          {visible.has('model') && (
            <input
              type="text"
              aria-label="模型"
              data-testid="filter-control-model"
              title="模型（部分匹配）"
              placeholder="模型"
              value={filters.model ?? ''}
              onChange={(event) => patchFilters({ model: event.target.value.trim() || undefined })}
              className={`${CONTROL_INPUT_CLASS} w-24 shrink-0`}
            />
          )}

          {visible.has('orientation') && (
            <select
              aria-label="形状"
              data-testid="filter-control-orientation"
              title="形状"
              value={filters.orientation ?? ''}
              onChange={(event) => {
                const value = event.target.value as AssetLibraryFilters['orientation']
                patchFilters({ orientation: value || undefined })
              }}
              className={`${CONTROL_SELECT_CLASS} shrink-0`}
            >
              <option value="">形状不限</option>
              <option value="landscape">横向</option>
              <option value="portrait">纵向</option>
              <option value="square">方形</option>
            </select>
          )}

          {visible.has('sourceMode') && (
            <select
              aria-label="生成来源"
              data-testid="filter-control-sourceMode"
              title="生成来源"
              value={filters.sourceMode ?? ''}
              onChange={(event) => {
                const value = event.target.value as AssetLibraryFilters['sourceMode']
                patchFilters({ sourceMode: value || undefined })
              }}
              className={`${CONTROL_SELECT_CLASS} shrink-0`}
            >
              <option value="">来源不限</option>
              {Object.entries(SOURCE_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}

          {visible.has('colorLabel') && (
            <select
              aria-label="颜色"
              data-testid="filter-control-colorLabel"
              title="颜色"
              value={filters.colorLabel ?? ''}
              onChange={(event) => {
                const value = event.target.value as AssetLibraryFilters['colorLabel']
                patchFilters({ colorLabel: value || undefined })
              }}
              className={`${CONTROL_SELECT_CLASS} shrink-0`}
            >
              <option value="">颜色不限</option>
              {COLOR_LABEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {visible.has('dateRange') && (
            <div className="flex shrink-0 items-center gap-1" title="生成日期范围">
              <input
                type="date"
                aria-label="起始日期"
                data-testid="filter-control-dateFrom"
                value={toDateInputValue(filters.dateFrom)}
                onChange={(event) => {
                  const value = event.target.value
                  patchFilters({ dateFrom: value ? new Date(`${value}T00:00:00`).getTime() : undefined })
                }}
                className={CONTROL_INPUT_CLASS}
              />
              <span className="text-xs text-ds-muted">至</span>
              <input
                type="date"
                aria-label="结束日期"
                data-testid="filter-control-dateTo"
                value={toDateInputValue(filters.dateTo)}
                onChange={(event) => {
                  const value = event.target.value
                  patchFilters({ dateTo: value ? new Date(`${value}T23:59:59.999`).getTime() : undefined })
                }}
                className={CONTROL_INPUT_CLASS}
              />
            </div>
          )}

          {visible.has('widthRange') && (
            <div className="flex shrink-0 items-center gap-1" title="宽度范围（像素）">
              <input
                type="number"
                min={0}
                aria-label="最小宽度"
                data-testid="filter-control-minWidth"
                placeholder="最小宽"
                value={filters.minWidth ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  patchFilters({ minWidth: value ? Number(value) : undefined })
                }}
                className={`${CONTROL_INPUT_CLASS} w-16`}
              />
              <span className="text-xs text-ds-muted">至</span>
              <input
                type="number"
                min={0}
                aria-label="最大宽度"
                data-testid="filter-control-maxWidth"
                placeholder="最大宽"
                value={filters.maxWidth ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  patchFilters({ maxWidth: value ? Number(value) : undefined })
                }}
                className={`${CONTROL_INPUT_CLASS} w-16`}
              />
            </div>
          )}
        </div>
      )}

      {/* 「+」菜单：自主选择放出的筛选项（维度） */}
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="添加筛选项"
          aria-expanded={menuOpen}
          data-testid="filter-control-add"
          title="选择要放在工具栏的筛选项"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-7 w-7 items-center justify-center rounded border border-ds-border text-ds-muted outline-none transition hover:border-ds-primary/50 hover:bg-ds-primary-subtle hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-focus/70 dark:hover:bg-ds-primary/10"
        >
          <PlusIcon size={14} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="添加筛选项"
            data-testid="filter-control-add-menu"
            className="absolute right-0 top-full z-dropdown mt-1 w-40 rounded-md border border-ds-border bg-ds-surface p-1 shadow-lg"
            onMouseLeave={() => setMenuOpen(false)}
          >
            {CONTROL_OPTIONS.map((option) => {
              const checked = visible.has(option.key)
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  data-testid={`filter-control-option-${option.key}`}
                  onClick={() => toggleControl(option.key)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ds-text outline-none transition hover:bg-ds-muted/10 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                      checked ? 'border-ds-primary bg-ds-primary text-ds-text-inverse' : 'border-ds-border'
                    }`}
                  >
                    {checked && <CheckIcon size={10} />}
                  </span>
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function toDateInputValue(timestamp: number | undefined): string {
  if (timestamp === undefined) return ''
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export default memo(FilterControlStrip)
