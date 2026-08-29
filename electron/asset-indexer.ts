import { ASSET_TEXT_MODEL_ID, ASSET_TEXT_MODEL_VERSION, createTextVector } from '../src/lib/assetSemanticSearch'

export function indexAssetTexts(items: Array<{ assetId: string; text: string }>, generatedAt = Date.now()) {
  return items.map((item) => ({
    assetId: item.assetId,
    textVector: createTextVector(item.text),
    modelId: ASSET_TEXT_MODEL_ID,
    modelVersion: ASSET_TEXT_MODEL_VERSION,
    generatedAt,
  }))
}

type UtilityParentPort = {
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
}

const parentPort = (process as typeof process & { parentPort?: UtilityParentPort }).parentPort
if (parentPort) {
  parentPort.on('message', ({ data }) => {
    const request = data as { id?: string; items?: Array<{ assetId: string; text: string }> }
    if (!request?.id || !Array.isArray(request.items)) return
    try {
      parentPort.postMessage({ id: request.id, records: indexAssetTexts(request.items) })
    } catch (error) {
      parentPort.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
