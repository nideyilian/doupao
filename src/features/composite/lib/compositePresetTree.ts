import type { CompositeCategory, CompositePage } from './compositeTypes'

function clonePage(page: CompositePage): CompositePage {
  return JSON.parse(JSON.stringify(page)) as CompositePage
}

export function getEnabledCompositePages(categories: CompositeCategory[]) {
  return categories.flatMap((category) => {
    if (!category.enabled) return []
    return category.pages.filter((page) => page.enabled).map((page) => ({ category, page }))
  })
}

export function duplicateCompositePage(page: CompositePage, nextId: string): CompositePage {
  const copy = clonePage(page)
  return {
    ...copy,
    id: nextId,
    name: `${page.name} 副本`,
    preset: {
      ...copy.preset,
      id: `preset-${nextId}`,
      name: `${page.preset.name} 副本`,
    },
  }
}

export function moveCompositePage(
  categories: CompositeCategory[],
  pageId: string,
  targetCategoryId: string,
  targetIndex: number,
): CompositeCategory[] {
  let movedPage: CompositePage | null = null
  const withoutPage = categories.map((category) => {
    const pages = category.pages.filter((page) => {
      if (page.id !== pageId) return true
      movedPage = page
      return false
    })
    return { ...category, pages }
  })

  if (!movedPage) return categories

  return withoutPage.map((category) => {
    if (category.id !== targetCategoryId) return category
    const pages = [...category.pages]
    const index = Math.max(0, Math.min(targetIndex, pages.length))
    pages.splice(index, 0, movedPage as CompositePage)
    return { ...category, pages }
  })
}
