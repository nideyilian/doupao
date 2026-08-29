import { useState, useEffect, useCallback } from 'react'

type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes?: unknown }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; version: string; releaseNotes?: unknown }
  | { status: 'error'; message: string }

type AutoUpdateHook = {
  status: string
  version?: string
  progress?: number
  message?: string
  releaseNotes?: unknown
  check: () => void
  download: () => void
  install: () => void
  reset: () => void
}

export { type UpdateStatus }

export function useAutoUpdate(): AutoUpdateHook {
  const [state, setState] = useState<UpdateStatus>({ status: 'idle' })

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateStatus) return

    let resetTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = api.onUpdateStatus((payload: UpdateStatus) => {
      setState(payload)

      if (payload.status === 'not-available' || payload.status === 'error') {
        if (resetTimer) clearTimeout(resetTimer)
        resetTimer = setTimeout(() => {
          setState({ status: 'idle' })
        }, 3000)
      }
    })

    return () => {
      if (resetTimer) clearTimeout(resetTimer)
      unsubscribe()
    }
  }, [])

  const check = useCallback(() => {
    window.electronAPI?.checkForUpdate?.()
  }, [])

  const download = useCallback(() => {
    window.electronAPI?.downloadUpdate?.()
  }, [])

  const install = useCallback(() => {
    window.electronAPI?.installUpdate?.()
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  return {
    status: state.status,
    version: 'version' in state ? state.version : undefined,
    progress: 'progress' in state ? state.progress : undefined,
    message: 'message' in state ? state.message : undefined,
    releaseNotes: 'releaseNotes' in state ? state.releaseNotes : undefined,
    check,
    download,
    install,
    reset,
  }
}
