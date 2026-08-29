import { describe, expect, it } from 'vitest'
import { getTaskGridColumnCount, getTaskGridVirtualWindow } from './taskGridVirtualWindow'

describe('task grid virtual window', () => {
  it('keeps only visible rows plus overscan', () => {
    expect(
      getTaskGridVirtualWindow({
        itemCount: 10_000,
        columns: 3,
        rowHeight: 176,
        scrollTop: 17_600,
        viewportHeight: 800,
        overscanRows: 3,
      }),
    ).toEqual({
      start: 291,
      end: 324,
      offsetTop: 17_072,
      totalHeight: 586_784,
    })
  })

  it('clamps the first and final windows', () => {
    expect(
      getTaskGridVirtualWindow({
        itemCount: 5,
        columns: 3,
        rowHeight: 176,
        scrollTop: 10_000,
        viewportHeight: 800,
        overscanRows: 3,
      }),
    ).toEqual({
      start: 0,
      end: 5,
      offsetTop: 0,
      totalHeight: 352,
    })
  })

  it('matches the responsive grid breakpoints', () => {
    expect(getTaskGridColumnCount(639)).toBe(1)
    expect(getTaskGridColumnCount(640)).toBe(2)
    expect(getTaskGridColumnCount(1_023)).toBe(2)
    expect(getTaskGridColumnCount(1_024)).toBe(3)
  })
})
