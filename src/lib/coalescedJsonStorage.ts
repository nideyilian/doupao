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

export function createCoalescedJsonStorage(adapter: JsonTextStorageAdapter, debounceMs = 400): CoalescedJsonStorage {
  let lastWrittenContent: string | undefined
  let pending: PendingWrite | null = null
  let writing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> | null = null

  const scheduleFlush = () => {
    if (timer || writing || !pending) return
    timer = setTimeout(() => {
      timer = null
      void flushPending()
    }, debounceMs)
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

    flushing = (async () => {
      while (pending) {
        const next = pending
        pending = null
        writing = true
        try {
          if (await adapter.write(next.content, { skipBackup: next.skipBackup })) {
            lastWrittenContent = next.content
          }
        } catch {
          // Persist is best-effort here, matching the previous fire-and-forget behavior.
        } finally {
          writing = false
          next.waiters.forEach((resolve) => resolve())
        }
      }
    })()

    try {
      await flushing
    } finally {
      flushing = null
      scheduleFlush()
    }
  }

  return {
    getItem: () => adapter.read(),
    setItem: (_name, value) => enqueue(value, false),
    removeItem: () => enqueue('', true),
    flush: flushPending,
  }
}
