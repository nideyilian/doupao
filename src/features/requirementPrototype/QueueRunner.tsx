import { useEffect, useRef } from 'react'
import { ensureImageCached, submitTaskWithData, useStore } from '../../store'
import { getLocalSavePath, joinPath } from '../../lib/localSave'
import { useRequirementPrototype } from './store'
import { writeRequirementManifests } from './manifests'

function safeSegment(value: string) {
  // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名'
}

function dateFolder(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function RequirementQueueRunner() {
  const tasks = useStore((state) => state.tasks)
  const orders = useRequirementPrototype((state) => state.orders)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const generationConcurrency = useRequirementPrototype((state) => state.settings.generationConcurrency)
  const submitting = useRef(new Set<string>())
  const manifested = useRef(new Set<string>())

  useEffect(() => {
    useRequirementPrototype.getState().syncTasks(tasks)
  }, [tasks])

  useEffect(() => {
    for (const order of orders) {
      const terminal = order.status === 'completed' || order.status === 'partially_failed' || order.status === 'failed'
      if (!terminal || manifested.current.has(order.id)) continue
      manifested.current.add(order.id)
      void writeRequirementManifests(order, catalog, tasks)
        .then((written) => {
          if (!written) manifested.current.delete(order.id)
        })
        .catch(() => manifested.current.delete(order.id))
    }
  }, [catalog, orders, tasks])

  useEffect(() => {
    if (!sessionUserId) return
    const runningUnits = orders.reduce(
      (count, order) => count + order.units.filter((unit) => unit.status === 'running' && unit.taskId).length,
      0,
    )
    if (runningUnits >= Math.max(1, generationConcurrency)) return
    const candidates = [...orders]
      .filter((order) => order.status === 'queued' || order.status === 'running')
      .sort((left, right) => {
        const priority = Number(right.urgentApproved) - Number(left.urgentApproved)
        return priority || left.createdAt - right.createdAt
      })

    const order = candidates.find((item) => item.units.some((unit) => unit.status === 'queued' && !unit.taskId))
    const unit = order?.units.find((item) => item.status === 'queued' && !item.taskId)
    if (!order || !unit) return

    const key = `${order.id}:${unit.id}`
    if (submitting.current.has(key)) return
    submitting.current.add(key)

    void (async () => {
      try {
        const product = catalog.products.find((item) => item.id === unit.productId)
        const channel = catalog.channels.find((item) => item.id === unit.channelId)
        const materialType = catalog.materialTypes.find((item) => item.id === unit.materialTypeId)
        if (!product || !channel || !materialType) throw new Error('任务引用的配置已不存在')

        const root = await getLocalSavePath()
        const outputRoot = product.outputPath || channel.outputPath || root
        const outputPath = outputRoot
          ? await joinPath(
              outputRoot,
              'requirement-orders',
              safeSegment(channel.name),
              safeSegment(product.name),
              safeSegment(materialType.name),
              dateFolder(order.createdAt),
              safeSegment(order.number),
              unit.ratio.replace(':', 'x'),
            )
          : undefined
        const current = useStore.getState()
        const inputImages = (
          await Promise.all(
            (unit.referenceImageIds ?? []).map(async (imageId) => {
              const dataUrl = await ensureImageCached(imageId)
              return dataUrl ? { id: imageId, dataUrl } : null
            }),
          )
        ).filter((image): image is { id: string; dataUrl: string } => Boolean(image))
        const taskId = await submitTaskWithData({
          prompt: unit.prompt,
          inputImages,
          inputImageFolder: null,
          params: {
            ...current.params,
            n: unit.quantity,
            size: unit.ratio === '16:9' ? '1536x1024' : '1024x1536',
          },
          maskDraft: null,
          scheduledOutputPath: outputPath,
          scheduledOutputSubFolder: undefined,
        })

        if (!taskId) throw new Error('任务未创建，请检查管理员维护的 API 与模型设置')
        useRequirementPrototype.getState().attachTask(order.id, unit.id, taskId)
      } catch (error) {
        useRequirementPrototype
          .getState()
          .failUnit(order.id, unit.id, error instanceof Error ? error.message : String(error))
      } finally {
        submitting.current.delete(key)
      }
    })()
  }, [catalog, generationConcurrency, orders, sessionUserId])

  return null
}
