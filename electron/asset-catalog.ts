import { DatabaseSync } from 'node:sqlite'
import type {
  AssetBlob,
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  AssetVersion,
  GeneratedAsset,
} from '../src/types'
import { materializeAssetRecords } from '../src/lib/assetIdentity'
import { createTextVector, rankAssetCandidates } from '../src/lib/assetSemanticSearch'

export interface AssetCatalogUpsert {
  asset: GeneratedAsset
  localPath?: string
  textVector?: number[]
  perceptualHash?: string
}

export interface CatalogAssetDetails {
  asset: GeneratedAsset
  blob: AssetBlob
  version: AssetVersion
}

type QueryRow = { json: string; sort_value: number; id: string }

const EMPTY_COUNTS: AssetCatalogCursorPage['counts'] = {
  all: 0,
  recent: 0,
  favorites: 0,
  unorganized: 0,
  trash: 0,
  byCollection: {},
  byTag: {},
}

export function assetSearchText(asset: GeneratedAsset): string {
  const values: string[] = []
  for (const origin of asset.origins) {
    values.push(
      origin.prompt,
      origin.revisedPrompt ?? '',
      origin.apiModel ?? '',
      origin.apiProfileName ?? '',
      origin.filenameLabel ?? '',
      origin.generatedFileNameBase ?? '',
      origin.workspaceTabName ?? '',
    )
  }
  if (asset.notes) values.push(asset.notes)
  return values.filter(Boolean).join(' ')
}

function semanticBuckets(vector: readonly number[]): string[] {
  return vector
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 12)
    .map((item) => `${item.index}:${item.value >= 0 ? 1 : -1}`)
}

function encodeCursor(value: { value: number; id: string }): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(value: string | null | undefined): { value: number; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { value?: unknown; id?: unknown }
    if (typeof parsed.value === 'number' && Number.isFinite(parsed.value) && typeof parsed.id === 'string') {
      return { value: parsed.value, id: parsed.id }
    }
  } catch {}
  return null
}

function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ')
}

export class AssetCatalog {
  private readonly db: DatabaseSync
  /** getCounts 结果缓存（5s TTL）：避免每次 query/recommend 都做全表 SUM + json_each 分组 */
  private countsCache: { at: number; value: AssetCatalogCursorPage['counts'] } | null = null

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;')
    this.migrate()
  }

  private invalidateCountsCache() {
    this.countsCache = null
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blobs (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL UNIQUE,
        mime_type TEXT,
        byte_size INTEGER,
        file_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        current_version_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        trashed_at INTEGER,
        favorite INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        area INTEGER NOT NULL DEFAULT 0,
        collection_ids TEXT NOT NULL,
        tag_ids TEXT NOT NULL,
        origins TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_status_updated ON assets(status, updated_at DESC, id);
      CREATE INDEX IF NOT EXISTS assets_created ON assets(created_at DESC, id);
      CREATE INDEX IF NOT EXISTS assets_favorite ON assets(favorite, updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        blob_id TEXT NOT NULL REFERENCES blobs(id),
        version_number INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_asset ON versions(asset_id, version_number DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_fts USING fts5(asset_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS asset_machine_index (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        text_vector TEXT,
        perceptual_hash TEXT,
        model_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        usage_score REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS asset_semantic_buckets (
        bucket TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY (bucket, asset_id)
      );
      CREATE INDEX IF NOT EXISTS semantic_bucket_assets ON asset_semantic_buckets(bucket, asset_id);
      CREATE TABLE IF NOT EXISTS asset_usage_events (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_asset_time ON asset_usage_events(asset_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS collections_parent ON collections(parent_id, sort_order);
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tombstones (
        id TEXT PRIMARY KEY,
        image_id TEXT NOT NULL,
        purged_at INTEGER NOT NULL,
        last_origin_occurred_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tombstones_image ON tombstones(image_id);
      CREATE TABLE IF NOT EXISTS catalog_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.ensureTagTreeColumns()
    this.ensureCollectionExtraColumns()
  }

  /** 旧库升级：为 collections 表补齐颜色 / 置顶 / 软删除列。 */
  private ensureCollectionExtraColumns() {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>).map((row) => row.name),
    )
    if (!columns.has('color')) this.db.exec('ALTER TABLE collections ADD COLUMN color TEXT')
    if (!columns.has('pinned')) this.db.exec('ALTER TABLE collections ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('trashed_at')) this.db.exec('ALTER TABLE collections ADD COLUMN trashed_at INTEGER')
  }

  /** 旧库升级：为 tags 表补齐树形列（parent_id / sort_order）。 */
  private ensureTagTreeColumns() {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(tags)').all() as Array<{ name: string }>).map((row) => row.name),
    )
    if (!columns.has('parent_id')) {
      this.db.exec('ALTER TABLE tags ADD COLUMN parent_id TEXT')
    }
    if (!columns.has('sort_order')) {
      this.db.exec('ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS tags_parent ON tags(parent_id, sort_order, normalized_name)')
  }

  upsertAssets(records: AssetCatalogUpsert[]): void {
    if (records.length === 0) return
    const putBlob = this.db.prepare(`INSERT INTO blobs(id, content_hash, mime_type, byte_size, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET mime_type=excluded.mime_type, byte_size=excluded.byte_size,
        file_path=COALESCE(excluded.file_path, blobs.file_path)`)
    const putAsset = this.db.prepare(`INSERT INTO assets(
        id, current_version_id, status, created_at, updated_at, trashed_at, favorite, rating,
        width, height, area, collection_ids, tag_ids, origins, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET current_version_id=excluded.current_version_id, status=excluded.status,
        created_at=excluded.created_at, updated_at=excluded.updated_at, trashed_at=excluded.trashed_at,
        favorite=excluded.favorite, rating=excluded.rating, width=excluded.width, height=excluded.height,
        area=excluded.area, collection_ids=excluded.collection_ids, tag_ids=excluded.tag_ids,
        origins=excluded.origins, json=excluded.json`)
    const putVersion = this.db.prepare(`INSERT INTO versions(
        id, asset_id, blob_id, version_number, kind, created_at, width, height, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET blob_id=excluded.blob_id, kind=excluded.kind,
        width=excluded.width, height=excluded.height, json=excluded.json`)
    const deleteFts = this.db.prepare('DELETE FROM asset_fts WHERE asset_id = ?')
    const putFts = this.db.prepare('INSERT INTO asset_fts(asset_id, text) VALUES (?, ?)')
    const putIndex = this.db.prepare(`INSERT INTO asset_machine_index(
        asset_id, text_vector, perceptual_hash, model_id, model_version, generated_at, usage_score
      ) VALUES (?, ?, ?, 'doupao-multilingual-hash', '1', ?, COALESCE((SELECT usage_score FROM asset_machine_index WHERE asset_id = ?), 0))
      ON CONFLICT(asset_id) DO UPDATE SET text_vector=excluded.text_vector,
        perceptual_hash=COALESCE(excluded.perceptual_hash, asset_machine_index.perceptual_hash),
        model_id=excluded.model_id, model_version=excluded.model_version, generated_at=excluded.generated_at`)
    const deleteBuckets = this.db.prepare('DELETE FROM asset_semantic_buckets WHERE asset_id = ?')
    const putBucket = this.db.prepare('INSERT OR IGNORE INTO asset_semantic_buckets(bucket, asset_id) VALUES (?, ?)')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        const { asset, blob, version } = materializeAssetRecords(record.asset, {
          localPath: record.localPath,
          createdAt: record.asset.createdAt,
        })
        const searchText = assetSearchText(asset)
        const vector = record.textVector ?? createTextVector(searchText)
        putBlob.run(
          blob.id,
          blob.contentHash,
          blob.mimeType ?? null,
          blob.byteSize ?? null,
          blob.localPath ?? null,
          blob.createdAt,
        )
        putAsset.run(
          asset.id,
          version.id,
          asset.status,
          asset.createdAt,
          asset.updatedAt,
          asset.trashedAt,
          asset.favorite ? 1 : 0,
          asset.rating,
          asset.width ?? null,
          asset.height ?? null,
          (asset.width ?? 0) * (asset.height ?? 0),
          JSON.stringify(asset.collectionIds),
          JSON.stringify(asset.tagIds),
          JSON.stringify(asset.origins),
          JSON.stringify(asset),
        )
        putVersion.run(
          version.id,
          asset.id,
          blob.id,
          version.versionNumber,
          version.kind,
          version.createdAt,
          version.width ?? null,
          version.height ?? null,
          JSON.stringify(version),
        )
        deleteFts.run(asset.id)
        putFts.run(asset.id, searchText)
        putIndex.run(asset.id, JSON.stringify(vector), record.perceptualHash ?? null, Date.now(), asset.id)
        deleteBuckets.run(asset.id)
        for (const bucket of semanticBuckets(vector)) putBucket.run(bucket, asset.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  putUsageEvents(events: AssetUsageEvent[]): void {
    if (!events.length) return
    const put = this.db.prepare(`INSERT INTO asset_usage_events(id, asset_id, action, target, occurred_at, json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    const bump = this.db.prepare(`UPDATE asset_machine_index SET usage_score = usage_score + ? WHERE asset_id = ?`)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const event of events) {
        const result = put.run(
          event.id,
          event.assetId,
          event.action,
          event.target,
          event.occurredAt,
          JSON.stringify(event),
        )
        if (result.changes) bump.run(event.action === 'export' ? 3 : event.action === 'derived' ? 2 : 1, event.assetId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  query(input: AssetCatalogQuery): AssetCatalogCursorPage {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)))
    if (
      input.semantic?.enabled &&
      input.scope === 'all' &&
      Object.keys(input.filters).length === 0 &&
      (input.query.trim() || input.semantic.context || input.semantic.similarToAssetId)
    ) {
      const ranked = this.recommend({
        query: input.query,
        context: input.semantic.context,
        similarToAssetId: input.semantic.similarToAssetId,
        limit,
      })
      return {
        assets: ranked.map((item) => item.asset),
        totalCount: ranked.length,
        nextCursor: null,
        counts: this.getCounts(),
      }
    }
    const params: Array<string | number> = []
    const where: string[] = []
    const joins: string[] = []
    if (input.query.trim()) {
      joins.push('JOIN asset_fts ON asset_fts.asset_id = a.id')
      where.push('asset_fts MATCH ?')
      params.push(ftsQuery(input.query))
    }
    this.addScopeWhere(input, where, params)
    this.addFilterWhere(input, where, params)
    const sortExpression =
      input.sortKey === 'createdAt'
        ? 'a.created_at'
        : input.sortKey === 'rating'
          ? 'a.rating'
          : input.sortKey === 'width'
            ? 'COALESCE(a.width, 0)'
            : input.sortKey === 'area'
              ? 'a.area'
              : 'a.updated_at'
    // 排序方向来自渲染进程/API 客户端，必须做枚举校验后再拼接 SQL。
    const sortOrder = input.sortOrder === 'asc' ? 'asc' : 'desc'
    const cursor = decodeCursor(input.cursor)
    if (cursor) {
      where.push(
        `(${sortExpression} ${input.sortOrder === 'asc' ? '>' : '<'} ? OR (${sortExpression} = ? AND a.id > ?))`,
      )
      params.push(cursor.value, cursor.value, cursor.id)
    }
    const from = `FROM assets a ${joins.join(' ')}`
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const countParams = cursor ? params.slice(0, -3) : params
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count ${from} ${cursor ? (where.length > 1 ? `WHERE ${where.slice(0, -1).join(' AND ')}` : '') : predicate}`,
      )
      .get(...countParams) as { count: number }
    const rows = this.db
      .prepare(
        `SELECT a.json AS json, a.id AS id, ${sortExpression} AS sort_value
      ${from} ${predicate} ORDER BY ${sortExpression} ${sortOrder.toUpperCase()}, a.id ASC LIMIT ?`,
      )
      .all(...params, limit) as QueryRow[]
    const last = rows.at(-1)
    return {
      assets: rows.map((row) => JSON.parse(row.json) as GeneratedAsset),
      totalCount: Number(totalRow?.count ?? 0),
      nextCursor: rows.length === limit && last ? encodeCursor({ value: Number(last.sort_value), id: last.id }) : null,
      counts: this.getCounts(),
    }
  }

  private addScopeWhere(input: AssetCatalogQuery, where: string[], params: Array<string | number>) {
    const scope = input.scope
    if (scope === 'trash') where.push("a.status = 'trashed'")
    else {
      where.push("a.status = 'active'")
      if (scope === 'recent') {
        where.push('a.created_at >= ?')
        params.push(Date.now() - 7 * 24 * 60 * 60 * 1000)
      } else if (scope === 'favorites') where.push('a.favorite = 1')
      else if (scope === 'unorganized') where.push('json_array_length(a.collection_ids) = 0')
      else if (typeof scope === 'object') {
        const column = scope.kind === 'collection' ? 'a.collection_ids' : 'a.tag_ids'
        where.push(`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ?)`)
        params.push(scope.id)
      }
    }
  }

  private addFilterWhere(input: AssetCatalogQuery, where: string[], params: Array<string | number>) {
    const filters = input.filters
    if (filters.favoriteOnly) where.push('a.favorite = 1')
    if (filters.minRating !== undefined) {
      where.push('a.rating >= ?')
      params.push(filters.minRating)
    }
    if (filters.colorLabel) {
      where.push("json_extract(a.json, '$.colorLabel') = ?")
      params.push(filters.colorLabel)
    }
    if (filters.collectionId) {
      where.push('EXISTS (SELECT 1 FROM json_each(a.collection_ids) WHERE value = ?)')
      params.push(filters.collectionId)
    }
    if (filters.collectionIds && filters.collectionIds.length > 0) {
      // 递归项目查询（「包含子文件夹」）：id 列表由渲染端按集合树展开
      const placeholders = filters.collectionIds.map(() => '?').join(', ')
      where.push(`EXISTS (SELECT 1 FROM json_each(a.collection_ids) WHERE value IN (${placeholders}))`)
      params.push(...filters.collectionIds)
    }
    if (filters.tagId) {
      where.push('EXISTS (SELECT 1 FROM json_each(a.tag_ids) WHERE value = ?)')
      params.push(filters.tagId)
    }
    if (filters.tagIds && filters.tagIds.length > 0) {
      // 多选标签 AND（Eagle 侧栏多选）：素材须同时包含全部选中标签
      for (const tagId of filters.tagIds) {
        where.push('EXISTS (SELECT 1 FROM json_each(a.tag_ids) WHERE value = ?)')
        params.push(tagId)
      }
    }
    if (filters.dateFrom !== undefined) {
      where.push('a.created_at >= ?')
      params.push(filters.dateFrom)
    }
    if (filters.dateTo !== undefined) {
      where.push('a.created_at <= ?')
      params.push(filters.dateTo)
    }
    if (filters.minWidth !== undefined) {
      where.push('COALESCE(a.width, 0) >= ?')
      params.push(filters.minWidth)
    }
    if (filters.maxWidth !== undefined) {
      where.push('COALESCE(a.width, 0) <= ?')
      params.push(filters.maxWidth)
    }
    if (filters.orientation === 'landscape') where.push('a.width > a.height')
    if (filters.orientation === 'portrait') where.push('a.height > a.width')
    if (filters.orientation === 'square') where.push('a.width = a.height')
    if (filters.provider) {
      where.push("EXISTS (SELECT 1 FROM json_each(a.origins) WHERE json_extract(value, '$.apiProvider') = ?)")
      params.push(filters.provider)
    }
    if (filters.model) {
      where.push("EXISTS (SELECT 1 FROM json_each(a.origins) WHERE lower(json_extract(value, '$.apiModel')) LIKE ?)")
      params.push(`%${filters.model.toLocaleLowerCase('zh-CN')}%`)
    }
    if (filters.sourceMode) {
      where.push("EXISTS (SELECT 1 FROM json_each(a.origins) WHERE json_extract(value, '$.sourceMode') = ?)")
      params.push(filters.sourceMode)
    }
  }

  getCounts(): AssetCatalogCursorPage['counts'] {
    const now = Date.now()
    if (this.countsCache && now - this.countsCache.at < 5000) return this.countsCache.value
    const row = this.db
      .prepare(
        `SELECT
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS all_count,
      SUM(CASE WHEN status='active' AND created_at >= ? THEN 1 ELSE 0 END) AS recent_count,
      SUM(CASE WHEN status='active' AND favorite=1 THEN 1 ELSE 0 END) AS favorites_count,
      SUM(CASE WHEN status='active' AND json_array_length(collection_ids)=0 THEN 1 ELSE 0 END) AS unorganized_count,
      SUM(CASE WHEN status='trashed' THEN 1 ELSE 0 END) AS trash_count FROM assets`,
      )
      .get(Date.now() - 7 * 24 * 60 * 60 * 1000) as Record<string, number | null> | undefined
    if (!row) return { ...EMPTY_COUNTS, byCollection: {}, byTag: {} }
    const byCollection: Record<string, number> = {}
    const byTag: Record<string, number> = {}
    for (const item of this.db
      .prepare(
        "SELECT value AS id, COUNT(*) AS count FROM assets a, json_each(a.collection_ids) WHERE a.status='active' GROUP BY value",
      )
      .all() as Array<{ id: string; count: number }>)
      byCollection[item.id] = Number(item.count)
    for (const item of this.db
      .prepare(
        "SELECT value AS id, COUNT(*) AS count FROM assets a, json_each(a.tag_ids) WHERE a.status='active' GROUP BY value",
      )
      .all() as Array<{ id: string; count: number }>)
      byTag[item.id] = Number(item.count)
    const value = {
      all: Number(row.all_count ?? 0),
      recent: Number(row.recent_count ?? 0),
      favorites: Number(row.favorites_count ?? 0),
      unorganized: Number(row.unorganized_count ?? 0),
      trash: Number(row.trash_count ?? 0),
      byCollection,
      byTag,
    }
    this.countsCache = { at: now, value }
    return value
  }

  getAsset(assetId: string): CatalogAssetDetails | null {
    const row = this.db
      .prepare(
        `SELECT a.json AS asset_json, b.id AS blob_id, b.content_hash, b.mime_type,
      b.byte_size, b.file_path, b.created_at AS blob_created_at, v.json AS version_json
      FROM assets a JOIN versions v ON v.id=a.current_version_id JOIN blobs b ON b.id=v.blob_id WHERE a.id=?`,
      )
      .get(assetId) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      asset: JSON.parse(String(row.asset_json)) as GeneratedAsset,
      blob: {
        id: String(row.blob_id),
        contentHash: String(row.content_hash),
        mimeType: row.mime_type ? String(row.mime_type) : undefined,
        byteSize: row.byte_size === null ? undefined : Number(row.byte_size),
        localPath: row.file_path ? String(row.file_path) : undefined,
        createdAt: Number(row.blob_created_at),
      },
      version: JSON.parse(String(row.version_json)) as AssetVersion,
    }
  }

  /** 全量导出素材记录（含回收站），供备份/合并使用；不走分页查询。 */
  exportAllAssets(): GeneratedAsset[] {
    const rows = this.db.prepare('SELECT json FROM assets').all() as Array<{ json: string }>
    return rows.map((row) => JSON.parse(row.json) as GeneratedAsset)
  }

  /**
   * 按原图 imageId 反查素材详情：素材 id 与 imageId 是两套键（id=asset:xxx，imageId=内容哈希），
   * 渲染端快速预览/查看器在 IDB 缺图记录时用 imageId 兜底恢复原图路径。
   */
  getAssetByImageId(imageId: string): CatalogAssetDetails | null {
    if (!imageId) return null
    const row = this.db
      .prepare("SELECT id FROM assets WHERE json_extract(json, '$.imageId') = ? LIMIT 1")
      .get(imageId) as { id: string } | undefined
    if (!row) return null
    return this.getAsset(row.id)
  }

  recommend(input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }): Array<{ asset: GeneratedAsset; score: number }> {
    const queryVector = input.query ? createTextVector(input.query) : undefined
    const reference = input.similarToAssetId
      ? (this.db
          .prepare('SELECT perceptual_hash FROM asset_machine_index WHERE asset_id=?')
          .get(input.similarToAssetId) as { perceptual_hash?: string } | undefined)
      : undefined
    const buckets = queryVector ? semanticBuckets(queryVector) : []
    let rows: Array<{
      id: string
      json: string
      text_vector?: string
      perceptual_hash?: string
      usage_score: number
      text: string
    }>
    if (buckets.length) {
      const placeholders = buckets.map(() => '?').join(',')
      rows = this.db
        .prepare(
          `SELECT a.id, a.json, i.text_vector, i.perceptual_hash, i.usage_score, f.text
        FROM asset_semantic_buckets sb JOIN assets a ON a.id=sb.asset_id
        JOIN asset_machine_index i ON i.asset_id=a.id JOIN asset_fts f ON f.asset_id=a.id
        WHERE sb.bucket IN (${placeholders}) AND a.status='active' GROUP BY a.id LIMIT 2000`,
        )
        .all(...buckets) as typeof rows
    } else {
      rows = this.db
        .prepare(
          `SELECT a.id, a.json, i.text_vector, i.perceptual_hash, i.usage_score, f.text
        FROM assets a JOIN asset_machine_index i ON i.asset_id=a.id JOIN asset_fts f ON f.asset_id=a.id
        WHERE a.status='active' ORDER BY a.updated_at DESC LIMIT 500`,
        )
        .all() as typeof rows
    }
    const ranked = rankAssetCandidates(
      rows.map((row) => ({
        assetId: row.id,
        asset: JSON.parse(row.json) as GeneratedAsset,
        textVector: row.text_vector ? (JSON.parse(row.text_vector) as number[]) : undefined,
        perceptualHash: row.perceptual_hash,
        usageScore: Number(row.usage_score ?? 0),
        contextText: row.text,
      })),
      { queryVector, referencePerceptualHash: reference?.perceptual_hash, context: input.context },
    )
    return ranked
      .slice(0, Math.max(1, Math.min(50, input.limit ?? 12)))
      .map((item) => ({ asset: item.asset, score: item.score }))
  }

  size(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number }).count)
  }

  deleteAssets(assetIds: string[]): void {
    const statement = this.db.prepare('DELETE FROM assets WHERE id=?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const assetId of [...new Set(assetIds)]) {
        this.db.prepare('DELETE FROM asset_fts WHERE asset_id=?').run(assetId)
        statement.run(assetId)
      }
      this.db.exec('DELETE FROM blobs WHERE id NOT IN (SELECT blob_id FROM versions)')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  clear(): void {
    this.db.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM asset_fts;
      DELETE FROM asset_semantic_buckets;
      DELETE FROM asset_usage_events;
      DELETE FROM asset_machine_index;
      DELETE FROM versions;
      DELETE FROM assets;
      DELETE FROM blobs;
      COMMIT;
    `)
    this.invalidateCountsCache()
  }

  // ===== 项目（集合）=====

  getAllCollections(): AssetCollection[] {
    const rows = this.db
      .prepare('SELECT * FROM collections ORDER BY pinned DESC, sort_order, normalized_name')
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      normalizedName: String(row.normalized_name),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      order: Number(row.sort_order ?? 0),
      color: row.color === null || row.color === undefined ? undefined : String(row.color),
      pinned: row.pinned === 1,
      trashedAt: row.trashed_at === null || row.trashed_at === undefined ? null : Number(row.trashed_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
  }

  putCollections(records: AssetCollection[]): void {
    if (records.length === 0) return
    const statement = this.db.prepare(
      `INSERT INTO collections(id, name, normalized_name, parent_id, sort_order, color, pinned, trashed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, normalized_name=excluded.normalized_name,
         parent_id=excluded.parent_id, sort_order=excluded.sort_order, color=excluded.color,
         pinned=excluded.pinned, trashed_at=excluded.trashed_at, updated_at=excluded.updated_at`,
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        statement.run(
          record.id,
          record.name,
          record.normalizedName,
          record.parentId ?? null,
          record.order ?? 0,
          record.color ?? null,
          record.pinned ? 1 : 0,
          record.trashedAt ?? null,
          record.createdAt,
          record.updatedAt,
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  /** 收集集合树中以 id 为根的整棵子树 id（含自身；防环）。 */
  private collectionSubtreeIds(id: string): string[] {
    const rows = this.db.prepare('SELECT id, parent_id FROM collections').all() as Array<{
      id: string
      parent_id: string | null
    }>
    const childrenOf = new Map<string, string[]>()
    for (const row of rows) {
      if (!row.parent_id || row.parent_id === row.id) continue
      const siblings = childrenOf.get(row.parent_id) ?? []
      siblings.push(row.id)
      childrenOf.set(row.parent_id, siblings)
    }
    const result: string[] = []
    const visited = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      result.push(current)
      for (const childId of childrenOf.get(current) ?? []) stack.push(childId)
    }
    return result
  }

  /** 软删除：把整棵子树标记进回收站（不剥离素材引用，恢复后素材仍在）。 */
  trashCollection(id: string): void {
    const ids = this.collectionSubtreeIds(id)
    if (ids.length === 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.db.prepare('UPDATE collections SET trashed_at=? WHERE id=?')
      const now = Date.now()
      for (const collectionId of ids) statement.run(now, collectionId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  /** 从回收站恢复：清除整棵子树的软删除标记。 */
  restoreCollection(id: string): void {
    const ids = this.collectionSubtreeIds(id)
    if (ids.length === 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.db.prepare('UPDATE collections SET trashed_at=NULL WHERE id=?')
      for (const collectionId of ids) statement.run(collectionId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  /**
   * 从素材的 collection_ids/tag_ids 与 json 中剥离引用（两列保持一致，供原子删除使用）。
   */
  private stripAssetReferences(
    column: 'collection_ids' | 'tag_ids',
    field: 'collectionIds' | 'tagIds',
    id: string,
  ): void {
    const rows = this.db
      .prepare(`SELECT id, json FROM assets WHERE EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ?)`)
      .all(id) as Array<{ id: string; json: string }>
    if (rows.length === 0) return
    const update = this.db.prepare(`UPDATE assets SET ${column}=?, json=?, updated_at=? WHERE id=?`)
    const now = Date.now()
    for (const row of rows) {
      const asset = JSON.parse(row.json) as GeneratedAsset
      const next = (asset[field] ?? []).filter((value: string) => value !== id)
      update.run(JSON.stringify(next), JSON.stringify({ ...asset, [field]: next, updatedAt: now }), now, row.id)
    }
  }

  deleteCollection(id: string): void {
    const row = this.db.prepare('SELECT parent_id FROM collections WHERE id=?').get(id) as
      { parent_id?: string | null } | undefined
    if (!row) return
    const parentId = row.parent_id ?? null
    // 原子化：提升直接子级 + 剥离素材引用 + 删除行，单事务提交。
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE collections SET parent_id=? WHERE parent_id=?').run(parentId, id)
      this.stripAssetReferences('collection_ids', 'collectionIds', id)
      this.db.prepare('DELETE FROM collections WHERE id=?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  // ===== 标签 =====

  getAllTags(): AssetTag[] {
    const rows = this.db.prepare('SELECT * FROM tags ORDER BY parent_id, sort_order, normalized_name').all() as Array<
      Record<string, unknown>
    >
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      normalizedName: String(row.normalized_name),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      order: Number(row.sort_order ?? 0),
      color: row.color === null ? undefined : String(row.color),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
  }

  putTags(records: AssetTag[]): void {
    if (records.length === 0) return
    const statement = this.db.prepare(
      `INSERT INTO tags(id, name, normalized_name, parent_id, sort_order, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, normalized_name=excluded.normalized_name,
         parent_id=excluded.parent_id, sort_order=excluded.sort_order,
         color=excluded.color, updated_at=excluded.updated_at`,
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        statement.run(
          record.id,
          record.name,
          record.normalizedName,
          record.parentId ?? null,
          record.order ?? 0,
          record.color ?? null,
          record.createdAt,
          record.updatedAt,
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  deleteTag(id: string): void {
    const row = this.db.prepare('SELECT parent_id FROM tags WHERE id=?').get(id) as
      { parent_id?: string | null } | undefined
    if (!row) return
    const parentId = row.parent_id ?? null
    // 原子化：提升直接子级 + 剥离素材引用 + 删除行，单事务提交。
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE tags SET parent_id=? WHERE parent_id=?').run(parentId, id)
      this.stripAssetReferences('tag_ids', 'tagIds', id)
      this.db.prepare('DELETE FROM tags WHERE id=?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
  }

  // ===== 墓碑 =====

  getAllTombstones(): AssetTombstone[] {
    const rows = this.db.prepare('SELECT * FROM tombstones').all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      imageId: String(row.image_id),
      purgedAt: Number(row.purged_at),
      lastOriginOccurredAt: Number(row.last_origin_occurred_at),
    }))
  }

  getTombstonesByImageIds(imageIds: string[]): Map<string, AssetTombstone> {
    const result = new Map<string, AssetTombstone>()
    const unique = [...new Set(imageIds)].filter((id) => Boolean(id))
    if (unique.length === 0) return result
    const placeholders = unique.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM tombstones WHERE image_id IN (${placeholders})`)
      .all(...unique) as Array<Record<string, unknown>>
    for (const row of rows) {
      result.set(String(row.image_id), {
        id: String(row.id),
        imageId: String(row.image_id),
        purgedAt: Number(row.purged_at),
        lastOriginOccurredAt: Number(row.last_origin_occurred_at),
      })
    }
    return result
  }

  putTombstones(records: AssetTombstone[]): void {
    if (records.length === 0) return
    const statement = this.db.prepare(
      `INSERT INTO tombstones(id, image_id, purged_at, last_origin_occurred_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET image_id=excluded.image_id, purged_at=excluded.purged_at,
         last_origin_occurred_at=excluded.last_origin_occurred_at`,
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        statement.run(record.id, record.imageId, record.purgedAt, record.lastOriginOccurredAt)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  deleteTombstone(imageId: string): void {
    this.db.prepare('DELETE FROM tombstones WHERE image_id=?').run(imageId)
  }

  // ===== 目录元数据（迁移标记等）=====

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM catalog_meta WHERE key=?').get(key) as { value?: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO catalog_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value)
  }

  // ===== 批量读取与永久删除 =====

  /** 按 id 批量读取素材（含回收站）；缺失的 id 忽略。 */
  getAssetsByIds(ids: string[]): GeneratedAsset[] {
    const unique = [...new Set(ids)].filter((id) => Boolean(id))
    if (unique.length === 0) return []
    const placeholders = unique.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT json FROM assets WHERE id IN (${placeholders})`).all(...unique) as Array<{
      json: string
    }>
    return rows.map((row) => JSON.parse(row.json) as GeneratedAsset)
  }

  /**
   * 永久删除：素材删除 + 墓碑写入在单个 SQLite 事务内完成（权威存储），
   * 返回已删除素材及其墓碑；调用方再补任务输出补丁（IndexedDB）并删除图片字节。
   */
  purgeAssets(assetIds: string[], now: number): { purged: string[]; tombstones: AssetTombstone[] } {
    const unique = [...new Set(assetIds)].filter((id) => Boolean(id))
    if (unique.length === 0) return { purged: [], tombstones: [] }
    const purged: string[] = []
    const tombstones: AssetTombstone[] = []
    const getAssetJson = this.db.prepare('SELECT json FROM assets WHERE id=?')
    const deleteAsset = this.db.prepare('DELETE FROM assets WHERE id=?')
    const deleteFts = this.db.prepare('DELETE FROM asset_fts WHERE asset_id=?')
    // 幂等墓碑：同 imageId 只保留一条，历史残留/重复素材不再触发 UNIQUE 冲突；
    // last_origin_occurred_at 取历史与新批次的最大值（导入去重语义不倒退）
    const putTombstone = this.db.prepare(
      `INSERT INTO tombstones(id, image_id, purged_at, last_origin_occurred_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         purged_at = excluded.purged_at,
         last_origin_occurred_at = MAX(tombstones.last_origin_occurred_at, excluded.last_origin_occurred_at)`,
    )
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const tombstoneByImage = new Map<string, AssetTombstone>()
      for (const assetId of unique) {
        const row = getAssetJson.get(assetId) as { json: string } | undefined
        if (!row) continue
        const asset = JSON.parse(row.json) as GeneratedAsset
        let lastOriginOccurredAt = asset.createdAt ?? now
        for (const origin of asset.origins ?? []) {
          const occurredAt = origin.taskFinishedAt ?? origin.taskCreatedAt
          if (occurredAt && occurredAt > lastOriginOccurredAt) lastOriginOccurredAt = occurredAt
        }
        // 同一 imageId 的重复素材（历史遗留）：只产出一条墓碑，取最大 lastOriginOccurredAt
        const existing = tombstoneByImage.get(asset.imageId)
        if (existing) {
          if (lastOriginOccurredAt > existing.lastOriginOccurredAt) existing.lastOriginOccurredAt = lastOriginOccurredAt
        } else {
          tombstoneByImage.set(asset.imageId, {
            id: asset.imageId,
            imageId: asset.imageId,
            purgedAt: now,
            lastOriginOccurredAt,
          })
        }
        deleteFts.run(assetId)
        deleteAsset.run(assetId)
        purged.push(assetId)
      }
      for (const tombstone of tombstoneByImage.values()) {
        putTombstone.run(tombstone.id, tombstone.imageId, tombstone.purgedAt, tombstone.lastOriginOccurredAt)
        tombstones.push(tombstone)
      }
      this.db.exec('DELETE FROM blobs WHERE id NOT IN (SELECT blob_id FROM versions)')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
    return { purged, tombstones }
  }

  /**
   * 清理"仅以参考图身份归档"的素材（archiveTaskReferences 停用前的产物）：
   * origins 全部为 kind='reference' 的素材删除（不写墓碑——参考图不是被永久删除的生成结果，
   * 未来若真正生成同内容可正常重新归档）。返回删除的素材 id。
   */
  cleanupReferenceOnlyAssets(): string[] {
    const rows = this.db.prepare('SELECT json FROM assets').all() as Array<{ json: string }>
    const referenceOnly = rows
      .map((row) => JSON.parse(row.json) as GeneratedAsset)
      .filter(
        (asset) =>
          Array.isArray(asset.origins) &&
          asset.origins.length > 0 &&
          asset.origins.every((origin) => origin.kind === 'reference'),
      )
    const ids = referenceOnly.map((asset) => asset.id)
    if (ids.length === 0) return []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deleteAsset = this.db.prepare('DELETE FROM assets WHERE id=?')
      const deleteFts = this.db.prepare('DELETE FROM asset_fts WHERE asset_id=?')
      for (const id of ids) {
        deleteFts.run(id)
        deleteAsset.run(id)
      }
      this.db.exec('DELETE FROM blobs WHERE id NOT IN (SELECT blob_id FROM versions)')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.invalidateCountsCache()
    return ids
  }

  // ===== 查重 / 衍生链 / 建议标签 =====

  /** 近似重复检测：感知哈希按 4-hex 前缀分桶，桶内 Hamming 距离 ≤ threshold 的素材归为一组。 */
  findNearDuplicates(threshold = 8): Array<{ assets: GeneratedAsset[]; avgHamming: number }> {
    const rows = this.db
      .prepare(
        `SELECT a.json AS json, m.perceptual_hash AS phash
         FROM assets a JOIN asset_machine_index m ON m.asset_id = a.id
         WHERE a.status = 'active' AND m.perceptual_hash IS NOT NULL`,
      )
      .all() as Array<{ json: string; phash: string }>
    const items = rows.map((row) => ({ asset: JSON.parse(row.json) as GeneratedAsset, phash: row.phash }))
    if (items.length < 2) return []

    const parent = new Map<string, string>()
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!
      return root
    }
    const union = (a: string, b: string) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(rb, ra)
    }

    // 4-hex（16 bit）前缀分桶，桶内两两比较
    const buckets = new Map<string, typeof items>()
    for (const item of items) {
      const prefix = item.phash.slice(0, 4)
      const bucket = buckets.get(prefix) ?? []
      bucket.push(item)
      buckets.set(prefix, bucket)
    }
    for (const bucket of buckets.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          if (hammingDistance(bucket[i].phash, bucket[j].phash) <= threshold) {
            union(bucket[i].asset.id, bucket[j].asset.id)
          }
        }
      }
    }

    const groups = new Map<string, typeof items>()
    for (const item of items) {
      const root = find(item.asset.id)
      const group = groups.get(root) ?? []
      group.push(item)
      groups.set(root, group)
    }
    const result: Array<{ assets: GeneratedAsset[]; avgHamming: number }> = []
    for (const group of groups.values()) {
      if (group.length < 2) continue
      let total = 0
      let pairs = 0
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          total += hammingDistance(group[i].phash, group[j].phash)
          pairs++
        }
      }
      result.push({ assets: group.map((item) => item.asset), avgHamming: pairs ? total / pairs : 0 })
    }
    return result.sort((a, b) => a.avgHamming - b.avgHamming)
  }

  /** 衍生链：上游输入素材（parentAssetIds）与下游产物（parentAssetIds 包含当前 id 的素材）。 */
  getDerivedAssets(assetId: string): { parents: GeneratedAsset[]; children: GeneratedAsset[] } {
    const asset = this.getAssetsByIds([assetId])[0]
    const parents = asset ? this.getAssetsByIds(asset.parentAssetIds) : []
    // node:sqlite 的 json_each 不支持关联子查询引用外层列，这里用全量 JSON 过滤（单次调用量级可接受）
    const children = this.exportAllAssets()
      .filter((candidate) => candidate.id !== assetId && candidate.parentAssetIds.includes(assetId))
      .sort((a, b) => b.createdAt - a.createdAt)
    return { parents, children }
  }

  close(): void {
    this.db.close()
  }
}

/** 两个 16 位十六进制感知哈希的 Hamming 距离（bit 数）。 */
function hammingDistance(left: string, right: string): number {
  if (!left || !right || left.length !== right.length) return Number.MAX_SAFE_INTEGER
  let distance = 0
  for (let i = 0; i < left.length; i++) {
    const a = Number.parseInt(left[i], 16)
    const b = Number.parseInt(right[i], 16)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.MAX_SAFE_INTEGER
    let xor = (a ^ b) & 0xf
    while (xor) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}
