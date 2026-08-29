/**
 * 外观运行时：统一负责「应用皮肤 + 明暗模式」「首屏快照持久化」「兼容迁移」。
 *
 * - applyAppearance：唯一允许写 document.documentElement 外观状态的入口。
 * - read/writeAppearanceSnapshot：轻量 localStorage 快照，保证首屏无闪烁
 *   （Electron 的正式设置为异步文件存储，Zustand 恢复后会再校准一次）。
 * - bootstrapAppearance：在 React 渲染前同步调用。
 */

import { DEFAULT_SKIN_ID, normalizeSkinId, type SkinId } from './registry'

export type ThemeMode = 'light' | 'dark'

export interface AppearanceState {
  skinId: SkinId
  themeMode: ThemeMode
}

export const APPEARANCE_SNAPSHOT_KEY = 'doupao-appearance-v1'
export const APPEARANCE_SNAPSHOT_VERSION = 1

export const THEME_TRANSITION_CLASS = 'theme-transitioning'
export const THEME_TRANSITION_DURATION_MS = 220

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

interface ApplyAppearanceOptions {
  /** 切换时附加过渡动画类 */
  transition?: boolean
  schedule?: (callback: () => void, delay: number) => void
}

/**
 * 将皮肤与明暗模式应用到根节点。
 * 只操作 data-skin、dark class 与 style.colorScheme，不涉及布局。
 */
export function applyAppearance(
  state: AppearanceState,
  root: HTMLElement = document.documentElement,
  options: ApplyAppearanceOptions = {},
) {
  if (options.transition) {
    root.classList.add(THEME_TRANSITION_CLASS)
    const schedule = options.schedule ?? ((callback: () => void, delay: number) => window.setTimeout(callback, delay))
    schedule(() => root.classList.remove(THEME_TRANSITION_CLASS), THEME_TRANSITION_DURATION_MS)
  }
  root.setAttribute('data-skin', state.skinId)
  root.classList.toggle('dark', state.themeMode === 'dark')
  root.style.colorScheme = state.themeMode
}

/** 兼容旧接口：仅应用明暗模式 */
export function applyThemeMode(
  themeMode: ThemeMode,
  root: HTMLElement = document.documentElement,
  options: ApplyAppearanceOptions = {},
) {
  if (options.transition) {
    root.classList.add(THEME_TRANSITION_CLASS)
    const schedule = options.schedule ?? ((callback: () => void, delay: number) => window.setTimeout(callback, delay))
    schedule(() => root.classList.remove(THEME_TRANSITION_CLASS), THEME_TRANSITION_DURATION_MS)
  }
  root.classList.toggle('dark', themeMode === 'dark')
  root.style.colorScheme = themeMode
}

type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): SnapshotStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 读取外观快照；损坏 JSON、版本不支持、非法字段一律返回 null（由调用方回退默认） */
export function readAppearanceSnapshot(storage: SnapshotStorage | null = defaultStorage()): AppearanceState | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(APPEARANCE_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (record.version !== APPEARANCE_SNAPSHOT_VERSION) return null
    return {
      skinId: normalizeSkinId(record.skinId),
      themeMode: normalizeThemeMode(record.themeMode),
    }
  } catch {
    return null
  }
}

export function writeAppearanceSnapshot(state: AppearanceState, storage: SnapshotStorage | null = defaultStorage()) {
  if (!storage) return
  try {
    storage.setItem(
      APPEARANCE_SNAPSHOT_KEY,
      JSON.stringify({
        version: APPEARANCE_SNAPSHOT_VERSION,
        skinId: normalizeSkinId(state.skinId),
        themeMode: normalizeThemeMode(state.themeMode),
      }),
    )
  } catch {
    // localStorage 不可用（隐私模式等）时静默失败，不影响运行
  }
}

/**
 * 首屏引导：在 React 渲染之前同步应用上次外观，消除“默认皮肤闪一下”。
 * Zustand 正式设置恢复后，App 会再次 applyAppearance 校准并重写快照。
 */
export function bootstrapAppearance(root: HTMLElement = document.documentElement) {
  const snapshot = readAppearanceSnapshot()
  applyAppearance(snapshot ?? { skinId: DEFAULT_SKIN_ID, themeMode: 'light' }, root)
}
