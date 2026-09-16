#!/usr/bin/env node
/**
 * 修复被 JSON 序列化破坏的后期处理复合资源（compositeAssets）。
 *
 * 背景：Electron 端的应用数据存储是 SQLite + 主进程 JSON.stringify，历史版本在
 * IndexedDB → SQLite 迁移时把 Blob 直接交给 IPC，Blob 被序列化成 `{}`，字节与 MIME
 * 全部丢失。表现为后期处理加载图片时报
 * `Failed to execute 'createObjectURL' on 'URL': Overload resolution failed.`
 *
 * 本脚本用整库备份 ZIP 里的 `composite-assets/<assetId>.<ext>` 把字节找回，
 * 并按新格式 `{ id, createdAt, blobDataUrl }` 写回。
 *
 * 用法：
 *   node scripts/repair-composite-assets.mjs                    # 预演，只报告不改动
 *   node scripts/repair-composite-assets.mjs --apply            # 真正写回（会先备份 db 文件）
 *   node scripts/repair-composite-assets.mjs --db <path> --zip <path>
 *
 * 重要：写回前请先退出豆泡，避免与运行中的进程争抢 SQLite 写锁。
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

const require = createRequire(import.meta.url)

const ZIP_LOCAL_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_EOCD_SIGNATURE = 0x06054b50

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  avif: 'image/avif',
}

function parseArgs(argv) {
  const args = { apply: false, db: null, zip: null }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--apply') args.apply = true
    else if (token === '--db') args.db = argv[++index] ?? null
    else if (token === '--zip') args.zip = argv[++index] ?? null
    else if (token === '--help' || token === '-h') args.help = true
    else throw new Error(`未知参数：${token}`)
  }
  return args
}

function printUsage() {
  console.log(`用法：
  node scripts/repair-composite-assets.mjs [--apply] [--db <asset-kernel.sqlite>] [--zip <backup.zip>]

  --apply   真正写回数据库（默认只预演报告）；写回前会复制一份 db 备份
  --db      指定素材库 SQLite 路径（默认从 local-settings.json 推导）
  --zip     指定用于找回字节的整库备份 ZIP（默认取库根 backups/ 下最新的一个）`)
}

/** 从 userData/local-settings.json 推导库根，返回候选 db 路径（按优先级）。 */
function resolveDbCandidates() {
  const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'gpt-image-playground')
  const settingsFile = path.join(userData, 'local-settings.json')
  const candidates = []
  try {
    const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    const saved = settings?.localSavePath
    if (typeof saved === 'string' && saved.trim()) candidates.push(path.join(saved, 'db', 'asset-kernel.sqlite'))
  } catch {
    // 没有本地设置文件时退回默认位置
  }
  candidates.push(path.join(userData, 'local-saves', 'db', 'asset-kernel.sqlite'))
  candidates.push(path.join(userData, 'asset-kernel.sqlite'))
  return candidates.filter(existsSync)
}

function resolveZipCandidate(dbPath) {
  // db 在 <库根>/db/ 下，备份在 <库根>/backups/
  const backupsDir = path.join(path.dirname(path.dirname(dbPath)), 'backups')
  if (!existsSync(backupsDir)) return null
  const zips = readdirSync(backupsDir)
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .map((name) => {
      const full = path.join(backupsDir, name)
      return { full, mtime: statSync(full).mtimeMs }
    })
    .sort((left, right) => right.mtime - left.mtime)
  return zips[0]?.full ?? null
}

/** 极简 ZIP 读取：只依赖中央目录 + inflateRaw，够用即可（不处理 ZIP64 / 加密）。 */
function readZipEntries(buffer) {
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 22 - 0xffff; offset--) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到中央目录结尾）')

  const entryCount = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()

  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) throw new Error('ZIP 中央目录损坏')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.set(name, { method, compressedSize, localOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readZipEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_SIGNATURE) throw new Error('ZIP 本地文件头损坏')
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26)
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`不支持的 ZIP 压缩方式：${entry.method}`)
}

function toDataUrl(bytes, extension) {
  const mime = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function loadDatabaseSync() {
  try {
    return require('node:sqlite').DatabaseSync
  } catch (error) {
    throw new Error(
      `当前 Node 无法加载 node:sqlite（${error.message}）。请用 Node 22.5+ 运行，必要时加 --experimental-sqlite。`,
    )
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const dbPath = args.db ?? resolveDbCandidates()[0]
  if (!dbPath) throw new Error('找不到素材库 SQLite，请用 --db 指定路径')
  const zipPath = args.zip ?? resolveZipCandidate(dbPath)
  if (!zipPath) throw new Error('找不到用于找回字节的备份 ZIP，请用 --zip 指定路径')

  console.log(`数据库：${dbPath}`)
  console.log(`备份 ZIP：${zipPath}`)
  console.log(args.apply ? '模式：写回（--apply）' : '模式：预演（不改动任何数据）')

  const zipBuffer = readFileSync(zipPath)
  const zipEntries = readZipEntries(zipBuffer)
  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath)

  const rows = db.prepare("SELECT record_id, json FROM app_data_records WHERE namespace = 'compositeAssets'").all()

  const repaired = []
  const alreadyFine = []
  const unrecoverable = []

  for (const row of rows) {
    const id = row.record_id
    let record = null
    try {
      record = JSON.parse(row.json)
    } catch {
      // 解析失败也走修复分支
    }
    if (record && typeof record.blobDataUrl === 'string' && record.blobDataUrl.startsWith('data:')) {
      alreadyFine.push(id)
      continue
    }
    const entryKey = [...zipEntries.keys()].find((name) => {
      if (!name.startsWith('composite-assets/')) return false
      const file = name.slice('composite-assets/'.length)
      return file.replace(/\.[^.]+$/, '') === id
    })
    if (!entryKey) {
      unrecoverable.push(id)
      continue
    }
    const extension = entryKey.slice(entryKey.lastIndexOf('.') + 1).toLowerCase()
    const bytes = readZipEntry(zipBuffer, zipEntries.get(entryKey))
    const createdAt = typeof record?.createdAt === 'number' ? record.createdAt : Date.now()
    const nextJson = JSON.stringify({ id, createdAt, blobDataUrl: toDataUrl(bytes, extension) })
    repaired.push({ id, bytes: bytes.length, extension, nextJson })
  }

  console.log('')
  console.log(
    `共 ${rows.length} 条复合资源：可修复 ${repaired.length}，已正常 ${alreadyFine.length}，无法找回 ${unrecoverable.length}`,
  )
  for (const item of repaired) console.log(`  [可修复] ${item.id}  ${item.extension}  ${item.bytes} 字节`)
  for (const id of unrecoverable) console.log(`  [找不到] ${id}  备份 ZIP 中没有对应文件`)

  if (!args.apply) {
    console.log('')
    console.log('预演结束，未写入任何数据。确认无误后加 --apply 写回。')
    db.close()
    return
  }

  if (repaired.length === 0) {
    console.log('')
    console.log('没有需要写回的记录。')
    db.close()
    return
  }

  // 写回前把 db 落盘并备份，避免 WAL 里的数据没被复制到
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const backupPath = `${dbPath}.repair-backup-${Date.now()}`
  copyFileSync(dbPath, backupPath)
  console.log('')
  console.log(`已备份数据库：${backupPath}`)

  const update = db.prepare(
    'UPDATE app_data_records SET json = ?, updated_at = ? WHERE namespace = ? AND record_id = ?',
  )
  const now = Date.now()
  for (const item of repaired) update.run(item.nextJson, now, 'compositeAssets', item.id)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()

  console.log(`已写回 ${repaired.length} 条复合资源。重新打开豆泡即可在后期处理中看到图片。`)
}

try {
  main()
} catch (error) {
  console.error(`修复失败：${error.message}`)
  process.exitCode = 1
}
