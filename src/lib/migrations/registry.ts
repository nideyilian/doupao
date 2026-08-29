export type MigrationStatus = 'running' | 'completed' | 'failed'

export type MigrationJournal = {
  id: string
  status: MigrationStatus
  cursor?: string
  sourceBackup?: string
  error?: string
  updatedAt: number
}

export type MigrationJournalStore = {
  get: (id: string) => Promise<MigrationJournal | undefined>
  put: (record: MigrationJournal) => Promise<void>
}

export type MigrationContext = {
  cursor?: string
  checkpoint: (cursor: string) => Promise<void>
}

export async function runMigration(
  id: string,
  store: MigrationJournalStore,
  migrate: (context: MigrationContext) => Promise<void>,
  now = Date.now(),
): Promise<void> {
  const existing = await store.get(id)
  if (existing?.status === 'completed') return

  let current: MigrationJournal = {
    id,
    status: 'running',
    ...(existing?.cursor ? { cursor: existing.cursor } : {}),
    ...(existing?.sourceBackup ? { sourceBackup: existing.sourceBackup } : {}),
    updatedAt: now,
  }
  await store.put(current)

  try {
    await migrate({
      cursor: current.cursor,
      checkpoint: async (cursor) => {
        current = { ...current, status: 'running', cursor, updatedAt: now }
        await store.put(current)
      },
    })
    await store.put({ ...current, status: 'completed', error: undefined, updatedAt: now })
  } catch (error) {
    await store.put({
      ...current,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: now,
    })
    throw error
  }
}
