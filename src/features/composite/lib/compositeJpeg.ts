export type ChooseJpegQualityInput = {
  maxSizeKb: number
  minQuality?: number
  maxQuality?: number
  iterations?: number
  estimateSizeKb: (quality: number) => number
}

export type ChooseJpegQualityResult = {
  quality: number
  warning?: string
}

function isValidNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function assertQualityRange(name: string, value: number): void {
  if (!isValidNumber(value) || value < 0 || value > 1) {
    throw new Error(`无效的 ${name}`)
  }
}

function measureSizeKb(estimateSizeKb: (quality: number) => number, quality: number): number {
  const sizeKb = estimateSizeKb(quality)
  if (!isValidNumber(sizeKb)) {
    throw new Error('无效的 estimateSizeKb 返回值')
  }
  return sizeKb
}

export function chooseJpegQuality(input: ChooseJpegQualityInput): ChooseJpegQualityResult {
  const minQuality = input.minQuality ?? 0.5
  const maxQuality = input.maxQuality ?? 0.9
  const iterations = input.iterations ?? 8

  if (!isValidNumber(input.maxSizeKb) || input.maxSizeKb < 0) {
    throw new Error('无效的 maxSizeKb')
  }
  assertQualityRange('minQuality', minQuality)
  assertQualityRange('maxQuality', maxQuality)
  if (minQuality > maxQuality) {
    throw new Error('无效的质量范围')
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('无效的迭代次数')
  }
  if (typeof input.estimateSizeKb !== 'function') {
    throw new Error('无效的 estimateSizeKb')
  }

  const minSizeKb = measureSizeKb(input.estimateSizeKb, minQuality)
  if (minSizeKb > input.maxSizeKb) {
    return {
      quality: minQuality,
      warning: `最低质量 ${minQuality} 仍超过 ${input.maxSizeKb}KB`,
    }
  }

  const maxSizeKb = measureSizeKb(input.estimateSizeKb, maxQuality)
  if (maxSizeKb <= input.maxSizeKb) {
    return { quality: maxQuality }
  }

  let low = minQuality
  let high = maxQuality
  let best = minQuality

  for (let i = 0; i < iterations; i += 1) {
    const quality = (low + high) / 2
    const sizeKb = measureSizeKb(input.estimateSizeKb, quality)
    if (sizeKb <= input.maxSizeKb) {
      best = quality
      low = quality
    } else {
      high = quality
    }
  }

  return { quality: best }
}
