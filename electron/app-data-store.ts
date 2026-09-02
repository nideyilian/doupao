import type { DatabaseSync } from 'node:sqlite'

export interface AppDataRecord {
  id: string
  value: unknown
}

export type AppDataStoreMap = Record<string, unknown[]>

type StoredRow = {
  record_id: string
  json: string
}

const APP_DATA_TABLE = 'app_data_records'

export class AppDataStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${APP_DATA_TABLE} (
        namespace TEXT NOT NULL,
        record_id TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, record_id)
      );
      CREATE INDEX IF NOT EXISTS app_data_records_namespace_updated
        ON ${APP_DATA_TABLE}(namespace, updated_at, record_id);
    `)
  }

  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT json FROM ${APP_DATA_TABLE} WHERE namespace = ? AND record_id = ?`)
      .get(namespace, id) as { json?: string } | undefined
    return row?.json === undefined ? undefined : (JSON.parse(row.json) as T)
  }

  getAll<T>(namespace: string): T[] {
    const rows = this.db
      .prepare(`SELECT json FROM ${APP_DATA_TABLE} WHERE namespace = ? ORDER BY rowid ASC`)
      .all(namespace) as Array<{ json: string }>
    return rows.map((row) => JSON.parse(row.json) as T)
  }

  getMany<T>(namespace: string, ids: string[]): Map<string, T> {
    const result = new Map<string, T>()
    if (ids.length === 0) return result
    const get = this.db.prepare(`SELECT json FROM ${APP_DATA_TABLE} WHERE namespace = ? AND record_id = ?`)
    for (const id of [...new Set(ids)]) {
      const row = get.get(namespace, id) as { json?: string } | undefined
      if (row?.json !== undefined) result.set(id, JSON.parse(row.json) as T)
    }
    return result
  }

  put(namespace: string, record: AppDataRecord): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.putWithinTransaction(namespace, record)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  putMany(namespace: string, records: AppDataRecord[]): void {
    if (records.length === 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) this.putWithinTransaction(namespace, record)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  putManyInTransaction(namespace: string, records: AppDataRecord[]): void {
    for (const record of records) this.putWithinTransaction(namespace, record)
  }

  replace(namespace: string, records: AppDataRecord[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ?`).run(namespace)
      for (const record of records) this.putWithinTransaction(namespace, record)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  delete(namespace: string, id: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ? AND record_id = ?`).run(namespace, id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  deleteMany(namespace: string, ids: string[]): void {
    if (ids.length === 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ? AND record_id = ?`)
      for (const id of [...new Set(ids)]) statement.run(namespace, id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  deleteImageRecords(ids: string[]): void {
    if (ids.length === 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ? AND record_id = ?`)
      for (const id of [...new Set(ids)]) {
        statement.run('images', id)
        statement.run('thumbnails', id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  clearImageRecords(): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace IN (?, ?)`).run('images', 'thumbnails')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  clear(namespace: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ?`).run(namespace)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  count(namespace: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${APP_DATA_TABLE} WHERE namespace = ?`)
      .get(namespace) as { count?: number } | undefined
    return Number(row?.count ?? 0)
  }

  counts(namespaces: string[]): Record<string, number> {
    const result: Record<string, number> = {}
    for (const namespace of namespaces) result[namespace] = this.count(namespace)
    return result
  }

  importStores(stores: AppDataStoreMap): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const [namespace, values] of Object.entries(stores)) {
        for (const value of values) {
          const id = recordId(value)
          if (id) this.putWithinTransaction(namespace, { id, value })
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  commitImportedRecords(records: {
    images: unknown[]
    thumbnails: unknown[]
    tasks: unknown[]
    replaceTasks?: boolean
  }): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (records.replaceTasks) this.db.prepare(`DELETE FROM ${APP_DATA_TABLE} WHERE namespace = ?`).run('tasks')
      this.putValuesWithinTransaction('images', records.images)
      this.putValuesWithinTransaction('thumbnails', records.thumbnails)
      this.putValuesWithinTransaction('tasks', records.tasks)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  updateImageLocalPaths(mappings: Array<{ from: string; to: string }>): void {
    if (mappings.length === 0) return
    const bySource = new Map(mappings.map((mapping) => [mapping.from, mapping.to]))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.rowsWithinTransaction('images')
      for (const row of rows) {
        const image = JSON.parse(row.json) as { localPath?: unknown }
        const nextPath = typeof image.localPath === 'string' ? bySource.get(image.localPath) : undefined
        if (nextPath) {
          this.putWithinTransaction('images', {
            id: row.record_id,
            value: { ...image, localPath: nextPath },
          })
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private putValuesWithinTransaction(namespace: string, values: unknown[]): void {
    for (const value of values) {
      const id = recordId(value)
      if (id) this.putWithinTransaction(namespace, { id, value })
    }
  }

  private putWithinTransaction(namespace: string, record: AppDataRecord): void {
    const json = JSON.stringify(record.value)
    if (json === undefined) throw new Error(`无法序列化应用记录：${namespace}/${record.id}`)
    this.db
      .prepare(
        `INSERT INTO ${APP_DATA_TABLE}(namespace, record_id, json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, record_id)
         DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(namespace, record.id, json, Date.now())
  }

  private rowsWithinTransaction(namespace: string): StoredRow[] {
    return this.db
      .prepare(`SELECT record_id, json FROM ${APP_DATA_TABLE} WHERE namespace = ? ORDER BY rowid ASC`)
      .all(namespace) as StoredRow[]
  }
}

function recordId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}
