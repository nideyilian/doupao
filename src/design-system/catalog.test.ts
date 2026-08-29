import { describe, expect, it } from 'vitest'
import { componentSpecs, interactionPatterns, legacyComponentCoverage, pageCoverage } from './catalog'

const projectUiModules = {
  ...import.meta.glob('../components/**/*.tsx'),
  ...import.meta.glob('../features/**/*.tsx'),
}

const projectRawModules: Record<string, string> = {
  ...import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../features/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
}

function getModuleSource(modulePath: string): string {
  return projectRawModules[`../${modulePath.replace(/^src\//, '')}`] ?? ''
}

function normalizeModulePath(path: string) {
  return `src/${path.replace('../', '').replaceAll('\\', '/')}`
}

describe('design system catalog coverage', () => {
  it('registers every authored UI module and no stale module', () => {
    const discovered = Object.keys(projectUiModules)
      .filter((path) => !path.endsWith('.test.tsx') && !path.endsWith('/icons.tsx'))
      .map(normalizeModulePath)
      .sort()
    const registered = legacyComponentCoverage.map((entry) => entry.module).sort()

    expect(registered).toEqual(discovered)
  })

  it('maps every legacy module to documented shared components', () => {
    const specNames = new Set(componentSpecs.map((spec) => spec.name))
    const unknownTargets = legacyComponentCoverage.flatMap((entry) =>
      entry.targets.filter((target) => !specNames.has(target)).map((target) => `${entry.module}: ${target}`),
    )

    expect(unknownTargets).toEqual([])
  })

  it('migrate-decision modules actually import from the design system', () => {
    const violations = legacyComponentCoverage
      .filter((entry) => entry.decision === 'migrate')
      .filter((entry) => !getModuleSource(entry.module).includes('design-system'))
      .map((entry) => entry.module)
    expect(violations).toEqual([])
  })

  it('keeps component names unique', () => {
    const names = componentSpecs.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('maps every interaction pattern recipe to documented shared components', () => {
    const specNames = new Set(componentSpecs.map((spec) => spec.name))
    const unknown = interactionPatterns.flatMap((pattern) =>
      pattern.recipe.filter((component) => !specNames.has(component)).map((component) => `${pattern.id}: ${component}`),
    )

    expect(unknown).toEqual([])
  })

  it('keeps interaction pattern ids and page coverage ids unique', () => {
    const patternIds = interactionPatterns.map((pattern) => pattern.id)
    expect(new Set(patternIds).size).toBe(patternIds.length)

    const pageIds = pageCoverage.map((page) => page.id)
    expect(new Set(pageIds).size).toBe(pageIds.length)
  })
})
