import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SKIN_IDS } from './registry'

const skinsDirectory = fileURLToPath(new URL('./styles/skins/', import.meta.url))
const skinsEntry = readFileSync(fileURLToPath(new URL('./styles/skins.css', import.meta.url)), 'utf8')
const skinFileNames = readdirSync(skinsDirectory).filter((name) => name.endsWith('.css'))
const skinFiles = Object.fromEntries(
  skinFileNames.map((name) => [
    name.replace(/\.css$/, ''),
    readFileSync(fileURLToPath(new URL(`./styles/skins/${name}`, import.meta.url)), 'utf8'),
  ]),
)
const customSkinIds = SKIN_IDS.filter((id) => id !== 'default')

const REQUIRED_TOKENS = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'border',
  'input',
  'primary',
  'primary-foreground',
  'sidebar',
  'sidebar-foreground',
  'ds-color-canvas',
  'ds-color-surface',
  'ds-color-surface-subtle',
  'ds-color-surface-raised',
  'ds-color-text',
  'ds-color-text-muted',
  'ds-color-text-subtle',
  'ds-color-text-inverse',
  'ds-color-border',
  'ds-color-border-strong',
  'ds-color-primary',
  'ds-color-primary-hover',
  'ds-color-primary-subtle',
  'ds-color-primary-gradient',
  'ds-color-focus',
] as const

const LAYOUT_TOKEN_PATTERN =
  /--(?:ds-(?:space|control|content|z)-|safe-area-|app-header-offset|app-docked-|workspace-tabbar-|word-library-|agent-sidebar-)/

function getSkinCss(id: string): string {
  const css = skinFiles[id]
  if (!css) throw new Error(`Missing CSS file for skin "${id}"`)
  return css
}

function extractRule(css: string, selector: string): string {
  const selectorStart = css.indexOf(selector)
  if (selectorStart < 0) throw new Error(`Missing selector: ${selector}`)

  const bodyStart = css.indexOf('{', selectorStart)
  let depth = 0
  for (let index = bodyStart; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(bodyStart + 1, index)
    }
  }

  throw new Error(`Unclosed selector: ${selector}`)
}

function parseVariables(ruleBody: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(ruleBody.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g), (match) => [match[1], match[2].trim()]),
  )
}

type Rgb = readonly [number, number, number]

function hslToRgb(value: string): Rgb {
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/)
  if (!match) throw new Error(`Expected plain HSL channels, received "${value}"`)

  const hue = ((Number(match[1]) % 360) + 360) % 360
  const saturation = Number(match[2]) / 100
  const lightness = Number(match[3]) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const segment = hue / 60
  const offset = chroma * (1 - Math.abs((segment % 2) - 1))
  const base: Rgb =
    segment < 1
      ? [chroma, offset, 0]
      : segment < 2
        ? [offset, chroma, 0]
        : segment < 3
          ? [0, chroma, offset]
          : segment < 4
            ? [0, offset, chroma]
            : segment < 5
              ? [offset, 0, chroma]
              : [chroma, 0, offset]
  const matchLightness = lightness - chroma / 2
  return base.map((channel) => channel + matchLightness) as unknown as Rgb
}

function luminance(rgb: Rgb): number {
  const channels = rgb.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground: string, background: string): number {
  const first = luminance(hslToRgb(foreground))
  const second = luminance(hslToRgb(background))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function expectContrast(
  id: string,
  mode: string,
  foregroundName: string,
  foreground: string,
  backgroundName: string,
  background: string,
  minimum: number,
): void {
  const ratio = contrast(foreground, background)
  expect(ratio, `${id}/${mode}: ${foregroundName} on ${backgroundName} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
    minimum,
  )
}

describe('skin contract', () => {
  it('keeps registry, imports, and CSS files in sync', () => {
    const importedIds = Array.from(
      skinsEntry.matchAll(/@import\s+['"]\.\/skins\/([a-z0-9-]+)\.css['"]/g),
      (match) => match[1],
    )
    const fileIds = skinFileNames.map((name) => name.replace(/\.css$/, '')).filter((id) => id !== '_template')

    expect([...importedIds].sort()).toEqual([...SKIN_IDS].sort())
    expect([...fileIds].sort()).toEqual([...SKIN_IDS].sort())
  })

  it.each(customSkinIds)('%s provides both modes and does not override layout tokens', (id) => {
    const css = getSkinCss(id)
    const light = parseVariables(extractRule(css, `:root[data-skin='${id}']`))
    const dark = parseVariables(extractRule(css, `:root[data-skin='${id}'].dark`))

    for (const token of REQUIRED_TOKENS) {
      expect(light[token], `${id}/light missing --${token}`).toBeTruthy()
      expect(dark[token], `${id}/dark missing --${token}`).toBeTruthy()
    }

    expect(css).not.toMatch(LAYOUT_TOKEN_PATTERN)
    expect(css).not.toMatch(/@import\s+url\(/)
  })

  it.each(customSkinIds)('%s meets the checked WCAG contrast pairs', (id) => {
    const css = getSkinCss(id)

    for (const mode of ['light', 'dark'] as const) {
      const selector = mode === 'light' ? `:root[data-skin='${id}']` : `:root[data-skin='${id}'].dark`
      const tokens = parseVariables(extractRule(css, selector))

      for (const surface of [
        'ds-color-canvas',
        'ds-color-surface',
        'ds-color-surface-subtle',
        'ds-color-surface-raised',
      ]) {
        expectContrast(id, mode, 'text', tokens['ds-color-text'], surface, tokens[surface], 4.5)
      }
      expectContrast(id, mode, 'text-muted', tokens['ds-color-text-muted'], 'surface', tokens['ds-color-surface'], 4.5)
      expectContrast(
        id,
        mode,
        'text-subtle',
        tokens['ds-color-text-subtle'],
        'surface',
        tokens['ds-color-surface'],
        4.5,
      )
      for (const background of ['ds-color-primary', 'ds-color-primary-hover']) {
        expectContrast(id, mode, 'text-inverse', tokens['ds-color-text-inverse'], background, tokens[background], 4.5)
      }
      for (const background of ['ds-color-danger', 'ds-color-danger-hover']) {
        expectContrast(id, mode, 'text-inverse', tokens['ds-color-text-inverse'], background, tokens[background], 4.5)
      }
      expectContrast(id, mode, 'primary-foreground', tokens['primary-foreground'], 'primary', tokens.primary, 4.5)
      expectContrast(id, mode, 'focus', tokens['ds-color-focus'], 'surface', tokens['ds-color-surface'], 3)

      const gradientStops = Array.from(tokens['ds-color-primary-gradient'].matchAll(/hsl\(([^/)]+)\)/g), (match) =>
        match[1].trim(),
      )
      expect(gradientStops.length, `${id}/${mode}: gradient needs two HSL stops`).toBeGreaterThanOrEqual(2)
      for (const [index, stop] of gradientStops.entries()) {
        expectContrast(
          id,
          mode,
          'text-inverse',
          tokens['ds-color-text-inverse'],
          `primary-gradient[${index}]`,
          stop,
          4.5,
        )
      }
    }
  })

  it('keeps glass effects within the compositing budget', () => {
    const entryBackdropRules = skinsEntry.split(/\r?\n/).filter((line) => /^\s*backdrop-filter\s*:/.test(line))
    const glass = getSkinCss('glass')
    const glassBackdropRules = glass.split(/\r?\n/).filter((line) => /^\s*backdrop-filter\s*:/.test(line))

    expect(entryBackdropRules).toEqual([])
    expect(glass).not.toMatch(/body::before|@keyframes\s+glass-aurora/)
    expect(glass).not.toMatch(/\[data-exporting\]\s+\*/)
    expect(glassBackdropRules.length).toBeLessThanOrEqual(2)
  })
})
