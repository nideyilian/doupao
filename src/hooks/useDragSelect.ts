import { useEffect, useRef, useState, useCallback, type CSSProperties, type RefObject } from 'react'

export interface DragSelectionBox {
  startPageX: number
  startPageY: number
  currentPageX: number
  currentPageY: number
}

interface UseDragSelectOptions {
  containerSelector: string
  itemSelector: string
  /** 本次框选只作用于该容器元素（同一选择器可能同时存在多个表面，如素材库与弹窗并存）。
   *  缺省时回退到 `target.closest(containerSelector)`。 */
  containerRef?: RefObject<HTMLElement | null>
  /** 单元素 → 单个选中 id（默认模式，如素材网格卡片） */
  getItemId?: (element: Element) => string | null
  /** 单元素 → 多个选中 id（如批次卡片 → 组内全部素材）；优先于 getItemId */
  getItemIds?: (element: Element) => string[] | null
  /**
   * 纯数学命中（可选）：传入后替代「querySelectorAll + getBoundingClientRect」的 DOM 命中，
   * 框选拖拽每帧零强制布局（虚拟列表的布局数据已知，直接做矩形相交）。
   * box 坐标为 page 坐标（与选框一致），实现方自行换算到自己的内容坐标系。
   */
  hitTest?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => string[]
  onSelectionChange: (selectedIds: string[]) => void
  initialSelectedIds?: string[]
  onSuppressClick?: () => void
}

/** 最近的“可滚动祖先容器”：框选拖到边缘时对它自动滚动；找不到则回退到 window。
 *  从容器自身开始判断——素材库的表面 div 本身往往就是滚动容器。 */
function findScrollableAncestor(start: Element): HTMLElement | Window {
  let node: HTMLElement | null = start as HTMLElement
  while (node) {
    if (node.scrollHeight > node.clientHeight) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
    }
    node = node.parentElement
  }
  return window
}

/** 把框选的 page 坐标换算成容器内容坐标（随容器滚动自动校正），供绝对定位选框使用。 */
export function getMarqueeBoxStyle(box: DragSelectionBox, container: HTMLElement | null): CSSProperties {
  if (!container) return { display: 'none' }
  const rect = container.getBoundingClientRect()
  return {
    left: Math.min(box.startPageX, box.currentPageX) - window.scrollX - rect.left + container.scrollLeft,
    top: Math.min(box.startPageY, box.currentPageY) - window.scrollY - rect.top + container.scrollTop,
    width: Math.abs(box.currentPageX - box.startPageX),
    height: Math.abs(box.currentPageY - box.startPageY),
  }
}

export function useDragSelect({
  containerSelector,
  itemSelector,
  containerRef,
  getItemId,
  getItemIds,
  hitTest,
  onSelectionChange,
  initialSelectedIds = [],
  onSuppressClick,
}: UseDragSelectOptions) {
  const [selectionBox, setSelectionBox] = useState<DragSelectionBox | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const isDragging = useRef(false)
  const dragStart = useRef<{ pageX: number; pageY: number } | null>(null)
  const lastClientPoint = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const dragScrollDirectionRef = useRef<-1 | 1 | null>(null)
  const startedOnItem = useRef(false)
  const startedWithModifier = useRef(false)
  const initialSelection = useRef<string[]>([])
  // 选区会随拖拽实时变化；用 ref 保存最新值，避免 beginSelection 身份变化导致 effect 反复重建
  const initialSelectedIdsRef = useRef(initialSelectedIds)
  useEffect(() => {
    initialSelectedIdsRef.current = initialSelectedIds
  })
  // 回调也走 ref：消费者常传内联箭头函数，若直接进依赖，拖拽中任何一次选区更新都会
  // 重建 effect、中途丢失 wheel/scroll/keydown 监听（自动滚动重新命中 / Esc 取消失效）
  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  })
  const onSuppressClickRef = useRef(onSuppressClick)
  useEffect(() => {
    onSuppressClickRef.current = onSuppressClick
  })
  const getItemIdRef = useRef(getItemId)
  useEffect(() => {
    getItemIdRef.current = getItemId
  })
  const getItemIdsRef = useRef(getItemIds)
  useEffect(() => {
    getItemIdsRef.current = getItemIds
  })
  const hitTestRef = useRef(hitTest)
  useEffect(() => {
    hitTestRef.current = hitTest
  })
  const activeContainer = useRef<HTMLElement | null>(null)
  const scrollContainer = useRef<HTMLElement | Window | null>(null)
  const attachDragInteractionListenersRef = useRef<() => void>(() => {})
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  // —— 帧合并状态：mousemove/scroll 只记录最新点，rAF 每帧只重算一次
  // （框选拖拽的命中与 setState 从「每事件一次」降为「每帧一次」，消除强制布局风暴）
  const pendingPointRef = useRef<{ pageX: number; pageY: number } | null>(null)
  const selectionFrameRef = useRef<number | null>(null)
  // 上次下发的选区：内容相同时跳过 setState，避免鼠标微抖导致网格/工具栏整批重渲染
  const lastSelectionRef = useRef<string[] | null>(null)

  const getPagePoint = useCallback(
    (clientX: number, clientY: number) => ({
      pageX: clientX + window.scrollX,
      pageY: clientY + window.scrollY,
    }),
    [],
  )

  const getElementIds = useCallback((element: Element): string[] => {
    if (getItemIdsRef.current) return getItemIdsRef.current(element) ?? []
    if (getItemIdRef.current) {
      const id = getItemIdRef.current(element)
      return id ? [id] : []
    }
    return []
  }, [])

  /** 命中计算（数学 or DOM）：返回当前框选覆盖的 id 列表。 */
  const computeSelectionFromPoint = useCallback(
    (pageX: number, pageY: number): string[] => {
      const start = dragStart.current
      const container = activeContainer.current
      if (!start || !container) return []

      const minX = Math.min(start.pageX, pageX)
      const maxX = Math.max(start.pageX, pageX)
      const minY = Math.min(start.pageY, pageY)
      const maxY = Math.max(start.pageY, pageY)

      const additive = startedWithModifier.current
      // 非加选 = 替换语义：选区只包含当前框内命中项（拖离即取消，Eagle 一致）
      const newSelected = additive ? new Set(initialSelection.current) : new Set<string>()

      if (hitTestRef.current) {
        // 数学命中：零强制布局（虚拟列表布局已知）
        for (const id of hitTestRef.current({ minX, minY, maxX, maxY })) newSelected.add(id)
        return Array.from(newSelected)
      }

      // DOM 命中（默认）：querySelectorAll + 逐卡 getBoundingClientRect（rAF 节流后每帧一次）
      container.querySelectorAll<HTMLElement>(itemSelector).forEach((item) => {
        const ids = getElementIds(item)
        if (ids.length === 0) return
        const rect = item.getBoundingClientRect()
        const itemLeft = rect.left + window.scrollX
        const itemRight = rect.right + window.scrollX
        const itemTop = rect.top + window.scrollY
        const itemBottom = rect.bottom + window.scrollY
        if (minX < itemRight && maxX > itemLeft && minY < itemBottom && maxY > itemTop) {
          ids.forEach((id) => newSelected.add(id))
        }
      })
      return Array.from(newSelected)
    },
    [getElementIds, itemSelector],
  )

  /** 帧合并：记录最新指针位置，同一帧内多次 mousemove/scroll 只重算一次。 */
  const scheduleSelectionUpdate = useCallback(
    (point: { pageX: number; pageY: number }) => {
      pendingPointRef.current = point
      if (selectionFrameRef.current !== null) return
      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null
        const start = dragStart.current
        const point = pendingPointRef.current
        pendingPointRef.current = null
        if (!start || !point) return
        // 选框视觉：坐标未变（如自动滚动帧）时保持引用稳定，不触发重渲染
        setSelectionBox((current) =>
          current &&
          current.startPageX === start.pageX &&
          current.startPageY === start.pageY &&
          current.currentPageX === point.pageX &&
          current.currentPageY === point.pageY
            ? current
            : {
                startPageX: start.pageX,
                startPageY: start.pageY,
                currentPageX: point.pageX,
                currentPageY: point.pageY,
              },
        )
        const next = computeSelectionFromPoint(point.pageX, point.pageY)
        const prev = lastSelectionRef.current
        if (prev && prev.length === next.length && prev.every((id, index) => id === next[index])) return
        lastSelectionRef.current = next
        onSelectionChangeRef.current(next)
      })
    },
    [computeSelectionFromPoint],
  )

  const beginSelection = useCallback(
    (target: HTMLElement, clientX: number, clientY: number, withModifier: boolean) => {
      // 只处理本实例的容器：素材库表面与弹窗表面可能同时挂载，避免互相干扰
      const container = containerRef?.current ?? (target.closest(containerSelector) as HTMLElement | null)
      if (!container || !container.contains(target)) return

      // 清除任何已存在的文字选区（如双击提示词/参数残留的高亮），
      // 避免框选时旧的浏览器原生选中态继续干扰后续点击/复制等操作。
      if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges?.()

      const point = getPagePoint(clientX, clientY)

      startedOnItem.current = Boolean(target.closest(itemSelector))
      startedWithModifier.current = withModifier
      initialSelection.current = [...initialSelectedIdsRef.current]
      activeContainer.current = container
      scrollContainer.current = findScrollableAncestor(container)

      isDragging.current = true
      hasDragged.current = false
      dragStart.current = point
      lastClientPoint.current = { x: clientX, y: clientY }
      document.body.classList.add('select-none')
      document.body.classList.add('drag-selecting')
      // 注意：is-drag-selecting（CSS 会让项 pointer-events: none）不能在这里加——
      // 单击时若项不可命中，mouseup 会落到容器上，click 派发到容器导致单击选中失效。
      // 移到真正开始拖拽（越过 6px 阈值）时再加。
      setIsSelecting(true)
      setSelectionBox({
        startPageX: point.pageX,
        startPageY: point.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      attachDragInteractionListenersRef.current()
    },
    [containerRef, containerSelector, getPagePoint, itemSelector],
  )

  useEffect(() => {
    // 非浏览器环境（如 node 测试环境）不挂载事件监听
    if (typeof document === 'undefined' || typeof window === 'undefined') return

    let dragInteractionListenersAttached = false

    const detachDragInteractionListeners = () => {
      if (!dragInteractionListenersAttached) return
      document.removeEventListener('wheel', handleDocumentWheel, true)
      window.removeEventListener('scroll', handleDocumentScroll, true)
      window.removeEventListener('keydown', handleDocumentKeyDown, true)
      dragInteractionListenersAttached = false
    }

    const stopDragScroll = () => {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
      dragScrollDirectionRef.current = null
    }

    const startDragScroll = (direction: -1 | 1) => {
      if (dragScrollIntervalRef.current && dragScrollDirectionRef.current === direction) return
      stopDragScroll()
      dragScrollDirectionRef.current = direction
      dragScrollIntervalRef.current = window.setInterval(() => {
        const target = scrollContainer.current
        if (target instanceof HTMLElement) {
          target.scrollTop += direction * 15
        } else {
          window.scrollBy({ top: direction * 15, behavior: 'instant' })
        }
      }, 16)
    }

    const endSelection = (clearEmptySurfaceClick = false, suppressClick = false) => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
        activeContainer.current?.classList.remove('is-drag-selecting')
      }
      if (
        isDragging.current &&
        clearEmptySurfaceClick &&
        !hasDragged.current &&
        !startedOnItem.current &&
        !startedWithModifier.current
      ) {
        onSelectionChangeRef.current([])
      }
      if (suppressClick && hasDragged.current) onSuppressClickRef.current?.()
      // 丢弃未消费的帧合并状态，避免结束后残留一帧更新
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
        selectionFrameRef.current = null
      }
      pendingPointRef.current = null
      lastSelectionRef.current = null
      detachDragInteractionListeners()
      stopDragScroll()
      isDragging.current = false
      dragStart.current = null
      lastClientPoint.current = null
      activeContainer.current = null
      scrollContainer.current = null
      setIsSelecting(false)
      setSelectionBox(null)
    }

    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest(containerSelector)) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-no-marquee], [data-lightbox-root]')) return

      const closestInteractive = target.closest('button, a, input, textarea, select, [draggable="true"]')

      // If we clicked on an interactive element (like a button or draggable thumb)
      if (closestInteractive) {
        // If it's the ReferenceThumb button itself, don't start box selection, allow native drag and drop
        if (closestInteractive.closest('.reference-thumb-wrapper')) return

        // If it's a button/link inside TaskCard (like delete/reuse), don't start selection
        return
      }

      const withModifier = isMac ? e.metaKey || e.ctrlKey || e.shiftKey : e.ctrlKey || e.metaKey || e.shiftKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, withModifier)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const point = getPagePoint(e.clientX, e.clientY)
      lastClientPoint.current = { x: e.clientX, y: e.clientY }
      const distance = Math.hypot(point.pageX - start.pageX, point.pageY - start.pageY)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      // 越过拖拽阈值：此时才让项失去指针事件（hover 原图/样式不再触发、过渡禁用）
      activeContainer.current?.classList.add('is-drag-selecting')
      scheduleSelectionUpdate(point)
      e.preventDefault()

      // 按活动容器的可见边缘判定自动滚动（容器内部滚动或窗口滚动均适用）
      const container = activeContainer.current
      const scrollThreshold = 40
      if (container) {
        const rect = container.getBoundingClientRect()
        if (e.clientY < rect.top + scrollThreshold) {
          startDragScroll(-1)
        } else if (e.clientY > rect.bottom - scrollThreshold) {
          startDragScroll(1)
        } else {
          stopDragScroll()
        }
      }
    }

    const handleDocumentScroll = () => {
      if (!isDragging.current || !dragStart.current || !lastClientPoint.current || !hasDragged.current) return

      const point = getPagePoint(lastClientPoint.current.x, lastClientPoint.current.y)
      scheduleSelectionUpdate(point)
    }

    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isDragging.current) return
      // Esc 取消当前框选并恢复拖拽前的选区；阻止冒泡避免连带关闭弹窗
      e.preventDefault()
      e.stopPropagation()
      onSelectionChangeRef.current([...initialSelection.current])
      endSelection()
    }

    const handleDocumentWheel = (e: WheelEvent) => {
      if (!isDragging.current) return
      if ((e.buttons & 1) === 0) {
        endSelection()
        return
      }
      if (!hasDragged.current) return
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
    }

    const handleDocumentMouseUp = () => {
      endSelection(true, true)
    }

    const attachDragInteractionListeners = () => {
      if (dragInteractionListenersAttached) return
      document.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
      window.addEventListener('scroll', handleDocumentScroll, true)
      window.addEventListener('keydown', handleDocumentKeyDown, true)
      dragInteractionListenersAttached = true
    }

    attachDragInteractionListenersRef.current = attachDragInteractionListeners
    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    return () => {
      attachDragInteractionListenersRef.current = () => {}
      detachDragInteractionListeners()
      stopDragScroll()
      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current)
        selectionFrameRef.current = null
      }
      pendingPointRef.current = null
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
    }
  }, [beginSelection, containerSelector, getPagePoint, isMac, itemSelector, scheduleSelectionUpdate])

  return { selectionBox, isSelecting, isDragging: isDragging.current }
}
