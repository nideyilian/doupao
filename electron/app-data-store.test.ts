import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDataStore } from './app-data-store'

describe('AppDataStore', () => {
  let db: DatabaseSync
  let store: AppDataStore

  afterEach(() => {
    db.close()
  })

  it('stores and replaces JSON records in a namespace', () => {
    db = new DatabaseSync(':memory:')
    store = new AppDataStore(db)

    store.put('tasks', { id: 'task-1', value: { id: 'task-1', status: 'running' } })
    expect(store.get('tasks', 'task-1')).toEqual({ id: 'task-1', status: 'running' })

    store.replace('tasks', [{ id: 'task-2', value: { id: 'task-2', status: 'done' } }])
    expect(store.getAll('tasks')).toEqual([{ id: 'task-2', status: 'done' }])
    expect(store.count('tasks')).toBe(1)
  })

  it('commits imported images, thumbnails and tasks together', () => {
    db = new DatabaseSync(':memory:')
    store = new AppDataStore(db)

    store.commitImportedRecords({
      images: [{ id: 'image-1', localPath: 'cache-images/image-1.png' }],
      thumbnails: [{ id: 'image-1', thumbnailVersion: 5 }],
      tasks: [{ id: 'task-1', outputImages: ['image-1'] }],
    })

    expect(store.get('images', 'image-1')).toMatchObject({ localPath: 'cache-images/image-1.png' })
    expect(store.get('thumbnails', 'image-1')).toMatchObject({ thumbnailVersion: 5 })
    expect(store.get('tasks', 'task-1')).toMatchObject({ outputImages: ['image-1'] })
  })

  it('rolls back a multi-store import when one record cannot be serialized', () => {
    db = new DatabaseSync(':memory:')
    store = new AppDataStore(db)

    expect(() =>
      store.commitImportedRecords({
        images: [{ id: 'image-1', localPath: 'cache-images/image-1.png' }],
        thumbnails: [],
        tasks: [{ id: 'task-1', invalid: BigInt(1) }],
      }),
    ).toThrow()

    expect(store.count('images')).toBe(0)
    expect(store.count('tasks')).toBe(0)
  })

  it('updates image paths in one transaction', () => {
    db = new DatabaseSync(':memory:')
    store = new AppDataStore(db)
    store.putMany('images', [
      { id: 'image-1', value: { id: 'image-1', localPath: 'old/image-1.png' } },
      { id: 'image-2', value: { id: 'image-2', localPath: 'other/image-2.png' } },
    ])

    store.updateImageLocalPaths([{ from: 'old/image-1.png', to: 'new/image-1.png' }])

    expect(store.get('images', 'image-1')).toMatchObject({ localPath: 'new/image-1.png' })
    expect(store.get('images', 'image-2')).toMatchObject({ localPath: 'other/image-2.png' })
  })
})
