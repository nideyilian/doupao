/**
 * node:sqlite 最小类型声明。
 * 运行时由 Electron 主进程的 Node.js 提供（Electron 43 内置 Node ≥ 22.5），
 * 项目 @types/node 版本尚未包含该模块类型，此处仅声明 asset-catalog.ts 用到的 API。
 */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(
      path: string,
      options?: {
        open?: boolean
        readOnly?: boolean
        enableForeignKeyConstraints?: boolean
        enableDoubleQuotedStringLiterals?: boolean
        allowExtension?: boolean
      },
    )
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
    readonly isOpen: boolean
  }

  export interface StatementSync {
    get(...params: Array<string | number | bigint | null | Uint8Array>): unknown
    all(...params: Array<string | number | bigint | null | Uint8Array>): unknown[]
    run(...params: Array<string | number | bigint | null | Uint8Array>): {
      changes: number
      lastInsertRowid: number | bigint
    }
    setAllowBareNamedParameters(enabled: boolean): void
  }
}
