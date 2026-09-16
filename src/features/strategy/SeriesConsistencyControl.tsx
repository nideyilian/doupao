import { useEffect, useRef, useState } from 'react'
import { Popover, cx } from '../../design-system'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import {
  SOP_SERIES_COPY_DIMENSION,
  SOP_SERIES_DEFAULT_FIXED_DIMENSIONS,
  SOP_SERIES_DIMENSIONS,
} from './sopSeriesDimensions'

/**
 * 系列一致性配置：哪些维度组内固定、固定成什么值。
 *
 * 两个层级的「固定」必须区分清楚，否则用户会以为填了值只有组内统一：
 * - 维度点亮、值留空 → 模型为**每组**单独定一套，组内共用、组间有区别；
 * - 维度点亮、值填了 → 该值**所有组**逐字一致（全局硬锁），组间差异只能由其它未锁定维度承担。
 */
export interface SeriesConsistencyValue {
  /** 组内固定维度；维度库里的其余维度每张变化。 */
  fixedDimensions: string[]
  /** 固定维度上用户填的具体值：填了就是全局锁定，留空表示交给模型按组补全。 */
  fixedValues: Record<string, string>
}

interface SeriesConsistencyControlProps {
  value: SeriesConsistencyValue
  onChange: (next: SeriesConsistencyValue) => void
  disabled?: boolean
}

/** 预设：一次点击覆盖全部 7 个维度，避免逐个点。 */
const PRESETS: { label: string; fixedDimensions: string[] }[] = [
  { label: '推荐', fixedDimensions: SOP_SERIES_DEFAULT_FIXED_DIMENSIONS },
  { label: '全固定', fixedDimensions: [...SOP_SERIES_DIMENSIONS] },
  { label: '全变化', fixedDimensions: [] },
]

function isSameDimensions(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/**
 * 系列一致性控件：单行胶囊触发，点开是一个 Popover。
 *
 * 只放出真正改变画面的 7 个维度，每个维度点一下就在「组内固定 / 每张变化」之间切换；
 * 固定维度可以顺手填一个具体值，填了的值由客户端逐字写进提示词，模型改写不了。
 */
export default function SeriesConsistencyControl({ value, onChange, disabled }: SeriesConsistencyControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useCloseOnEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [open])

  const fixedCount = value.fixedDimensions.length
  const lockedCount = value.fixedDimensions.filter((dimension) => value.fixedValues[dimension]?.trim()).length
  const copyFixed = value.fixedDimensions.includes(SOP_SERIES_COPY_DIMENSION)

  const toggleDimension = (dimension: string) => {
    const nextFixed = value.fixedDimensions.includes(dimension)
      ? value.fixedDimensions.filter((item) => item !== dimension)
      : [...value.fixedDimensions, dimension]
    // 保持维度库顺序，避免提示词里固定项的排列随点击顺序漂移
    onChange({ ...value, fixedDimensions: SOP_SERIES_DIMENSIONS.filter((item) => nextFixed.includes(item)) })
  }

  const setFixedValue = (dimension: string, nextValue: string) => {
    onChange({ ...value, fixedValues: { ...value.fixedValues, [dimension]: nextValue } })
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`系列一致性：${fixedCount} 项组内固定，其中 ${lockedCount} 项所有组统一，其余每张变化`}
        title="设置哪些维度在一组内保持一致、哪些每张变化；给固定维度填上值则所有组都一致"
        className={cx(
          'flex h-ds-control-md items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:opacity-50',
          fixedCount > 0
            ? 'border-ds-primary/30 bg-ds-primary-subtle text-ds-primary'
            : 'border-ds-border/70 bg-ds-surface/55 text-ds-muted',
        )}
      >
        <span>一致性</span>
        <span className="tabular-nums font-semibold">
          {fixedCount}/{SOP_SERIES_DIMENSIONS.length}
        </span>
        {lockedCount > 0 && <span className="tabular-nums text-ds-muted">· 锁定 {lockedCount}</span>}
      </button>

      {open && (
        <Popover
          label="系列一致性设置"
          // 输入栏在屏幕底部，面板向上展开；Popover 自带的小箭头只朝下，这里关掉
          arrow={false}
          // 输入栏在屏幕底部，面板向上展开；Popover 自带的小箭头只朝下，这里关掉。
          // 靠左对齐向外扩：胶囊位于输入栏左半侧，右对齐会让 22rem 宽的面板顶出屏幕左侧。
          className="!absolute bottom-full left-0 z-dropdown mb-2 w-[22rem]"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ds-text">系列一致性</p>
            <div className="flex items-center gap-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChange({ ...value, fixedDimensions: [...preset.fixedDimensions] })}
                  aria-pressed={isSameDimensions(value.fixedDimensions, preset.fixedDimensions)}
                  className={cx(
                    'rounded-ds-sm px-1.5 py-0.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus',
                    isSameDimensions(value.fixedDimensions, preset.fixedDimensions)
                      ? 'bg-ds-primary-subtle font-semibold text-ds-primary'
                      : 'text-ds-muted hover:bg-ds-subtle hover:text-ds-text',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-1.5 text-xs leading-4 text-ds-muted">点亮＝一组内一致，灰色＝每张不同。</p>
          <p className="mt-1 text-xs leading-4 text-ds-muted">给点亮项填上值＝所有组一致（全局锁定）。</p>

          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="系列一致性维度">
            {SOP_SERIES_DIMENSIONS.map((dimension) => {
              const fixed = value.fixedDimensions.includes(dimension)
              return (
                <button
                  key={dimension}
                  type="button"
                  role="switch"
                  aria-checked={fixed}
                  aria-label={`${dimension}${
                    fixed ? (value.fixedValues[dimension]?.trim() ? '所有组统一' : '组内固定') : '每张变化'
                  }`}
                  onClick={() => toggleDimension(dimension)}
                  className={cx(
                    'h-ds-control-sm rounded-ds-md border px-2 text-xs transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus',
                    fixed
                      ? 'border-ds-primary/40 bg-ds-primary-subtle font-semibold text-ds-primary'
                      : 'border-ds-border bg-ds-surface text-ds-muted hover:border-ds-border hover:text-ds-text',
                  )}
                >
                  {dimension}
                </button>
              )
            })}
          </div>

          {fixedCount > 0 ? (
            <>
              <div className="my-2.5 border-t border-ds-border" />
              <p className="mb-1.5 text-xs text-ds-muted">固定成什么（留空＝每组自己定，组间有区别）</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                {value.fixedDimensions.map((dimension) => (
                  <label
                    key={dimension}
                    // 文案比「3D 皮克斯风」这类关键词长得多，占满整行才看得全
                    className={cx(
                      'flex items-center gap-1.5 text-xs',
                      dimension === SOP_SERIES_COPY_DIMENSION && 'col-span-2',
                    )}
                  >
                    <span className="shrink-0 text-ds-muted">{dimension}</span>
                    <input
                      type="text"
                      value={value.fixedValues[dimension] ?? ''}
                      onChange={(event) => setFixedValue(dimension, event.target.value)}
                      aria-label={`${dimension}固定值`}
                      placeholder={dimension === SOP_SERIES_COPY_DIMENSION ? '模型定一句' : '模型自动'}
                      className="h-ds-control-sm min-w-0 flex-1 rounded-ds-md border border-ds-border bg-ds-surface px-2 text-xs text-ds-text outline-none placeholder:text-ds-muted focus-visible:border-ds-primary/40 focus-visible:ring-2 focus-visible:ring-ds-focus"
                    />
                  </label>
                ))}
              </div>
              {lockedCount > 0 && (
                <p className="mt-2 text-xs leading-4 text-ds-muted">填了值的固定项逐字写进每一组，模型不会改写。</p>
              )}
              {copyFixed && (
                <>
                  <p className="mt-1.5 text-xs leading-4 text-ds-muted">固定的文案会逐字画在图上，一组内每张都一样。</p>
                  <p className="mt-1 text-xs leading-4 text-ds-muted">给文案填上值＝所有组共用同一句。</p>
                </>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs leading-4 text-ds-muted">当前全部维度每张变化，适合想要明显差异的系列。</p>
          )}
        </Popover>
      )}
    </div>
  )
}
