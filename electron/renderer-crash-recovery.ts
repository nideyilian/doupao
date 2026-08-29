const CRASH_WINDOW_MS = 60_000

export type RendererRecoveryDecision =
  | { reload: true; safeMode: boolean }
  // 崩溃过于频繁：停止自动 reload，避免无限重启循环（由主进程展示错误提示）
  | { reload: false }

export function decideRendererRecovery(crashTimestamps: number[], now: number): RendererRecoveryDecision {
  const recentCrashCount = crashTimestamps.filter((timestamp) => now - timestamp <= CRASH_WINDOW_MS).length

  // 60s 窗口内 ≥3 次崩溃：不再自动 reload（退避上限），safeMode 也不再自动重启
  if (recentCrashCount >= 3) return { reload: false }

  return {
    reload: true,
    safeMode: recentCrashCount >= 2,
  }
}
