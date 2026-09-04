export type JsonTextStorageAdapter = {
  read(): Promise<string | null>
  write(content: string, options: { skipBackup: boolean }): Promise<boolean>
}

type PendingWrite = {
  content: string
  skipBackup: boolean
  waiters: Array<() => void>
}

export type CoalescedJsonStorage = {
  getItem(name: string): Promise<string | null>
  setItem(name: string, value: string): Promise<void>
  removeItem(name: string): Promise<void>
  flush(): Promise<void>
}

export function createCoalescedJsonStorage(
  adapter: JsonTextStorageAdapter,
  options: {
    debounceMs?: number
    retryMs?: number
    onWriteError?: (error: unknown) => void
  } = {},
): CoalescedJsonStorage {
  const debounceMs = options.debounceMs ?? 400
  const retryMs = options.retryMs ?? 1500
  let lastWrittenContent: string | undefined
  let pending: PendingWrite | null = null
  let writing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> | null = null

  const scheduleFlush = (delay = debounceMs) => {
    if (timer || writing || !pending) return
    timer = setTimeout(() => {
      timer = null
      void flushPending().catch(() => {
        scheduleFlush(retryMs)
      })
    }, delay)
  }

  const enqueue = (content: string, skipBackup: boolean) =>
    new Promise<void>((resolve) => {
      if (!pending && !writing && content === lastWrittenContent) {
        resolve()
        return
      }

      if (pending?.content === content && pending.skipBackup === skipBackup) {
        pending.waiters.push(resolve)
      } else if (pending) {
        pending = {
          content,
          skipBackup,
          waiters: [...pending.waiters, resolve],
        }
      } else {
        pending = { content, skipBackup, waiters: [resolve] }
      }

      scheduleFlush()
    })

  const flushPending = async (): Promise<void> => {
    if (flushing) return flushing
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    let failed = false
    flushing = (async () => {
      while (pending) {
        const next = pending
        pending = null
        writing = true
        try {
          const written = await adapter.write(next.content, { skipBackup: next.skipBackup })
          if (!written) throw new Error('持久化写入失败')
          lastWrittenContent = next.content
          next.waiters.forEach((resolve) => resolve())
        } catch (error) {
          const newerPending = pending as PendingWrite | null
          pending = newerPending
            ? {
                ...newerPending,
                waiters: [...next.waiters, ...newerPending.waiters],
              }
            : next
          options.onWriteError?.(error)
          failed = true
          throw error
        } finally {
          writing = false
        }
      }
    })()

    try {
      await flushing
    } finally {
      flushing = null
      scheduleFlush(failed ? retryMs : debounceMs)
    }
  }

  return {
    getItem: () => adapter.read(),
    setItem: (_name, value) => enqueue(value, false),
    removeItem: () => enqueue('', true),
    flush: flushPending,
  }
}
