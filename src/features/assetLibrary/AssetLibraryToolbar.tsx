import { memo, useRef, useState, type ReactNode } from 'react'
import type { AssetLibraryFilters, AssetSortKey, AssetSourceMode, PinnedFilter } from '../../types'
import {
  Badge,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  SearchField,
  SegmentedControl,
  Slider,
  Toolbar,
} from '../../design-system'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  ListChecksIcon,
  PinIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from '../../design-system/icons'
import { useAssetLibraryStore, type AssetGridDensity, type AssetGroupBy } from './store'
import { COLOR_LABEL_OPTIONS } from './colorLabels'
import { pinnedFilterKey, pinnedFilterLabel } from './pinnedFilters'
import FilterControlStrip from './FilterControlStrip'
import { useStore } from '../../store'

export interface AssetLibraryToolbarProps {
  scopeLabel: string
  totalCount: number
  /** 当前查询结果可见素材数（用于全选） */
  visibleCount?: number
  onSelectAll?: () => void
  /** 回收站素材数；大于 0 时显示清空回收站 */
  trashCount?: number
  onEmptyTrash?: () => void
  /** 服务商筛选选项（来自素材来源） */
  providerOptions?: string[]
  /** 相似图片搜索标签；存在时显示可清除的徽章 */
  similarLabel?: string
  onClearSimilar?: () => void
  /** 导入外部图片文件为素材 */
  onImportFiles?: (files: File[]) => void
  /** 近似重复检测入口（Electron 可用时显示） */
  onOpenDuplicates?: () => void
  /** 当前范围是否为项目（文件夹）：显示「包含子文件夹」递归开关 */
  isCollectionScope?: boolean
  /** Ctrl/Cmd+F 聚焦搜索框 */
  searchInputRef?: React.Ref<HTMLInputElement>
}

const SORT_OPTIONS: Array<{ key: AssetSortKey; label: string }> = [
  { key: 'updatedAt', label: '最近整理' },
  { key: 'createdAt', label: '生成时间' },
  { key: 'rating', label: '评分' },
  { key: 'width', label: '宽度' },
  { key: 'area', label: '面积' },
]

const SOURCE_MODE_LABELS: Record<AssetSourceMode, string> = {
  gallery: '画廊',
  agent: 'Agent',
  schedule: '日程',
  sop: 'SOP',
  unknown: '未知',
}

function toDateInputValue(timestamp: number | undefined): string {
  if (timestamp === undefined) return ''
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 筛选面板里的「固定到顶部」图钉按钮：
 * 把当前控件选中的单个筛选值固定到顶部快捷栏（再次点击取消固定）。
 * disabled 时（当前值为「不限」）置灰并提示先选择值。
 */
function FilterPinButton({ filter, disabled = false }: { filter: PinnedFilter; disabled?: boolean }) {
  const pinnedFilters = useAssetLibraryStore((s) => s.pinnedFilters)
  const togglePinFilter = useAssetLibraryStore((s) => s.togglePinFilter)
  const isPinned = pinnedFilters.some((item) => pinnedFilterKey(item) === pinnedFilterKey(filter))
  const label = pinnedFilterLabel(filter)
  return (
    <button
      type="button"
      aria-label={isPinned ? `取消固定到顶部：${label}` : `固定到顶部：${label}`}
      aria-pressed={isPinned}
      title={
        disabled ? '先选择值再固定到顶部' : isPinned ? `已固定到顶部，点击取消（${label}）` : `固定到顶部（${label}）`
      }
      disabled={disabled}
      data-testid={`asset-filter-pin-${pinnedFilterKey(filter)}`}
      onClick={() => togglePinFilter(filter)}
      className={`flex shrink-0 items-center rounded p-1 outline-none transition focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
        isPinned
          ? 'text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10'
          : 'text-ds-muted hover:bg-ds-muted/15 hover:text-ds-text'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <PinIcon size={12} filled={isPinned} aria-hidden="true" />
    </button>
  )
}

function AssetLibraryToolbar({
  scopeLabel,
  totalCount,
  visibleCount = 0,
  onSelectAll,
  trashCount = 0,
  onEmptyTrash,
  providerOptions = [],
  similarLabel,
  onClearSimilar,
  onImportFiles,
  onOpenDuplicates,
  isCollectionScope = false,
  searchInputRef,
}: AssetLibraryToolbarProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const query = useAssetLibraryStore((s) => s.query)
  const setQuery = useAssetLibraryStore((s) => s.setQuery)
  const filters = useAssetLibraryStore((s) => s.filters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const sortKey = useAssetLibraryStore((s) => s.sortKey)
  const sortOrder = useAssetLibraryStore((s) => s.sortOrder)
  const setSort = useAssetLibraryStore((s) => s.setSort)
  const selectedAssetCount = useAssetLibraryStore((s) => s.selectedAssetIds.length)

  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  const activeFilterCount = [
    filters.favoriteOnly,
    filters.minRating !== undefined && filters.minRating > 0,
    filters.orientation,
    filters.provider,
    filters.model,
    filters.sourceMode,
    filters.collectionId,
    filters.colorLabel,
    (filters.tagIds?.length ?? 0) > 0,
    filters.dateFrom !== undefined,
    filters.dateTo !== undefined,
    filters.minWidth !== undefined,
    filters.maxWidth !== undefined,
  ].filter(Boolean).length

  const sortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label ?? '排序'

  const patchFilters = (patch: Partial<AssetLibraryFilters>) => {
    setFilters({ ...filters, ...patch })
  }

  const clearFilters = () => setFilters({})

  return (
    <Toolbar
      label="素材库工具栏"
      data-testid="asset-library-toolbar"
      className="flex flex-wrap items-center gap-2 px-8 py-2"
    >
      <span className="text-sm font-medium text-ds-foreground">{scopeLabel}</span>
      <span className="text-xs tabular-nums text-ds-muted">{totalCount} 张</span>
      {selectedAssetCount > 0 && (
        <span
          role="status"
          aria-live="polite"
          data-testid="asset-selection-count"
          className="text-xs font-semibold tabular-nums text-ds-primary"
        >
          已选择 {selectedAssetCount} 张
        </span>
      )}

      {isCollectionScope && <IncludeSubcollectionsSwitch />}

      {similarLabel && onClearSimilar && (
        <Badge tone="info">
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label={`清除相似搜索：${similarLabel}`}
            data-testid="asset-clear-similar"
            onClick={onClearSimilar}
          >
            {similarLabel}
            <XIcon size={12} />
          </button>
        </Badge>
      )}

      <SearchField
        ref={searchInputRef}
        className="w-56"
        size="sm"
        label="搜索素材"
        placeholder="搜索提示词、模型、项目"
        value={query}
        onChange={setQuery}
        onClear={() => setQuery('')}
      />

      {/* 筛选控件条：「+」菜单自主选择放出的筛选参数（维度级），选值即筛选 */}
      <FilterControlStrip providerOptions={providerOptions} />

      <div className="relative">
        <Badge tone={activeFilterCount > 0 ? 'info' : 'neutral'}>
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen((open) => !open)
              setSortOpen(false)
            }}
          >
            筛选
            {activeFilterCount > 0 && <span className="tabular-nums">({activeFilterCount})</span>}
          </button>
        </Badge>
        {filterOpen && (
          <Popover label="素材筛选" className="!absolute left-0 top-full z-dropdown mt-2 w-72">
            <div className="max-h-[28rem] space-y-3 overflow-y-auto p-3">
              <label className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  仅看收藏
                  <FilterPinButton filter={{ kind: 'favoriteOnly' }} />
                </span>
                <input
                  type="checkbox"
                  checked={filters.favoriteOnly === true}
                  onChange={(event) => patchFilters({ favoriteOnly: event.target.checked || undefined })}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  最低评分
                  <FilterPinButton
                    filter={{ kind: 'minRating', value: filters.minRating ?? 1 }}
                    disabled={!filters.minRating || filters.minRating <= 0}
                  />
                </span>
                <select
                  value={filters.minRating ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    patchFilters({ minRating: value > 0 ? value : undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value={0}>不限</option>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} 星及以上
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  形状
                  <FilterPinButton
                    filter={{ kind: 'orientation', value: filters.orientation ?? 'landscape' }}
                    disabled={!filters.orientation}
                  />
                </span>
                <select
                  value={filters.orientation ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetLibraryFilters['orientation']
                    patchFilters({ orientation: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  <option value="landscape">横向</option>
                  <option value="portrait">纵向</option>
                  <option value="square">方形</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  生成来源
                  <FilterPinButton
                    filter={{ kind: 'sourceMode', value: filters.sourceMode ?? 'gallery' }}
                    disabled={!filters.sourceMode}
                  />
                </span>
                <select
                  value={filters.sourceMode ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetSourceMode | ''
                    patchFilters({ sourceMode: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {Object.entries(SOURCE_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  颜色
                  <FilterPinButton
                    filter={{ kind: 'colorLabel', value: filters.colorLabel ?? 'red' }}
                    disabled={!filters.colorLabel}
                  />
                </span>
                <select
                  value={filters.colorLabel ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetLibraryFilters['colorLabel']
                    patchFilters({ colorLabel: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {COLOR_LABEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  服务商
                  <FilterPinButton
                    filter={{ kind: 'provider', value: filters.provider ?? '' }}
                    disabled={!filters.provider}
                  />
                </span>
                <select
                  value={filters.provider ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    patchFilters({ provider: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  模型
                  <FilterPinButton
                    filter={{ kind: 'model', value: filters.model ?? '' }}
                    disabled={!filters.model?.trim()}
                  />
                </span>
                <input
                  type="text"
                  value={filters.model ?? ''}
                  onChange={(event) => patchFilters({ model: event.target.value.trim() || undefined })}
                  placeholder="如 gpt-image-1"
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 outline-none placeholder:text-ds-muted focus:border-ds-primary"
                />
              </label>
              <fieldset className="block text-xs">
                <legend className="mb-1">生成日期</legend>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="起始日期"
                    value={toDateInputValue(filters.dateFrom)}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ dateFrom: value ? new Date(`${value}T00:00:00`).getTime() : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                  <span className="text-ds-muted">至</span>
                  <input
                    type="date"
                    aria-label="结束日期"
                    value={toDateInputValue(filters.dateTo)}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ dateTo: value ? new Date(`${value}T23:59:59.999`).getTime() : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                </div>
              </fieldset>
              <fieldset className="block text-xs">
                <legend className="mb-1">宽度（像素）</legend>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    aria-label="最小宽度"
                    placeholder="最小"
                    value={filters.minWidth ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ minWidth: value ? Number(value) : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                  <span className="text-ds-muted">至</span>
                  <input
                    type="number"
                    min={0}
                    aria-label="最大宽度"
                    placeholder="最大"
                    value={filters.maxWidth ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ maxWidth: value ? Number(value) : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                </div>
              </fieldset>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs text-ds-primary"
                >
                  <XIcon size={12} /> 清除全部筛选
                </button>
              )}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative">
        <Badge tone="neutral">
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-expanded={sortOpen}
            onClick={() => {
              setSortOpen((open) => !open)
              setFilterOpen(false)
            }}
          >
            <ArrowDownIcon size={13} />
            {sortLabel}
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </Badge>
        {sortOpen && (
          <Popover label="素材排序" className="!absolute left-0 top-full z-dropdown mt-2 w-52">
            <Menu label="排序方式">
              {SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.key}
                  onClick={() => {
                    const nextOrder = sortKey === option.key && sortOrder === 'desc' ? 'asc' : 'desc'
                    setSort(option.key, nextOrder)
                    setSortOpen(false)
                  }}
                >
                  {option.label}
                  {sortKey === option.key ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ''}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setSort('updatedAt', 'desc')
                  setSortOpen(false)
                }}
              >
                重置排序
              </MenuItem>
            </Menu>
          </Popover>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <FavoriteToggleButton />
        <ViewPresetControl />
        {/* 显示大小滑动条（图片 / 任务卡片共用）+ 列表按钮（仅图片视图） */}
        <LayoutPresetControl />
        <SaveFilterButton />
        {onImportFiles && (
          <>
            <Badge tone="neutral">
              <button
                type="button"
                className="flex items-center gap-1.5"
                data-testid="asset-import-files"
                onClick={() => importInputRef.current?.click()}
              >
                <FolderIcon size={13} />
                导入图片
              </button>
            </Badge>
            <input
              ref={importInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : []
                if (files.length > 0) onImportFiles(files)
                event.target.value = ''
              }}
            />
          </>
        )}
        {onOpenDuplicates && (
          <Badge tone="neutral">
            <button
              type="button"
              className="flex items-center gap-1.5"
              data-testid="asset-open-duplicates"
              onClick={onOpenDuplicates}
            >
              <CopyIcon size={13} />
              查重
            </button>
          </Badge>
        )}
        {onSelectAll && visibleCount > 0 && (
          <Badge tone="neutral">
            <button
              type="button"
              className="flex items-center gap-1.5"
              data-testid="asset-select-all"
              onClick={onSelectAll}
              title="选中当前查询的全部素材（不受分页限制）"
            >
              <CheckCircleIcon size={13} />
              全选全部结果
            </button>
          </Badge>
        )}
        {onEmptyTrash && trashCount > 0 && (
          <Badge tone="danger">
            <button
              type="button"
              className="flex items-center gap-1.5"
              data-testid="asset-empty-trash"
              onClick={onEmptyTrash}
            >
              <TrashIcon size={13} />
              清空回收站
            </button>
          </Badge>
        )}
      </div>
    </Toolbar>
  )
}

/** 「包含子文件夹」：项目 scope 递归查询开关（Eagle 风格，持久化，默认开启）。 */
function IncludeSubcollectionsSwitch() {
  const includeSubcollections = useAssetLibraryStore((s) => s.includeSubcollections)
  const setIncludeSubcollections = useAssetLibraryStore((s) => s.setIncludeSubcollections)
  return (
    <Badge tone={includeSubcollections ? 'info' : 'neutral'}>
      <button
        type="button"
        role="switch"
        aria-checked={includeSubcollections}
        aria-label="包含子文件夹"
        data-testid="asset-include-subcollections"
        title="关闭时仅显示当前文件夹素材（顶部展示子文件夹，可点击进入）；开启后连同全部下级文件夹的素材一起显示"
        onClick={() => setIncludeSubcollections(!includeSubcollections)}
        className="flex items-center gap-1.5"
      >
        <FolderOpenIcon size={13} />
        包含子文件夹
        <span
          aria-hidden="true"
          className={`relative h-3.5 w-6 rounded-full transition-colors ${includeSubcollections ? 'bg-ds-primary' : 'bg-ds-muted/40'}`}
        >
          <span
            className={`absolute top-0.5 left-0 h-2.5 w-2.5 rounded-full bg-ds-surface transition-transform ${includeSubcollections ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </span>
      </button>
    </Badge>
  )
}

/** 视图预设（图片 / 任务卡片，0.7.56 方案）：生图由任务卡承载，两种方式都只是展示形式。
 *  - 图片：大图平铺（纯素材网格 / 列表），看"图"；
 *  - 任务卡片：每次生成对应一张任务卡（承载提示词、参数与图片），看"任务"。
 *  旧的「分组·图片砖」展现已并入任务卡片（迁移时归一，工具栏不再提供入口）。 */
type ViewPreset = 'images' | 'cards'

function getViewPreset(groupBy: AssetGroupBy): ViewPreset {
  return groupBy === 'none' ? 'images' : 'cards'
}

const VIEW_PRESET_OPTIONS: Array<{ value: ViewPreset; label: string; icon: ReactNode }> = [
  { value: 'images', label: '图片', icon: <ImageIcon size={13} /> },
  { value: 'cards', label: '任务卡片', icon: <ListChecksIcon size={13} /> },
]

/** 视图按钮组（图片 / 任务卡片）：点击即切换，持久化；对应 0.7.56 画廊的「大图 / 任务卡片」两种显示方式。 */
function ViewPresetControl() {
  const groupBy = useAssetLibraryStore((s) => s.groupBy)
  const setGroupBy = useAssetLibraryStore((s) => s.setGroupBy)

  return (
    <SegmentedControl
      aria-label="视图方式"
      size="sm"
      value={getViewPreset(groupBy)}
      options={VIEW_PRESET_OPTIONS.map((option) => ({
        value: option.value,
        label: (
          <span className="flex items-center gap-1">
            {option.icon}
            {option.label}
          </span>
        ),
      }))}
      onValueChange={(value) => setGroupBy(value === 'images' ? 'none' : 'grouped')}
    />
  )
}

/** 显示大小滑动条（Eagle 式，图片 / 任务卡片视图共用）：拖动调节网格密度与任务卡片列数（紧凑 / 标准 / 大图）。
 *  列表保留为独立小按钮（仅图片视图；列表不消耗密度，选择列表时保留密度偏好，返回网格时恢复）。 */
const DENSITY_ORDER: AssetGridDensity[] = ['compact', 'standard', 'cozy']

function LayoutPresetControl() {
  const viewMode = useAssetLibraryStore((s) => s.viewMode)
  const gridDensity = useAssetLibraryStore((s) => s.gridDensity)
  const groupBy = useAssetLibraryStore((s) => s.groupBy)
  const setViewMode = useAssetLibraryStore((s) => s.setViewMode)
  const setGridDensity = useAssetLibraryStore((s) => s.setGridDensity)

  const isImages = getViewPreset(groupBy) === 'images'

  return (
    <div className="flex items-center gap-1.5">
      <Slider
        aria-label="显示大小"
        title="拖动调节显示大小：紧凑 / 标准 / 大图"
        className="[&_input]:w-24"
        min={0}
        max={DENSITY_ORDER.length - 1}
        step={1}
        value={DENSITY_ORDER.indexOf(gridDensity)}
        onChange={(value) => {
          setGridDensity(DENSITY_ORDER[value])
          setViewMode('grid')
        }}
      />
      {isImages && (
        <Badge tone={viewMode === 'list' ? 'info' : 'neutral'}>
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label="列表视图"
            aria-pressed={viewMode === 'list'}
            title="列表视图"
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          >
            <ListChecksIcon size={13} />
          </button>
        </Badge>
      )}
    </div>
  )
}

/** 保存当前范围/关键词/筛选为智能文件夹。 */
function SaveFilterButton() {
  const query = useAssetLibraryStore((s) => s.query)
  const filters = useAssetLibraryStore((s) => s.filters)
  const scope = useAssetLibraryStore((s) => s.scope)
  const addSavedFilter = useAssetLibraryStore((s) => s.addSavedFilter)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const hasActiveCriteria = Boolean(query.trim()) || Object.keys(filters).length > 0 || scope !== 'all'
  if (!hasActiveCriteria) return null

  return (
    <div className="relative">
      <Badge tone="neutral">
        <button
          type="button"
          className="flex items-center gap-1.5"
          aria-expanded={open}
          data-testid="asset-save-filter"
          onClick={() => {
            setOpen((value) => !value)
            setName('')
          }}
        >
          <FolderIcon size={13} />
          保存为智能文件夹
        </button>
      </Badge>
      {open && (
        <Popover label="保存智能文件夹" className="!absolute right-0 top-full z-dropdown mt-2 w-60">
          <form
            className="flex items-center gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                const saved = addSavedFilter(name)
                if (saved) {
                  setOpen(false)
                  useStore.getState().showToast(`已保存智能文件夹「${saved.name}」`, 'success')
                }
              } catch {
                useStore.getState().showToast('保存失败', 'error')
              }
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="文件夹名称，如：竖版高清"
              aria-label="智能文件夹名称"
              className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1 text-xs outline-none placeholder:text-ds-muted focus:border-ds-primary"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="shrink-0 rounded-md bg-ds-primary px-2.5 py-1 text-xs font-medium text-ds-text-inverse outline-none hover:bg-ds-primary-hover disabled:opacity-50"
            >
              保存
            </button>
          </form>
        </Popover>
      )}
    </div>
  )
}

/** 收藏夹按钮：进入/退出收藏夹（收藏夹内容嵌入素材库内容区，侧栏与顶部工具栏保持不变）。
 * 与素材库「仅看收藏」筛选解耦——本按钮只驱动主 store 的 filterFavorite，由 AssetLibraryWorkspace 渲染收藏夹。 */
function FavoriteToggleButton() {
  const filters = useAssetLibraryStore((s) => s.filters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)

  const handleClick = () => {
    if (filterFavorite) {
      // 退出收藏夹：清收藏模式与收藏夹选择，并同步素材库的收藏筛选
      setFilterFavorite(false)
      setActiveFavoriteCollectionId(null)
      if (filters.favoriteOnly) setFilters({ ...filters, favoriteOnly: undefined })
      return
    }
    // 进入收藏夹概览
    setFilterFavorite(true)
    setActiveFavoriteCollectionId(null)
  }

  return (
    <div className="flex items-center gap-2">
      {filterFavorite && activeFavoriteCollectionId && (
        <Badge tone="neutral">
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label="返回收藏夹概览"
            title="返回收藏夹概览"
            onClick={() => setActiveFavoriteCollectionId(null)}
          >
            <ArrowLeftIcon size={13} />
          </button>
        </Badge>
      )}
      <Badge tone={filterFavorite ? 'info' : 'neutral'}>
        <button
          type="button"
          className="flex items-center gap-1.5"
          aria-label={filterFavorite ? '退出收藏夹' : '收藏夹'}
          aria-pressed={filterFavorite}
          data-testid="asset-favorite-toggle"
          title={filterFavorite ? '退出收藏夹' : '收藏夹'}
          onClick={handleClick}
        >
          <StarIcon size={13} fill={filterFavorite ? 'currentColor' : 'none'} />
          {filterFavorite ? '退出收藏夹' : '收藏夹'}
        </button>
      </Badge>
    </div>
  )
}

export default memo(AssetLibraryToolbar)
