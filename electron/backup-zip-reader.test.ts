import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { strFromU8, strToU8, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertSafeZipPath,
  findEndOfCentralDirectory,
  openZipHandle,
  parseCentralDirectory,
  readZipEntryBytes,
  readZipManifest,
  scanZipFile,
} from './backup-zip-reader'

function readAt(filePath: string, length: number, position: number): Buffer {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, position + offset)
      if (read <= 0) throw new Error('文件读取不完整')
      offset += read
    }
    return buffer
  } finally {
    closeSync(fd)
  }
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'backup-zip-reader-'))
let zipPath = ''

function buildZip(
  entries: Record<string, Uint8Array | [Uint8Array, { level?: number }]>,
  fileName = 'backup.zip',
): string {
  const bytes = zipSync(entries as never)
  const target = path.join(tempDir, fileName)
  writeFileSync(target, bytes)
  return target
}

beforeAll(() => {
  zipPath = buildZip({
    'manifest.json': strToU8(JSON.stringify({ version: 7, hello: 'world' })),
    'images/img-a.png': [strToU8('fake-png-bytes-a'), { level: 0 }],
    'images/img-b.png': [strToU8('fake-png-bytes-b'), { level: 6 }],
  })
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('findEndOfCentralDirectory', () => {
  it('locates the EOCD record in a small tail buffer', () => {
    const tail = new Uint8Array(readFileSync(zipPath))
    const eocd = findEndOfCentralDirectory(tail)
    expect(eocd).not.toBeNull()
    expect(eocd!.entriesTotal).toBe(3)
    expect(eocd!.cdSize).toBeGreaterThan(0)
  })
})

describe('scanZipFile', () => {
  it('scans the central directory without loading the whole file', () => {
    const scan = scanZipFile(zipPath)
    expect(scan.entriesTotal).toBe(3)
    const names = scan.entries.map((entry) => entry.archivePath).sort()
    expect(names).toEqual(['images/img-a.png', 'images/img-b.png', 'manifest.json'])
    expect(scan.totalCompressedBytes).toBeGreaterThan(0)
  })

  it('rejects unsafe entry paths', () => {
    expect(() => assertSafeZipPath('../evil.txt')).toThrow('不安全路径')
    expect(() => assertSafeZipPath('/abs/path.png')).toThrow('不安全路径')
    expect(() => assertSafeZipPath('C:\\windows\\x.png')).toThrow('不安全路径')
    expect(() => assertSafeZipPath('images/ok.png')).not.toThrow()
  })

  it('rejects path traversal entries during scan', () => {
    const evilPath = buildZip({ '../evil.txt': strToU8('x') }, 'evil.zip')
    expect(() => scanZipFile(evilPath)).toThrow('不安全路径')
    rmSync(evilPath, { force: true })
  })
})

describe('parseCentralDirectory', () => {
  it('parses method, sizes and local offsets', () => {
    const tail = new Uint8Array(readFileSync(zipPath))
    const eocd = findEndOfCentralDirectory(tail)!
    const central = new Uint8Array(readAt(zipPath, eocd.cdSize, eocd.cdOffset))
    const entries = parseCentralDirectory(central)
    const manifest = entries.find((entry) => entry.archivePath === 'manifest.json')!
    expect(manifest.method).toBe(8) // deflate
    expect(manifest.uncompressedSize).toBeGreaterThan(0)
    expect(manifest.crc).not.toBe(0)
    const stored = entries.find((entry) => entry.archivePath === 'images/img-a.png')!
    expect(stored.method).toBe(0) // stored
    expect(stored.uncompressedSize).toBe(strToU8('fake-png-bytes-a').length)
  })
})

describe('readZipManifest / readZipEntryBytes', () => {
  it('reads and parses manifest.json only', () => {
    const handle = openZipHandle(zipPath)
    const { manifest } = readZipManifest(handle)
    expect(manifest).toEqual({ version: 7, hello: 'world' })
  })

  it('reads stored and deflated entries with CRC verification', () => {
    const handle = openZipHandle(zipPath)
    expect(strFromU8(readZipEntryBytes(handle, 'images/img-a.png'))).toBe('fake-png-bytes-a')
    expect(strFromU8(readZipEntryBytes(handle, 'images/img-b.png'))).toBe('fake-png-bytes-b')
  })

  it('throws when the entry is missing or corrupted', () => {
    const handle = openZipHandle(zipPath)
    expect(() => readZipEntryBytes(handle, 'nope.png')).toThrow('缺少条目')

    // 破坏 img-b 的压缩数据区（按本地头定位），扫描应仍成功、读取时应报错（解压或 CRC 失败）
    const corrupted = path.join(tempDir, 'corrupted.zip')
    const bytes = readFileSync(zipPath)
    writeFileSync(corrupted, bytes)
    const corruptedHandle = openZipHandle(corrupted)
    const entryB = corruptedHandle.entriesByPath.get('images/img-b.png')!
    const header = readAt(corrupted, 30, entryB.localOffset)
    const nameLength = header[26] | (header[27] << 8)
    const extraLength = header[28] | (header[29] << 8)
    const dataOffset = entryB.localOffset + 30 + nameLength + extraLength
    const corrupt = readFileSync(corrupted)
    corrupt[dataOffset + Math.min(5, entryB.compressedSize - 1)] ^= 0xff
    writeFileSync(corrupted, corrupt)
    expect(() => readZipEntryBytes(openZipHandle(corrupted), 'images/img-b.png')).toThrow()
    rmSync(corrupted, { force: true })
  })
})
