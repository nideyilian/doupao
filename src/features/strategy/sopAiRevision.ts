export type SopAiRevisionAttachment = {
  id: string
  name: string
}

export type SopAiRevisionMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  attachments?: SopAiRevisionAttachment[]
  revision?: {
    content: string
    changeSummary: string[]
    appliedAt?: number
    /** 可变项选项提案：目标变量名（模板 {{变量名}} 逐字一致） */
    variableName?: string
    /** 可变项选项提案：AI 生成的新选项列表 */
    options?: string[]
    /** 可变项选项提案：derive=增量衍生，rewrite=按参数整体改写 */
    mode?: 'derive' | 'rewrite'
  }
}

export type SopAiRevisionThread = {
  documentId: string
  messages: SopAiRevisionMessage[]
  updatedAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type EnumerableStorageLike = StorageLike & Partial<Pick<Storage, 'key' | 'length'>>

type SopAiRevisionResult = {
  reply: string
  content: string
  changeSummary: string[]
  /** 可变项选项提案透传字段（普通修订不设置） */
  variableName?: string
  options?: string[]
  mode?: 'derive' | 'rewrite'
}

export type SopAiRevisionJobState = { status: 'idle' } | { status: 'running' } | { status: 'error'; error: string }

type SopAiRevisionJob = {
  state: SopAiRevisionJobState
  promise?: Promise<{ ok: true } | { ok: false; error: string }>
}

const STORAGE_PREFIX = 'doupao.sop-ai-revision.v1.'
const MAX_PERSISTED_MESSAGES = 30
const revisionJobs = new Map<string, SopAiRevisionJob>()
const revisionJobListeners = new Map<string, Set<(state: SopAiRevisionJobState) => void>>()
const IDLE_JOB_STATE: SopAiRevisionJobState = { status: 'idle' }

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function storageKey(documentId: string) {
  return `${STORAGE_PREFIX}${documentId}`
}

function isRevisionMessage(value: unknown): value is SopAiRevisionMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<SopAiRevisionMessage>
  if (typeof message.id !== 'string' || (message.role !== 'user' && message.role !== 'assistant')) return false
  if (typeof message.text !== 'string' || typeof message.createdAt !== 'number') return false
  if (
    message.attachments !== undefined &&
    (!Array.isArray(message.attachments) ||
      !message.attachments.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as SopAiRevisionAttachment).id === 'string' &&
          typeof (item as SopAiRevisionAttachment).name === 'string',
      ))
  ) {
    return false
  }
  if (!message.revision) return true
  return (
    typeof message.revision.content === 'string' &&
    Array.isArray(message.revision.changeSummary) &&
    message.revision.changeSummary.every((item) => typeof item === 'string')
  )
}

export function loadSopAiRevisionThread(
  documentId: string,
  storage: StorageLike | null = getStorage(),
): SopAiRevisionThread {
  const emptyThread = { documentId, messages: [], updatedAt: 0 }
  if (!storage) return emptyThread
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(documentId)) ?? 'null') as Partial<SopAiRevisionThread> | null
    if (!parsed || parsed.documentId !== documentId || !Array.isArray(parsed.messages)) return emptyThread
    return {
      documentId,
      messages: parsed.messages.filter(isRevisionMessage).slice(-MAX_PERSISTED_MESSAGES),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return emptyThread
  }
}

export function saveSopAiRevisionThread(
  documentId: string,
  messages: SopAiRevisionMessage[],
  storage: StorageLike | null = getStorage(),
) {
  if (!storage) return
  const thread: SopAiRevisionThread = {
    documentId,
    messages: messages.slice(-MAX_PERSISTED_MESSAGES),
    updatedAt: Date.now(),
  }
  try {
    storage.setItem(storageKey(documentId), JSON.stringify(thread))
  } catch {
    // The editor remains usable when private browsing or storage quotas block persistence.
  }
}

export function clearSopAiRevisionThread(documentId: string, storage: StorageLike | null = getStorage()) {
  try {
    storage?.removeItem(storageKey(documentId))
  } catch {
    // Treat unavailable preference storage as an already-cleared thread.
  }
}

export function getSopAiRevisionAttachmentReferences(
  storage: EnumerableStorageLike | null = getStorage(),
): Array<{ documentId: string; imageId: string }> {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return []
  const references: Array<{ documentId: string; imageId: string }> = []
  const seen = new Set<string>()
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX)) continue
    const documentId = key.slice(STORAGE_PREFIX.length)
    for (const message of loadSopAiRevisionThread(documentId, storage).messages) {
      for (const attachment of message.attachments ?? []) {
        const referenceKey = `${documentId}:${attachment.id}`
        if (seen.has(referenceKey)) continue
        seen.add(referenceKey)
        references.push({ documentId, imageId: attachment.id })
      }
    }
  }
  return references
}

export function removeSopAiRevisionAttachments(
  imageIds: ReadonlySet<string>,
  storage: EnumerableStorageLike | null = getStorage(),
): number {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function' || imageIds.size === 0)
    return 0
  const documentIds: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(STORAGE_PREFIX)) documentIds.push(key.slice(STORAGE_PREFIX.length))
  }

  let changedThreads = 0
  for (const documentId of documentIds) {
    const thread = loadSopAiRevisionThread(documentId, storage)
    let changed = false
    const messages = thread.messages.map((message) => {
      const attachments = message.attachments?.filter((attachment) => !imageIds.has(attachment.id))
      if (attachments?.length === message.attachments?.length) return message
      changed = true
      return { ...message, attachments: attachments?.length ? attachments : undefined }
    })
    if (!changed) continue
    saveSopAiRevisionThread(documentId, messages, storage)
    changedThreads++
  }
  return changedThreads
}

export function createSopAiRevisionMessage(
  role: SopAiRevisionMessage['role'],
  text: string,
  revision?: SopAiRevisionMessage['revision'],
  attachments?: SopAiRevisionAttachment[],
): SopAiRevisionMessage {
  return {
    id: `sop-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: Date.now(),
    ...(attachments?.length ? { attachments } : {}),
    revision,
  }
}

export function getSopAiRevisionJobState(documentId: string): SopAiRevisionJobState {
  return revisionJobs.get(documentId)?.state ?? IDLE_JOB_STATE
}

function notifySopAiRevisionJob(documentId: string) {
  const state = getSopAiRevisionJobState(documentId)
  revisionJobListeners.get(documentId)?.forEach((listener) => listener(state))
}

export function subscribeSopAiRevisionJob(documentId: string, listener: (state: SopAiRevisionJobState) => void) {
  const listeners = revisionJobListeners.get(documentId) ?? new Set()
  listeners.add(listener)
  revisionJobListeners.set(documentId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) revisionJobListeners.delete(documentId)
  }
}

export function clearSopAiRevisionJob(documentId: string) {
  if (revisionJobs.get(documentId)?.state.status === 'running') return
  revisionJobs.delete(documentId)
  notifySopAiRevisionJob(documentId)
}

export function startSopAiRevisionJob(
  documentId: string,
  run: () => Promise<SopAiRevisionResult>,
  storage: StorageLike | null = getStorage(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const activeJob = revisionJobs.get(documentId)
  if (activeJob?.state.status === 'running' && activeJob.promise) return activeJob.promise

  const job: SopAiRevisionJob = { state: { status: 'running' } }
  const promise = run()
    .then((result) => {
      const thread = loadSopAiRevisionThread(documentId, storage)
      const assistantMessage = createSopAiRevisionMessage('assistant', result.reply, {
        content: result.content,
        changeSummary: result.changeSummary,
        ...(result.variableName ? { variableName: result.variableName } : {}),
        ...(result.options ? { options: result.options } : {}),
        ...(result.mode ? { mode: result.mode } : {}),
      })
      saveSopAiRevisionThread(documentId, [...thread.messages, assistantMessage], storage)
      revisionJobs.delete(documentId)
      notifySopAiRevisionJob(documentId)
      return { ok: true } as const
    })
    .catch((cause) => {
      const error = cause instanceof Error ? cause.message : 'AI 对话优化失败'
      revisionJobs.set(documentId, { state: { status: 'error', error } })
      notifySopAiRevisionJob(documentId)
      return { ok: false, error } as const
    })

  job.promise = promise
  revisionJobs.set(documentId, job)
  notifySopAiRevisionJob(documentId)
  return promise
}
