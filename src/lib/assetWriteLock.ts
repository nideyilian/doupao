/**
 * 素材库写入互斥锁。
 *
 * 解决 purge（永久删除）与素材同步队列之间的 TOCTOU：
 * - purge 的"删素材 + 写墓碑"事务与 upsertFromTask 的"读墓碑快照 → 写素材"必须串行；
 * - 否则 upsert 在 purge 事务提交之后用旧墓碑快照写入，会把已永久删除的素材"复活"。
 *
 * 同一渲染进程内单线程，用 promise 链实现。锁不可重入：需要嵌套持锁的调用方
 * （如 upsertFromTask → putGeneratedAssets）应直接调用内部的 Unlocked 实现，
 * 由最外层调用统一持锁，避免"排队中的调用被误判为嵌套"的问题。
 */
let lockTail: Promise<unknown> = Promise.resolve()

export function withAssetWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockTail.then(fn, fn)
  lockTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
