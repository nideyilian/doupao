import { closeSync, openSync, readSync, statSync } from 'fs'
import { inflateSync } from 'fflate'

/**
 * 流式 ZIP 读取器（主进程）。
 * 只读取尾部的中央目录 + 按需读取单个条目，不把整个 ZIP 载入内存；
 * 用于备份导入的 manifest 预读与条目按批解压。
 *
 * 仅支持 method 0（stored）与 8（deflate），条目路径经过安全校验。
 */

export interface ZipDirectoryEntry {
  archivePath: string
  method: number
  compressedSize: number
  uncompressedSize: number
  crc: number
  localOffset: number
}

export interface ZipScanResult {
  entries: ZipDirectoryEntry[]
  entriesTotal: number
  /** 全部条目压缩后字节数（不含中央目录），用于导入前展示备份大小 */
  totalCompressedBytes: number
}

export interface ZipFileHandle {
  filePath: string
  entriesByPath: Map<string, ZipDirectoryEntry>
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

const MAX_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024
const MAX_ENTRY_COMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_MANIFEST_BYTES = 512 * 1024 * 1024

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8)
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0
}

/** 在文件尾部（最后 64 KiB + 注释长度上限）中定位 EOCD 记录。 */
export function findEndOfCentralDirectory(buffer: Uint8Array): {
  entriesTotal: number
  cdOffset: number
  cdSize: number
} | null {
  const min = Math.max(0, buffer.length - 65557)
  for (let index = buffer.length - 22; index >= min; index--) {
    if (readU32(buffer, index) === EOCD_SIGNATURE) {
      return {
        entriesTotal: readU16(buffer, index + 10),
        cdOffset: readU32(buffer, index + 16),
        cdSize: readU32(buffer, index + 12),
      }
    }
  }
  return null
}

export function assertSafeZipPath(archivePath: string): void {
  const normalized = archivePath.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`备份包含不安全路径：${archivePath}`)
  }
}

/** 解析中央目录字节为条目清单（纯函数，便于测试）。 */
export function parseCentralDirectory(buffer: Uint8Array): ZipDirectoryEntry[] {
  const entries: ZipDirectoryEntry[] = []
  let offset = 0
  while (offset + 46 <= buffer.length) {
    if (readU32(buffer, offset) !== CENTRAL_SIGNATURE) break
    const nameLength = readU16(buffer, offset + 28)
    const extraLength = readU16(buffer, offset + 30)
    const commentLength = readU16(buffer, offset + 32)
    const entrySize = 46 + nameLength + extraLength + commentLength
    if (offset + entrySize > buffer.length) throw new Error('中央目录记录越界')
    const archivePath = new TextDecoder().decode(buffer.subarray(offset + 46, offset + 46 + nameLength))
    assertSafeZipPath(archivePath)
    entries.push({
      archivePath,
      method: readU16(buffer, offset + 10),
      compressedSize: readU32(buffer, offset + 20),
      uncompressedSize: readU32(buffer, offset + 24),
      crc: readU32(buffer, offset + 16),
      localOffset: readU32(buffer, offset + 42),
    })
    offset += entrySize
  }
  return entries
}

function readFdAt(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset)
    if (read <= 0) throw new Error('文件读取不完整')
    offset += read
  }
  return buffer
}

/** 扫描本地 ZIP 文件：只读尾部 EOCD 与中央目录。 */
export function scanZipFile(filePath: string): ZipScanResult {
  const size = statSync(filePath).size
  const fd = openSync(filePath, 'r')
  try {
    const tailLength = Math.min(size, 65557)
    const tail = new Uint8Array(readFdAt(fd, tailLength, size - tailLength))
    const eocd = findEndOfCentralDirectory(tail)
    if (!eocd) throw new Error('无效的 ZIP 文件（未找到中央目录）')
    if (eocd.cdSize > MAX_CENTRAL_DIRECTORY_BYTES) {
      throw new Error('ZIP 中央目录过大，无法导入')
    }
    const central = new Uint8Array(readFdAt(fd, eocd.cdSize, eocd.cdOffset))
    const entries = parseCentralDirectory(central)
    if (entries.length !== eocd.entriesTotal) {
      throw new Error('ZIP 条目清单与中央目录不一致')
    }
    return {
      entries,
      entriesTotal: eocd.entriesTotal,
      totalCompressedBytes: entries.reduce((sum, entry) => sum + entry.compressedSize, 0),
    }
  } finally {
    closeSync(fd)
  }
}

export function openZipHandle(filePath: string): ZipFileHandle {
  const scan = scanZipFile(filePath)
  const entriesByPath = new Map<string, ZipDirectoryEntry>()
  for (const entry of scan.entries) entriesByPath.set(entry.archivePath, entry)
  return { filePath, entriesByPath }
}

// ===== CRC-32（ZIP 校验；避免依赖特定 fflate 版本导出）=====

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 按条目读取解压字节（仅加载该条目，含 CRC 完整性校验）。 */
export function readZipEntryBytes(handle: ZipFileHandle, archivePath: string): Uint8Array {
  const entry = handle.entriesByPath.get(archivePath)
  if (!entry) throw new Error(`ZIP 中缺少条目：${archivePath}`)
  if (entry.compressedSize > MAX_ENTRY_COMPRESSED_BYTES) {
    throw new Error(`条目过大：${archivePath}`)
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`不支持的压缩方式：${entry.method}（${archivePath}）`)
  }
  const fd = openSync(handle.filePath, 'r')
  try {
    const header = readFdAt(fd, 30, entry.localOffset)
    if (readU32(header, 0) !== LOCAL_SIGNATURE) {
      throw new Error('本地文件头损坏')
    }
    const nameLength = readU16(header, 26)
    const extraLength = readU16(header, 28)
    const data = readFdAt(fd, entry.compressedSize, entry.localOffset + 30 + nameLength + extraLength)
    const bytes = entry.method === 0 ? new Uint8Array(data) : inflateSync(new Uint8Array(data))
    if (crc32(bytes) !== entry.crc) {
      throw new Error(`条目校验失败（CRC 不匹配）：${archivePath}`)
    }
    return bytes
  } finally {
    closeSync(fd)
  }
}

/** 读取备份 manifest.json（大小受限）。 */
export function readZipManifest(handle: ZipFileHandle): { manifest: unknown; manifestBytes: number } {
  const entry = handle.entriesByPath.get('manifest.json')
  if (!entry || entry.uncompressedSize > MAX_MANIFEST_BYTES) {
    throw new Error('ZIP 中缺少 manifest.json 或清单过大')
  }
  const bytes = readZipEntryBytes(handle, 'manifest.json')
  const text = new TextDecoder().decode(bytes)
  return { manifest: JSON.parse(text) as unknown, manifestBytes: bytes.byteLength }
}
