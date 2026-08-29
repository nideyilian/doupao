import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import tokens from './tokens.tokens.json'

// ---------------------------------------------------------------------------
// Design Token Contract — 锁定 tokens.tokens.json 中所有稳定基础 Token 的键名。
// 新增键必须在 CSS 和此处同时注册；删除键必须先确认无运行时引用。
// ---------------------------------------------------------------------------

const COLOR_KEYS = [
  'border',
  'border-strong',
  'canvas',
  'danger',
  'danger-hover',
  'danger-subtle',
  'focus',
  'info',
  'info-subtle',
  'primary',
  'primary-hover',
  'primary-subtle',
  'scrim',
  'selection-border',
  'selection-surface',
  'selection-text',
  'success',
  'success-subtle',
  'surface',
  'surface-raised',
  'surface-subtle',
  'text',
  'text-inverse',
  'text-muted',
  'text-subtle',
  'warning',
  'warning-hover',
  'warning-subtle',
]

const FONT_SIZE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']
const FONT_LINE_HEIGHT_KEYS = ['tight', 'normal', 'relaxed']
const FONT_WEIGHT_KEYS = ['regular', 'medium', 'semibold', 'bold']
const FONT_FAMILY_KEYS = ['sans', 'mono']

const SHADOW_KEYS = ['sm', 'md', 'lg', 'focus']

const CONTROL_KEYS = ['sm', 'md', 'lg']
const CONTENT_KEYS = ['xs', 'sm', 'md', 'lg']
const Z_INDEX_KEYS = ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'toast', 'tooltip', 'confirm']
const SPACE_KEYS = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12']
const RADIUS_KEYS = ['sm', 'md', 'lg', 'xl', '2xl', 'full']
const DURATION_KEYS = ['instant', 'fast', 'normal', 'slow']
const EASING_KEYS = ['out', 'in-out']

// ---------------------------------------------------------------------------
// Top-level groups
// ---------------------------------------------------------------------------
describe('Token contract — top-level groups', () => {
  const topLevel = Object.keys(tokens)
  const expected = ['color', 'font', 'shadow', 'control', 'content', 'z-index', 'space', 'radius', 'motion']

  it('has every expected top-level group', () => {
    expect(topLevel.sort()).toEqual(expected.sort())
  })

  it('has no extra top-level groups', () => {
    const extra = topLevel.filter((k) => !expected.includes(k))
    expect(extra).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------
describe('Token contract — color', () => {
  it('has $type "color"', () => {
    expect((tokens as Record<string, unknown>).color).toHaveProperty('$type', 'color')
  })

  it('has light and dark modes', () => {
    expect(Object.keys((tokens as Record<string, unknown>).color as Record<string, unknown>).sort()).toEqual(
      expect.arrayContaining(['light', 'dark']),
    )
  })

  it('light mode has every expected color key', () => {
    const colorGroup = (tokens as Record<string, unknown>).color as Record<string, unknown>
    const light = colorGroup.light as Record<string, unknown>
    expect(Object.keys(light).sort()).toEqual(COLOR_KEYS.sort())
  })

  it('dark mode has every expected color key', () => {
    const colorGroup = (tokens as Record<string, unknown>).color as Record<string, unknown>
    const dark = colorGroup.dark as Record<string, unknown>
    expect(Object.keys(dark).sort()).toEqual(COLOR_KEYS.sort())
  })

  it('every color token has a valid DTCG color value', () => {
    const colorGroup = (tokens as Record<string, unknown>).color as Record<string, unknown>
    for (const mode of ['light', 'dark']) {
      const modeColors = colorGroup[mode] as Record<string, unknown>
      for (const key of Object.keys(modeColors)) {
        const value = modeColors[key] as Record<string, unknown>
        expect(value).toHaveProperty('$value')
        const v = value.$value as Record<string, unknown>
        expect(v).toHaveProperty('colorSpace', 'srgb')
        expect(Array.isArray(v.components)).toBe(true)
        expect((v.components as number[]).length).toBe(3)
        expect(typeof v.hex).toBe('string')
        expect((v.hex as string).startsWith('#')).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------
describe('Token contract — font', () => {
  it('has font sub-groups', () => {
    const font = (tokens as Record<string, unknown>).font as Record<string, unknown>
    expect(Object.keys(font).sort()).toEqual(['family', 'line-height', 'size', 'weight'].sort())
  })

  describe('font.size', () => {
    it('has $type "fontSize"', () => {
      const size = ((tokens as Record<string, unknown>).font as Record<string, unknown>).size as Record<string, unknown>
      expect(size).toHaveProperty('$type', 'fontSize')
    })

    it('has every expected size key', () => {
      const size = ((tokens as Record<string, unknown>).font as Record<string, unknown>).size as Record<string, unknown>
      const keys = Object.keys(size).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(FONT_SIZE_KEYS.sort())
    })

    it('every size token has a valid dimension value', () => {
      const size = ((tokens as Record<string, unknown>).font as Record<string, unknown>).size as Record<string, unknown>
      for (const key of FONT_SIZE_KEYS) {
        const token = (size as Record<string, unknown>)[key] as Record<string, unknown>
        expect(token).toHaveProperty('$value')
        const v = token.$value as Record<string, unknown>
        expect(typeof v.value).toBe('number')
        expect(v.unit).toBe('rem')
      }
    })
  })

  describe('font.line-height', () => {
    it('has $type "lineHeight"', () => {
      const lh = ((tokens as Record<string, unknown>).font as Record<string, unknown>)['line-height'] as Record<
        string,
        unknown
      >
      expect(lh).toHaveProperty('$type', 'lineHeight')
    })

    it('has every expected line-height key', () => {
      const lh = ((tokens as Record<string, unknown>).font as Record<string, unknown>)['line-height'] as Record<
        string,
        unknown
      >
      const keys = Object.keys(lh).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(FONT_LINE_HEIGHT_KEYS.sort())
    })
  })

  describe('font.weight', () => {
    it('has $type "fontWeight"', () => {
      const w = ((tokens as Record<string, unknown>).font as Record<string, unknown>).weight as Record<string, unknown>
      expect(w).toHaveProperty('$type', 'fontWeight')
    })

    it('has every expected weight key', () => {
      const w = ((tokens as Record<string, unknown>).font as Record<string, unknown>).weight as Record<string, unknown>
      const keys = Object.keys(w).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(FONT_WEIGHT_KEYS.sort())
    })

    it('every weight token has a numeric value', () => {
      const w = ((tokens as Record<string, unknown>).font as Record<string, unknown>).weight as Record<string, unknown>
      for (const key of FONT_WEIGHT_KEYS) {
        const token = (w as Record<string, unknown>)[key] as Record<string, unknown>
        expect(typeof token.$value).toBe('number')
      }
    })
  })

  describe('font.family', () => {
    it('has $type "fontFamily"', () => {
      const f = ((tokens as Record<string, unknown>).font as Record<string, unknown>).family as Record<string, unknown>
      expect(f).toHaveProperty('$type', 'fontFamily')
    })

    it('has every expected family key', () => {
      const f = ((tokens as Record<string, unknown>).font as Record<string, unknown>).family as Record<string, unknown>
      const keys = Object.keys(f).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(FONT_FAMILY_KEYS.sort())
    })
  })
})

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------
describe('Token contract — shadow', () => {
  it('has $type "shadow"', () => {
    expect((tokens as Record<string, unknown>).shadow).toHaveProperty('$type', 'shadow')
  })

  it('has light and dark modes', () => {
    const shadow = (tokens as Record<string, unknown>).shadow as Record<string, unknown>
    expect(
      Object.keys(shadow)
        .filter((k) => k !== '$type')
        .sort(),
    ).toEqual(['dark', 'light'].sort())
  })

  it('light mode has every expected shadow key', () => {
    const shadow = (tokens as Record<string, unknown>).shadow as Record<string, unknown>
    const light = shadow.light as Record<string, unknown>
    expect(Object.keys(light).sort()).toEqual(SHADOW_KEYS.sort())
  })

  it('dark mode has every expected shadow key', () => {
    const shadow = (tokens as Record<string, unknown>).shadow as Record<string, unknown>
    const dark = shadow.dark as Record<string, unknown>
    expect(Object.keys(dark).sort()).toEqual(SHADOW_KEYS.sort())
  })

  it('every shadow token has a string value (CSS shadow)', () => {
    const shadow = (tokens as Record<string, unknown>).shadow as Record<string, unknown>
    for (const mode of ['light', 'dark']) {
      const modeShadows = shadow[mode] as Record<string, unknown>
      for (const key of SHADOW_KEYS) {
        const token = modeShadows[key] as Record<string, unknown>
        expect(token).toHaveProperty('$value')
        expect(typeof token.$value).toBe('string')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------
describe('Token contract — control', () => {
  it('has $type "dimension"', () => {
    expect((tokens as Record<string, unknown>).control).toHaveProperty('$type', 'dimension')
  })

  it('has every expected control size key', () => {
    const ctrl = (tokens as Record<string, unknown>).control as Record<string, unknown>
    const keys = Object.keys(ctrl).filter((k) => k !== '$type')
    expect(keys.sort()).toEqual(CONTROL_KEYS.sort())
  })
})

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
describe('Token contract — content', () => {
  it('has $type "dimension"', () => {
    expect((tokens as Record<string, unknown>).content).toHaveProperty('$type', 'dimension')
  })

  it('has every expected content width key', () => {
    const c = (tokens as Record<string, unknown>).content as Record<string, unknown>
    const keys = Object.keys(c).filter((k) => k !== '$type')
    expect(keys.sort()).toEqual(CONTENT_KEYS.sort())
  })
})

// ---------------------------------------------------------------------------
// z-index
// ---------------------------------------------------------------------------
describe('Token contract — z-index', () => {
  it('has $type "number"', () => {
    expect((tokens as Record<string, unknown>)['z-index']).toHaveProperty('$type', 'number')
  })

  it('has every expected z-index key', () => {
    const z = (tokens as Record<string, unknown>)['z-index'] as Record<string, unknown>
    const keys = Object.keys(z).filter((k) => k !== '$type')
    expect(keys.sort()).toEqual(Z_INDEX_KEYS.sort())
  })

  it('every z-index token has a numeric value', () => {
    const z = (tokens as Record<string, unknown>)['z-index'] as Record<string, unknown>
    for (const key of Z_INDEX_KEYS) {
      const token = (z as Record<string, unknown>)[key] as Record<string, unknown>
      expect(typeof token.$value).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------
describe('Token contract — space', () => {
  it('has $type "dimension"', () => {
    expect((tokens as Record<string, unknown>).space).toHaveProperty('$type', 'dimension')
  })

  it('has every expected space key', () => {
    const s = (tokens as Record<string, unknown>).space as Record<string, unknown>
    const keys = Object.keys(s).filter((k) => k !== '$type')
    expect(keys.sort()).toEqual(SPACE_KEYS.sort())
  })
})

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------
describe('Token contract — radius', () => {
  it('has $type "dimension"', () => {
    expect((tokens as Record<string, unknown>).radius).toHaveProperty('$type', 'dimension')
  })

  it('has every expected radius key (including full)', () => {
    const r = (tokens as Record<string, unknown>).radius as Record<string, unknown>
    const keys = Object.keys(r).filter((k) => k !== '$type')
    expect(keys.sort()).toEqual(RADIUS_KEYS.sort())
  })
})

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------
describe('Token contract — motion', () => {
  it('has duration and easing sub-groups', () => {
    const m = (tokens as Record<string, unknown>).motion as Record<string, unknown>
    expect(Object.keys(m).sort()).toEqual(['duration', 'easing'].sort())
  })

  describe('motion.duration', () => {
    it('has $type "duration"', () => {
      const d = ((tokens as Record<string, unknown>).motion as Record<string, unknown>).duration as Record<
        string,
        unknown
      >
      expect(d).toHaveProperty('$type', 'duration')
    })

    it('has every expected duration key (including instant)', () => {
      const d = ((tokens as Record<string, unknown>).motion as Record<string, unknown>).duration as Record<
        string,
        unknown
      >
      const keys = Object.keys(d).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(DURATION_KEYS.sort())
    })
  })

  describe('motion.easing', () => {
    it('has $type "cubicBezier"', () => {
      const e = ((tokens as Record<string, unknown>).motion as Record<string, unknown>).easing as Record<
        string,
        unknown
      >
      expect(e).toHaveProperty('$type', 'cubicBezier')
    })

    it('has every expected easing key', () => {
      const e = ((tokens as Record<string, unknown>).motion as Record<string, unknown>).easing as Record<
        string,
        unknown
      >
      const keys = Object.keys(e).filter((k) => k !== '$type')
      expect(keys.sort()).toEqual(EASING_KEYS.sort())
    })
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: no missing light/dark parity for color tokens
// ---------------------------------------------------------------------------
describe('Token contract — light/dark parity', () => {
  it('color light and dark have identical key sets', () => {
    const color = (tokens as Record<string, unknown>).color as Record<string, unknown>
    const lightKeys = Object.keys(color.light as Record<string, unknown>).sort()
    const darkKeys = Object.keys(color.dark as Record<string, unknown>).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('shadow light and dark have identical key sets', () => {
    const shadow = (tokens as Record<string, unknown>).shadow as Record<string, unknown>
    const lightKeys = Object.keys(shadow.light as Record<string, unknown>).sort()
    const darkKeys = Object.keys(shadow.dark as Record<string, unknown>).sort()
    expect(lightKeys).toEqual(darkKeys)
  })
})

// ===========================================================================
// CSS ↔ JSON Token Contract — 跨验证 styles.css 与 tokens.tokens.json
// ===========================================================================

// ---------------------------------------------------------------------------
// Generic CSS parser utilities
// ---------------------------------------------------------------------------

/** Read styles.css once and cache the parsed result. */
const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url))
const cssContent = readFileSync(cssPath, 'utf8')

/**
 * Extract the body of a top-level CSS rule by selector.
 * Finds the first occurrence of `selector` and returns everything between
 * the next `{` and its matching `}`.
 */
function extractBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector)
  if (idx < 0) throw new Error(`Missing selector: ${selector}`)
  const bodyStart = css.indexOf('{', idx)
  let depth = 0
  for (let i = bodyStart; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(bodyStart + 1, i)
    }
  }
  throw new Error(`Unclosed selector: ${selector}`)
}

/**
 * Parse CSS custom property declarations from a rule body.
 * Returns a record mapping the variable name (without `--`) to its value.
 */
function parseCssVariables(ruleBody: string): Record<string, string> {
  return Object.fromEntries(Array.from(ruleBody.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g), (m) => [m[1], m[2].trim()]))
}

// ---------------------------------------------------------------------------
// HSL → sRGB converter
// ---------------------------------------------------------------------------

/**
 * Convert a CSS HSL channel string (e.g. "210 20% 98%") to sRGB [0, 1] components.
 * Uses the standard CSS/sRGB conversion path.
 */
function hslToSrgb(hsl: string): [number, number, number] {
  const m = hsl.match(/^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/)
  if (!m) throw new Error(`Expected plain HSL channels, got "${hsl}"`)
  const h = ((Number(m[1]) % 360) + 360) % 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const mVal = l - c / 2
  let r: number, g: number, b: number
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + mVal, g + mVal, b + mVal]
}

// ---------------------------------------------------------------------------
// Dimension parser
// ---------------------------------------------------------------------------

/**
 * Parse a CSS dimension value like "0.25rem", "4px", "120ms", "0" into
 * its numeric value and unit.
 */
function parseDimensionCss(cssValue: string): { value: number; unit: string } | null {
  const m = cssValue.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem|ms|em|%|s)?$/)
  if (!m) return null
  return { value: Number(m[1]), unit: m[2] || '' }
}

// ---------------------------------------------------------------------------
// Parse CSS blocks
// ---------------------------------------------------------------------------

const rootVars = parseCssVariables(extractBlock(cssContent, ':root'))
const darkVars = parseCssVariables(extractBlock(cssContent, '.dark'))
/** Dark mode resolves against :root for any variable not explicitly set in .dark. */
const mergedDarkVars: Record<string, string> = { ...rootVars, ...darkVars }

// ---------------------------------------------------------------------------
// Color tolerance
// ---------------------------------------------------------------------------

/** Maximum per-channel sRGB [0,1] difference between CSS HSL→sRGB and JSON components. */
const COLOR_TOLERANCE = 0.015

// ===========================================================================
// CSS ↔ JSON: color
// ===========================================================================
describe('CSS ↔ JSON contract — color', () => {
  it('light mode: every HSL in CSS converts to sRGB that matches JSON components', () => {
    const colorGroup = (tokens as Record<string, unknown>).color as Record<string, unknown>
    const light = colorGroup.light as Record<string, unknown>
    for (const key of COLOR_KEYS) {
      const cssVar = rootVars[`ds-color-${key}`]
      expect(cssVar, `Missing CSS variable --ds-color-${key} in :root`).toBeTruthy()

      const [cr, cg, cb] = hslToSrgb(cssVar)
      const jsonToken = (light as Record<string, unknown>)[key] as Record<string, unknown>
      const comps = (jsonToken.$value as Record<string, unknown>).components as number[]

      expect(
        Math.abs(cr - comps[0]),
        `color.light.${key} R: CSS=${cr.toFixed(4)} JSON=${comps[0].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
      expect(
        Math.abs(cg - comps[1]),
        `color.light.${key} G: CSS=${cg.toFixed(4)} JSON=${comps[1].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
      expect(
        Math.abs(cb - comps[2]),
        `color.light.${key} B: CSS=${cb.toFixed(4)} JSON=${comps[2].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
    }
  })

  it('dark mode: every HSL in CSS converts to sRGB that matches JSON components', () => {
    const colorGroup = (tokens as Record<string, unknown>).color as Record<string, unknown>
    const dark = colorGroup.dark as Record<string, unknown>
    for (const key of COLOR_KEYS) {
      const cssVar = mergedDarkVars[`ds-color-${key}`]
      expect(cssVar, `Missing CSS variable --ds-color-${key} in .dark (or :root fallback)`).toBeTruthy()

      const [cr, cg, cb] = hslToSrgb(cssVar)
      const jsonToken = (dark as Record<string, unknown>)[key] as Record<string, unknown>
      const comps = (jsonToken.$value as Record<string, unknown>).components as number[]

      expect(
        Math.abs(cr - comps[0]),
        `color.dark.${key} R: CSS=${cr.toFixed(4)} JSON=${comps[0].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
      expect(
        Math.abs(cg - comps[1]),
        `color.dark.${key} G: CSS=${cg.toFixed(4)} JSON=${comps[1].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
      expect(
        Math.abs(cb - comps[2]),
        `color.dark.${key} B: CSS=${cb.toFixed(4)} JSON=${comps[2].toFixed(4)}`,
      ).toBeLessThan(COLOR_TOLERANCE)
    }
  })

  it('light mode: every CSS color variable has a corresponding JSON color entry', () => {
    const cssColorKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-color-'))
      .map((k) => k.replace('ds-color-', ''))
      .sort()
    expect(cssColorKeys).toEqual(COLOR_KEYS.sort())
  })

  it('dark mode: every CSS color variable has a corresponding JSON color entry', () => {
    const cssColorKeys = Object.keys(mergedDarkVars)
      .filter((k) => k.startsWith('ds-color-'))
      .map((k) => k.replace('ds-color-', ''))
      .sort()
    expect(cssColorKeys).toEqual(COLOR_KEYS.sort())
  })
})

// ===========================================================================
// CSS ↔ JSON: space
// ===========================================================================
describe('CSS ↔ JSON contract — space', () => {
  it('every CSS --ds-space-* value matches JSON space token (rem→px)', () => {
    const jsonSpace = (tokens as Record<string, unknown>).space as Record<string, unknown>
    for (const key of SPACE_KEYS) {
      const cssVar = rootVars[`ds-space-${key}`]
      expect(cssVar, `Missing CSS variable --ds-space-${key}`).toBeTruthy()

      const parsed = parseDimensionCss(cssVar)
      expect(parsed, `Could not parse CSS value "${cssVar}" for --ds-space-${key}`).not.toBeNull()
      // CSS stores space as rem; JSON stores as px.  Convert rem→px at 16px/rem.
      const cssPx = parsed!.unit === 'rem' ? parsed!.value * 16 : parsed!.value

      const jsonToken = (jsonSpace as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = (jsonToken.$value as Record<string, unknown>).value as number
      const jsonUnit = (jsonToken.$value as Record<string, unknown>).unit as string

      expect(jsonUnit).toBe('px')
      expect(cssPx, `space.${key}: CSS=${cssPx}px JSON=${jsonVal}px`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS ↔ JSON: radius
// ===========================================================================
describe('CSS ↔ JSON contract — radius', () => {
  it('every CSS --ds-radius-* value matches JSON radius token', () => {
    const jsonRadius = (tokens as Record<string, unknown>).radius as Record<string, unknown>
    for (const key of RADIUS_KEYS) {
      const cssVar = rootVars[`ds-radius-${key}`]
      expect(cssVar, `Missing CSS variable --ds-radius-${key}`).toBeTruthy()

      const parsed = parseDimensionCss(cssVar)
      expect(parsed, `Could not parse CSS value "${cssVar}" for --ds-radius-${key}`).not.toBeNull()

      const jsonToken = (jsonRadius as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = (jsonToken.$value as Record<string, unknown>).value as number
      const jsonUnit = (jsonToken.$value as Record<string, unknown>).unit as string

      // CSS uses rem for most, px for full; JSON uses px.
      const cssPx = parsed!.unit === 'rem' ? parsed!.value * 16 : parsed!.value

      expect(jsonUnit).toBe('px')
      expect(cssPx, `radius.${key}: CSS=${cssPx}px JSON=${jsonVal}px`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS ↔ JSON: control
// ===========================================================================
describe('CSS ↔ JSON contract — control', () => {
  it('every CSS --ds-control-* value matches JSON control token (both in rem)', () => {
    const jsonControl = (tokens as Record<string, unknown>).control as Record<string, unknown>
    for (const key of CONTROL_KEYS) {
      const cssVar = rootVars[`ds-control-${key}`]
      expect(cssVar, `Missing CSS variable --ds-control-${key}`).toBeTruthy()

      const parsed = parseDimensionCss(cssVar)
      expect(parsed, `Could not parse CSS value "${cssVar}" for --ds-control-${key}`).not.toBeNull()
      expect(parsed!.unit, `--ds-control-${key} unit should be rem`).toBe('rem')

      const jsonToken = (jsonControl as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = (jsonToken.$value as Record<string, unknown>).value as number
      const jsonUnit = (jsonToken.$value as Record<string, unknown>).unit as string

      expect(jsonUnit).toBe('rem')
      expect(parsed!.value, `control.${key}: CSS=${parsed!.value}rem JSON=${jsonVal}rem`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS ↔ JSON: content
// ===========================================================================
describe('CSS ↔ JSON contract — content', () => {
  it('every CSS --ds-content-* value matches JSON content token (both in rem)', () => {
    const jsonContent = (tokens as Record<string, unknown>).content as Record<string, unknown>
    for (const key of CONTENT_KEYS) {
      const cssVar = rootVars[`ds-content-${key}`]
      expect(cssVar, `Missing CSS variable --ds-content-${key}`).toBeTruthy()

      const parsed = parseDimensionCss(cssVar)
      expect(parsed, `Could not parse CSS value "${cssVar}" for --ds-content-${key}`).not.toBeNull()
      expect(parsed!.unit, `--ds-content-${key} unit should be rem`).toBe('rem')

      const jsonToken = (jsonContent as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = (jsonToken.$value as Record<string, unknown>).value as number
      const jsonUnit = (jsonToken.$value as Record<string, unknown>).unit as string

      expect(jsonUnit).toBe('rem')
      expect(parsed!.value, `content.${key}: CSS=${parsed!.value}rem JSON=${jsonVal}rem`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS ↔ JSON: z-index
// ===========================================================================
describe('CSS ↔ JSON contract — z-index', () => {
  it('every CSS --ds-z-* value matches JSON z-index token', () => {
    const jsonZ = (tokens as Record<string, unknown>)['z-index'] as Record<string, unknown>
    for (const key of Z_INDEX_KEYS) {
      const cssVar = rootVars[`ds-z-${key}`]
      expect(cssVar, `Missing CSS variable --ds-z-${key}`).toBeTruthy()

      const cssNum = Number(cssVar)
      expect(Number.isFinite(cssNum), `--ds-z-${key} should be a number, got "${cssVar}"`).toBe(true)

      const jsonToken = (jsonZ as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = jsonToken.$value as number

      expect(cssNum, `z-index.${key}: CSS=${cssNum} JSON=${jsonVal}`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS ↔ JSON: motion.duration
// ===========================================================================
describe('CSS ↔ JSON contract — motion.duration', () => {
  it('every CSS --ds-duration-* value matches JSON duration token (both in ms)', () => {
    const jsonDuration = ((tokens as Record<string, unknown>).motion as Record<string, unknown>).duration as Record<
      string,
      unknown
    >
    for (const key of DURATION_KEYS) {
      const cssVar = rootVars[`ds-duration-${key}`]
      expect(cssVar, `Missing CSS variable --ds-duration-${key}`).toBeTruthy()

      const parsed = parseDimensionCss(cssVar)
      expect(parsed, `Could not parse CSS value "${cssVar}" for --ds-duration-${key}`).not.toBeNull()
      expect(parsed!.unit, `--ds-duration-${key} unit should be ms`).toBe('ms')

      const jsonToken = (jsonDuration as Record<string, unknown>)[key] as Record<string, unknown>
      const jsonVal = (jsonToken.$value as Record<string, unknown>).value as number
      const jsonUnit = (jsonToken.$value as Record<string, unknown>).unit as string

      expect(jsonUnit).toBe('ms')
      expect(parsed!.value, `duration.${key}: CSS=${parsed!.value}ms JSON=${jsonVal}ms`).toBe(jsonVal)
    }
  })
})

// ===========================================================================
// CSS 数值契约 — 锁定 styles.css 中每个 Token 的精确 CSS 值
// 新增或修改 Token 必须在此同步更新。
// ===========================================================================

// ---------------------------------------------------------------------------
// 期望值字典
// ---------------------------------------------------------------------------

const LIGHT_COLOR_VALUES: Record<string, string> = {
  canvas: '210 20% 98%',
  surface: '0 0% 100%',
  'surface-subtle': '220 14% 96%',
  'surface-raised': '0 0% 100%',
  text: '220 15% 16%',
  'text-muted': '222 8% 42%',
  'text-subtle': '220 7% 54%',
  'text-inverse': '0 0% 100%',
  border: '220 11% 89%',
  'border-strong': '220 10% 76%',
  primary: '218 42% 46%',
  'primary-hover': '218 45% 39%',
  'primary-subtle': '218 28% 95%',
  success: '145 38% 36%',
  'success-subtle': '145 22% 95%',
  warning: '37 55% 38%',
  'warning-hover': '37 56% 31%',
  'warning-subtle': '38 32% 95%',
  danger: '0 48% 50%',
  'danger-hover': '0 50% 43%',
  'danger-subtle': '0 30% 96%',
  info: '199 45% 40%',
  'info-subtle': '199 26% 95%',
  focus: '218 48% 48%',
  'selection-surface': '210 15% 95%',
  'selection-border': '220 10% 76%',
  'selection-text': '222 13% 19%',
  scrim: '220 12% 8%',
}

const DARK_COLOR_VALUES: Record<string, string> = {
  canvas: '225 9% 9%',
  surface: '220 9% 13%',
  'surface-subtle': '220 7% 17%',
  'surface-raised': '220 8% 15%',
  text: '220 10% 94%',
  'text-muted': '218 7% 70%',
  'text-subtle': '220 6% 58%',
  'text-inverse': '220 15% 12%',
  border: '218 7% 24%',
  'border-strong': '220 7% 38%',
  primary: '216 48% 72%',
  'primary-hover': '216 50% 78%',
  'primary-subtle': '216 22% 24%',
  success: '145 40% 67%',
  'success-subtle': '145 20% 23%',
  warning: '38 55% 68%',
  'warning-hover': '38 56% 74%',
  'warning-subtle': '38 23% 23%',
  danger: '0 52% 72%',
  'danger-hover': '0 54% 79%',
  'danger-subtle': '0 24% 24%',
  info: '199 46% 70%',
  'info-subtle': '199 22% 24%',
  focus: '216 48% 72%',
  'selection-surface': '223 7% 19%',
  'selection-border': '219 7% 38%',
  'selection-text': '225 10% 92%',
}

const SPACE_CSS_VALUES: Record<string, string> = {
  '0': '0',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
}

const RADIUS_CSS_VALUES: Record<string, string> = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
}

const CONTROL_CSS_VALUES: Record<string, string> = {
  sm: '2rem',
  md: '2.25rem',
  lg: '2.5rem',
}

const CONTENT_CSS_VALUES: Record<string, string> = {
  xs: '20rem',
  sm: '30rem',
  md: '48rem',
  lg: '75rem',
}

const Z_INDEX_CSS_VALUES: Record<string, string> = {
  base: '0',
  sticky: '20',
  dropdown: '40',
  overlay: '80',
  modal: '90',
  toast: '100',
  tooltip: '110',
  confirm: '120',
}

const DURATION_CSS_VALUES: Record<string, string> = {
  instant: '0ms',
  fast: '120ms',
  normal: '180ms',
  slow: '240ms',
}

// ---------------------------------------------------------------------------
// CSS value contract — color
// ---------------------------------------------------------------------------
describe('CSS value contract — color', () => {
  describe('light mode', () => {
    it('has every expected color key', () => {
      const cssKeys = Object.keys(rootVars)
        .filter((k) => k.startsWith('ds-color-'))
        .map((k) => k.replace('ds-color-', ''))
        .sort()
      expect(cssKeys).toEqual(Object.keys(LIGHT_COLOR_VALUES).sort())
    })

    for (const [key, expected] of Object.entries(LIGHT_COLOR_VALUES)) {
      it(`--ds-color-${key} = "${expected}"`, () => {
        expect(rootVars[`ds-color-${key}`], `--ds-color-${key}`).toBe(expected)
      })
    }
  })

  describe('dark mode', () => {
    it('has every expected color key', () => {
      const cssKeys = Object.keys(darkVars)
        .filter((k) => k.startsWith('ds-color-'))
        .map((k) => k.replace('ds-color-', ''))
        .sort()
      expect(cssKeys).toEqual(Object.keys(DARK_COLOR_VALUES).sort())
    })

    for (const [key, expected] of Object.entries(DARK_COLOR_VALUES)) {
      it(`--ds-color-${key} = "${expected}"`, () => {
        expect(darkVars[`ds-color-${key}`], `--ds-color-${key}`).toBe(expected)
      })
    }
  })
})

// ---------------------------------------------------------------------------
// CSS value contract — space
// ---------------------------------------------------------------------------
describe('CSS value contract — space', () => {
  it('has every expected space key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-space-'))
      .map((k) => k.replace('ds-space-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(SPACE_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(SPACE_CSS_VALUES)) {
    it(`--ds-space-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-space-${key}`]).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// CSS value contract — radius
// ---------------------------------------------------------------------------
describe('CSS value contract — radius', () => {
  it('has every expected radius key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-radius-'))
      .map((k) => k.replace('ds-radius-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(RADIUS_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(RADIUS_CSS_VALUES)) {
    it(`--ds-radius-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-radius-${key}`]).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// CSS value contract — control
// ---------------------------------------------------------------------------
describe('CSS value contract — control', () => {
  it('has every expected control key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-control-'))
      .map((k) => k.replace('ds-control-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(CONTROL_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(CONTROL_CSS_VALUES)) {
    it(`--ds-control-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-control-${key}`]).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// CSS value contract — content
// ---------------------------------------------------------------------------
describe('CSS value contract — content', () => {
  it('has every expected content key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-content-'))
      .map((k) => k.replace('ds-content-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(CONTENT_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(CONTENT_CSS_VALUES)) {
    it(`--ds-content-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-content-${key}`]).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// CSS value contract — z-index
// ---------------------------------------------------------------------------
describe('CSS value contract — z-index', () => {
  it('has every expected z-index key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-z-'))
      .map((k) => k.replace('ds-z-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(Z_INDEX_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(Z_INDEX_CSS_VALUES)) {
    it(`--ds-z-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-z-${key}`]).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// CSS value contract — motion.duration
// ---------------------------------------------------------------------------
describe('CSS value contract — motion.duration', () => {
  it('has every expected duration key', () => {
    const cssKeys = Object.keys(rootVars)
      .filter((k) => k.startsWith('ds-duration-'))
      .map((k) => k.replace('ds-duration-', ''))
      .sort()
    expect(cssKeys).toEqual(Object.keys(DURATION_CSS_VALUES).sort())
  })

  for (const [key, expected] of Object.entries(DURATION_CSS_VALUES)) {
    it(`--ds-duration-${key} = "${expected}"`, () => {
      expect(rootVars[`ds-duration-${key}`]).toBe(expected)
    })
  }
})
