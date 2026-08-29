import { describe, expect, it } from 'vitest'
import { formatUpdateReleaseNotes } from './updateReleaseNotes'

describe('formatUpdateReleaseNotes', () => {
  it('keeps plain release notes text', () => {
    expect(formatUpdateReleaseNotes('新增功能\n修复问题')).toBe('新增功能\n修复问题')
  })

  it('combines release note arrays from electron-updater', () => {
    expect(
      formatUpdateReleaseNotes([
        { version: '0.6.14', note: '支持更新内容弹窗' },
        { version: '0.6.13', note: '优化标签页' },
      ]),
    ).toBe('v0.6.14\n支持更新内容弹窗\n\nv0.6.13\n优化标签页')
  })

  it('uses a fallback when release notes are empty', () => {
    expect(formatUpdateReleaseNotes(undefined)).toBe('本次更新未提供详细更新说明。')
  })
})
