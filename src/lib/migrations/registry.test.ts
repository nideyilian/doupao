import { describe, expect, it } from 'vitest'
import { runMigration, type MigrationJournal, type MigrationJournalStore } from './registry'

function memoryStore(): MigrationJournalStore {
  const records = new Map<string, MigrationJournal>()
  return {
    get: async (id) => records.get(id),
    put: async (record) => {
      records.set(record.id, record)
    },
  }
}

describe('runMigration', () => {
  it('records failure and resumes from the last checkpoint', async () => {
    const store = memoryStore()
    let firstRun = true
    const seenCursors: Array<string | undefined> = []
    const migration = async (context: { cursor?: string; checkpoint: (cursor: string) => Promise<void> }) => {
      seenCursors.push(context.cursor)
      if (firstRun) {
        firstRun = false
        await context.checkpoint('2')
        throw new Error('interrupted')
      }
      expect(context.cursor).toBe('2')
      await context.checkpoint('4')
    }

    await expect(runMigration('images-v1-to-v2', store, migration, 100)).rejects.toThrow('interrupted')
    await expect(runMigration('images-v1-to-v2', store, migration, 200)).resolves.toBeUndefined()

    expect(seenCursors).toEqual([undefined, '2'])
    expect(await store.get('images-v1-to-v2')).toEqual({
      id: 'images-v1-to-v2',
      status: 'completed',
      cursor: '4',
      updatedAt: 200,
    })
  })

  it('does not rerun a completed migration', async () => {
    const store = memoryStore()
    const migration = async () => {}
    await runMigration('done', store, migration, 100)
    await runMigration('done', store, migration, 200)

    expect(await store.get('done')).toMatchObject({ status: 'completed', updatedAt: 100 })
  })
})
