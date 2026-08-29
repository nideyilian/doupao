import { useState, useRef, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_DROPDOWN_MAX_HEIGHT, getDropdownMaxHeight } from '../lib/dropdown'
import { ChevronDownIcon, EditIcon, PlusIcon, TrashIcon, DragHandleIcon } from './icons'

interface Option {
  label: string
  value: string | number
  variant?: 'action' | 'danger'
  draggable?: boolean
  actions?: Array<{
    label: string
    variant?: 'danger'
    onClick: () => void
  }>
}

interface SelectProps {
  value: string | number
  onChange: (value: string | number) => void
  onReorder?: (sourceValue: string | number, targetValue: string | number, position: 'before' | 'after' | null) => void
  options: Option[]
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

function getOptionClassName({
  dragged,
  dragOver,
  selected,
  variant,
}: {
  dragged: boolean
  dragOver: boolean
  selected: boolean
  variant?: Option['variant']
}) {
  return [
    'ds-legacy-select__option',
    dragged && 'ds-legacy-select__option--dragged',
    dragOver && 'ds-legacy-select__option--drag-over',
    selected && 'ds-legacy-select__option--selected',
    variant === 'action' && 'ds-legacy-select__option--action',
    variant === 'danger' && 'ds-legacy-select__option--danger',
  ]
    .filter(Boolean)
    .join(' ')
}

export default function Select({ value, onChange, onReorder, options, disabled, className, ariaLabel }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(DEFAULT_DROPDOWN_MAX_HEIGHT)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const [draggedValue, setDraggedValue] = useState<string | number | null>(null)
  const [dragOverValue, setDragOverValue] = useState<string | number | null>(null)
  const [dragDropPosition, setDragDropPosition] = useState<'before' | 'after' | null>(null)
  const [touchDragPreview, setTouchDragPreview] = useState<{
    label: string
    x: number
    y: number
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const touchDragRef = useRef<{ value: string | number; startX: number; startY: number; moved: boolean } | null>(null)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    return () => {
      if (dragScrollIntervalRef.current) clearInterval(dragScrollIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!touchDragPreview) return

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()
    }
    const listenerOptions = { passive: false, capture: true } as AddEventListenerOptions
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('touchmove', preventTouchScroll, listenerOptions)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('touchmove', preventTouchScroll, listenerOptions)
    }
  }, [touchDragPreview])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const updateMenuMaxHeight = () => {
      if (!triggerRef.current) return
      const trigger = triggerRef.current
      const rect = trigger.getBoundingClientRect()

      let availableBelow = window.innerHeight - rect.bottom - 8
      let availableAbove = rect.top - 8

      let parent = trigger.parentElement
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent)
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
          const parentRect = parent.getBoundingClientRect()
          availableBelow = Math.min(availableBelow, parentRect.bottom - rect.bottom - 8)
          availableAbove = Math.min(availableAbove, rect.top - parentRect.top - 8)
        }
        parent = parent.parentElement
      }

      let newPlacement: 'bottom' | 'top' = 'bottom'
      let maxHeight = DEFAULT_DROPDOWN_MAX_HEIGHT

      if (availableBelow < 120 && availableAbove > availableBelow) {
        newPlacement = 'top'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableAbove))
      } else {
        newPlacement = 'bottom'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableBelow))
      }

      setPlacement(newPlacement)
      setMenuMaxHeight(Math.max(0, maxHeight))
    }

    updateMenuMaxHeight()
    window.addEventListener('resize', updateMenuMaxHeight)
    window.addEventListener('scroll', updateMenuMaxHeight, true)
    return () => {
      window.removeEventListener('resize', updateMenuMaxHeight)
      window.removeEventListener('scroll', updateMenuMaxHeight, true)
    }
  }, [isOpen])

  const handleToggle = (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setIsOpen((open) => !open)
    // 动画和位置的计算在 useEffect 中进行，这里可以先假设一个默认值或保留当前状态
  }

  const focusMenuOption = (where: 'selected' | 'first' | 'last') => {
    const schedule =
      window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0))
    schedule(() => {
      const optionElements = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
      if (optionElements.length === 0) return
      const selectedIndex = options.findIndex((option) => option.value === value)
      const index = where === 'first' ? 0 : where === 'last' ? optionElements.length - 1 : Math.max(0, selectedIndex)
      optionElements[index]?.focus()
    })
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      focusMenuOption(event.key === 'ArrowUp' ? 'last' : 'selected')
    }
  }

  const clearTouchDrag = () => {
    touchDragRef.current = null
    setTouchDragPreview(null)
    setDraggedValue(null)
    setDragOverValue(null)
    setDragDropPosition(null)
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current)
      dragScrollIntervalRef.current = null
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        ref={triggerRef}
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        className={`ds-legacy-select__trigger flex items-center justify-between gap-1 w-full cursor-pointer select-none ${className ?? ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDownIcon className={`ds-legacy-select__chevron ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          id={menuId}
          ref={menuRef}
          className={`ds-legacy-select__menu custom-scrollbar ${
            placement === 'top' ? 'bottom-full mb-1.5 animate-dropdown-up' : 'top-full mt-1.5 animate-dropdown-down'
          }`}
          role="listbox"
          style={{ maxHeight: menuMaxHeight }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              data-option-value={String(option.value)}
              draggable={option.draggable}
              role="option"
              aria-selected={option.value === value}
              tabIndex={0}
              onDragStart={(e) => {
                if (!option.draggable) return
                setDraggedValue(option.value)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(option.value))
              }}
              onDragOver={(e) => {
                if (!option.draggable || !draggedValue) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'

                const targetElement = e.currentTarget as HTMLElement
                const rect = targetElement.getBoundingClientRect()
                const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

                if (dragOverValue !== option.value || dragDropPosition !== position) {
                  setDragOverValue(option.value)
                  setDragDropPosition(position)
                }

                // Auto-scroll
                const scrollContainer = targetElement.parentElement
                if (scrollContainer) {
                  const containerRect = scrollContainer.getBoundingClientRect()
                  const scrollThreshold = 30

                  if (e.clientY < containerRect.top + scrollThreshold) {
                    scrollContainer.scrollTop -= 10
                  } else if (e.clientY > containerRect.bottom - scrollThreshold) {
                    scrollContainer.scrollTop += 10
                  }
                }
              }}
              onDragEnd={() => {
                setDraggedValue(null)
                setDragOverValue(null)
                setDragDropPosition(null)
              }}
              onDrop={(e) => {
                if (!option.draggable || !onReorder) return
                e.preventDefault()
                setDraggedValue(null)
                setDragOverValue(null)
                setDragDropPosition(null)

                const sourceValue = e.dataTransfer.getData('text/plain')
                const sourceOption = options.find((o) => String(o.value) === sourceValue)
                if (sourceOption && sourceOption.value !== option.value) {
                  onReorder(sourceOption.value, option.value, dragDropPosition)
                }
              }}
              onTouchStart={(e) => {
                if (!option.draggable) return
                const target = e.target as HTMLElement
                if (!target.closest('[data-drag-handle]')) return

                const touch = e.touches[0]
                const rect = e.currentTarget.getBoundingClientRect()
                // Do not prevent default here, as it blocks scrolling
                // e.preventDefault()
                e.stopPropagation()
                touchDragRef.current = {
                  value: option.value,
                  startX: touch.clientX,
                  startY: touch.clientY,
                  moved: false,
                }
                setDraggedValue(option.value)
                setTouchDragPreview({
                  label: option.label,
                  x: touch.clientX,
                  y: touch.clientY,
                  width: rect.width,
                  height: rect.height,
                  offsetX: touch.clientX - rect.left,
                  offsetY: touch.clientY - rect.top,
                })
              }}
              onTouchMove={(e) => {
                const drag = touchDragRef.current
                if (!drag || !option.draggable) return
                const touch = e.touches[0]

                if (!drag.moved) {
                  if (Math.abs(touch.clientX - drag.startX) > 5 || Math.abs(touch.clientY - drag.startY) > 5) {
                    drag.moved = true
                  } else {
                    return
                  }
                }

                e.preventDefault() // prevent scrolling
                setTouchDragPreview((current) =>
                  current ? { ...current, x: touch.clientX, y: touch.clientY } : current,
                )

                // Hide preview visually so elementFromPoint works correctly
                const previewEl = document.getElementById('touch-drag-preview')
                if (previewEl) previewEl.style.pointerEvents = 'none'

                const el = document.elementFromPoint(touch.clientX, touch.clientY)
                const targetDiv = el?.closest('[data-option-value]') as HTMLElement
                if (targetDiv) {
                  const targetValueStr = targetDiv.getAttribute('data-option-value')
                  if (targetValueStr) {
                    const targetOption = options.find((o) => String(o.value) === targetValueStr)
                    if (targetOption && targetOption.draggable) {
                      const rect = targetDiv.getBoundingClientRect()
                      const position = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                      if (dragOverValue !== targetOption.value || dragDropPosition !== position) {
                        setDragOverValue(targetOption.value)
                        setDragDropPosition(position)
                      }
                    }
                  }
                }

                const scrollContainer = targetDiv?.closest('.custom-scrollbar') as HTMLElement
                if (scrollContainer) {
                  const containerRect = scrollContainer.getBoundingClientRect()
                  const scrollThreshold = 30

                  if (dragScrollIntervalRef.current) {
                    clearInterval(dragScrollIntervalRef.current)
                    dragScrollIntervalRef.current = null
                  }

                  if (touch.clientY < containerRect.top + scrollThreshold) {
                    dragScrollIntervalRef.current = window.setInterval(() => {
                      scrollContainer.scrollTop -= 5
                    }, 16)
                  } else if (touch.clientY > containerRect.bottom - scrollThreshold) {
                    dragScrollIntervalRef.current = window.setInterval(() => {
                      scrollContainer.scrollTop += 5
                    }, 16)
                  }
                }
              }}
              onTouchEnd={(e) => {
                const drag = touchDragRef.current
                if (!drag || !drag.moved) {
                  clearTouchDrag()
                  return
                }

                e.preventDefault()

                if (onReorder && dragOverValue !== null && dragOverValue !== drag.value) {
                  onReorder(drag.value, dragOverValue, dragDropPosition)
                }

                clearTouchDrag()
              }}
              onTouchCancel={clearTouchDrag}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, [data-drag-handle]')) return
                e.preventDefault()
                onChange(option.value)
                setIsOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(option.value)
                  setIsOpen(false)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setIsOpen(false)
                  triggerRef.current?.focus()
                } else if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'Home' ||
                  event.key === 'End'
                ) {
                  event.preventDefault()
                  const optionElements = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
                  const currentIndex = optionElements.indexOf(event.currentTarget)
                  const nextIndex =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? optionElements.length - 1
                        : event.key === 'ArrowDown'
                          ? Math.min(optionElements.length - 1, currentIndex + 1)
                          : Math.max(0, currentIndex - 1)
                  optionElements[nextIndex]?.focus()
                }
              }}
              className={getOptionClassName({
                dragged: draggedValue === option.value,
                dragOver: dragOverValue === option.value && draggedValue !== option.value,
                selected: option.value === value,
                variant: option.variant,
              })}
            >
              {dragOverValue === option.value && dragDropPosition === 'before' && draggedValue !== option.value && (
                <div className="ds-legacy-select__drop-line ds-legacy-select__drop-line--before" />
              )}
              {dragOverValue === option.value && dragDropPosition === 'after' && draggedValue !== option.value && (
                <div className="ds-legacy-select__drop-line ds-legacy-select__drop-line--after" />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                {option.draggable && (
                  <div
                    data-drag-handle
                    className="ds-legacy-select__drag-handle"
                    style={{ touchAction: 'none' }}
                    title="拖拽排序"
                  >
                    <DragHandleIcon className="h-3.5 w-3.5" />
                  </div>
                )}
                <span className="min-w-0 truncate">{option.label}</span>
              </div>
              {option.actions?.length ? (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {option.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      title={action.label}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        action.onClick()
                        setIsOpen(false)
                      }}
                      className={`ds-legacy-select__action-button ${
                        action.variant === 'danger' ? 'ds-legacy-select__action-button--danger' : ''
                      }`}
                    >
                      {action.label === '编辑' ? (
                        <EditIcon className="w-3.5 h-3.5" />
                      ) : action.label === '删除' ? (
                        <TrashIcon className="w-3.5 h-3.5" />
                      ) : (
                        action.label
                      )}
                    </button>
                  ))}
                </span>
              ) : null}
              {option.variant === 'action' && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <PlusIcon className="h-4 w-4" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {touchDragPreview &&
        createPortal(
          <div
            id="touch-drag-preview"
            className="ds-legacy-select__touch-preview"
            style={{
              left: touchDragPreview.x - touchDragPreview.offsetX,
              top: touchDragPreview.y - touchDragPreview.offsetY,
              width: touchDragPreview.width,
              minHeight: touchDragPreview.height,
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              <DragHandleIcon className="ds-legacy-select__touch-preview-icon" />
              <span className="min-w-0 truncate">{touchDragPreview.label}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
