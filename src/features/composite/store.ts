import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import {
  createBlankCompositeCategory,
  createBlankCompositePage,
  createDefaultCompositeWorkspaceState,
} from './lib/compositeDefaults'
import { createBlankCompositeProduct, createCompositeProductSizeRule } from './lib/compositeProducts'
import { createDefaultCompositeOutputPresetGroups } from './lib/compositeOutputPresets'
import { duplicateCompositePage, moveCompositePage } from './lib/compositePresetTree'
import { duplicateWatermarkPreset } from './lib/compositeWatermarks'
import type {
  CompositeCategory,
  CompositeExportRecord,
  CompositeFsImage,
  CompositeLayer,
  CompositeOutputPresetGroup,
  CompositePage,
  CompositePreset,
  CompositeProduct,
  CompositeProductSizeRule,
  CompositeWatermarkGroup,
  CompositeWatermarkPreset,
} from './lib/compositeTypes'

type CompositeStoreState = {
  categories: CompositeCategory[]
  activeCategoryId: string
  activePageId: string
  products: CompositeProduct[]
  activeProductId: string
  watermarkPresets: CompositeWatermarkPreset[]
  watermarkGroups: CompositeWatermarkGroup[]
  outputPresetGroups: CompositeOutputPresetGroup[]
  iconLibraryPath: string
  iconLibraryAssets: CompositeFsImage[]
  exportRecords: CompositeExportRecord[]
  isExporting: boolean
  exportCompleted: number
  exportTotal: number
  setActivePage: (categoryId: string, pageId: string) => void
  addCategory: () => void
  updateCategory: (categoryId: string, patch: Partial<Omit<CompositeCategory, 'pages'>>) => void
  deleteCategory: (categoryId: string) => void
  addPage: (categoryId: string) => void
  duplicatePage: (categoryId: string, pageId: string) => void
  deletePage: (categoryId: string, pageId: string) => void
  updatePage: (categoryId: string, pageId: string, patch: Partial<Omit<CompositePage, 'preset'>>) => void
  movePage: (pageId: string, targetCategoryId: string, targetIndex: number) => void
  updateActivePreset: (updater: (preset: CompositePreset) => CompositePreset) => void
  updateLayer: (layerId: string, patch: Partial<CompositeLayer>) => void
  addLayer: (layer: CompositeLayer) => void
  deleteLayer: (layerId: string) => void
  moveLayer: (layerId: string, direction: 'up' | 'down') => void
  setActiveProduct: (productId: string) => void
  addProduct: () => void
  updateProduct: (productId: string, patch: Partial<CompositeProduct>) => void
  deleteProduct: (productId: string) => void
  addProductSizeRule: (productId: string) => void
  updateProductSizeRule: (productId: string, ruleId: string, patch: Partial<CompositeProductSizeRule>) => void
  deleteProductSizeRule: (productId: string, ruleId: string) => void
  addWatermarkPreset: (preset: CompositeWatermarkPreset) => void
  updateWatermarkPreset: (presetId: string, patch: Partial<CompositeWatermarkPreset>) => void
  duplicateWatermarkPreset: (presetId: string) => void
  deleteWatermarkPreset: (presetId: string) => void
  addWatermarkGroup: (group: CompositeWatermarkGroup) => void
  updateWatermarkGroup: (groupId: string, patch: Partial<CompositeWatermarkGroup>) => void
  deleteWatermarkGroup: (groupId: string) => void
  updateOutputPresetRule: (groupId: string, ruleId: string, patch: Partial<CompositeProductSizeRule>) => void
  setIconLibrary: (path: string, assets: CompositeFsImage[]) => void
  setExportProgress: (completed: number, total: number) => void
  setExporting: (isExporting: boolean) => void
  setExportRecords: (records: CompositeExportRecord[]) => void
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function findFirstPage(categories: CompositeCategory[]) {
  const category = categories[0]
  const page = category?.pages[0]
  return { category, page }
}

function findFirstProduct(products: CompositeProduct[]) {
  return products[0] ?? null
}

function normalizeActiveSelection(
  state: Pick<CompositeStoreState, 'categories' | 'activeCategoryId' | 'activePageId'>,
) {
  const activeCategory = state.categories.find((category) => category.id === state.activeCategoryId)
  const activePage = activeCategory?.pages.find((page) => page.id === state.activePageId)
  if (activeCategory && activePage) return { activeCategoryId: activeCategory.id, activePageId: activePage.id }
  const fallback = findFirstPage(state.categories)
  return {
    activeCategoryId: fallback.category?.id ?? '',
    activePageId: fallback.page?.id ?? '',
  }
}

function mapActivePreset(
  categories: CompositeCategory[],
  activeCategoryId: string,
  activePageId: string,
  updater: (preset: CompositePreset) => CompositePreset,
) {
  return categories.map((category) => {
    if (category.id !== activeCategoryId) return category
    return {
      ...category,
      pages: category.pages.map((page) =>
        page.id === activePageId ? { ...page, preset: updater(page.preset) } : page,
      ),
    }
  })
}

const initialState = createDefaultCompositeWorkspaceState()

export const useCompositeStore = create<CompositeStoreState>()(
  persist(
    (set) => ({
      ...initialState,
      isExporting: false,
      exportCompleted: 0,
      exportTotal: 0,
      setActivePage: (categoryId, pageId) => set({ activeCategoryId: categoryId, activePageId: pageId }),
      addCategory: () =>
        set((state) => {
          const category = createBlankCompositeCategory(makeId('category'), `类目 ${state.categories.length + 1}`)
          return {
            categories: [...state.categories, category],
            activeCategoryId: category.id,
            activePageId: category.pages[0]?.id ?? '',
          }
        }),
      updateCategory: (categoryId, patch) =>
        set((state) => ({
          categories: state.categories.map((category) =>
            category.id === categoryId ? { ...category, ...patch } : category,
          ),
        })),
      deleteCategory: (categoryId) =>
        set((state) => {
          const categories = state.categories.filter((category) => category.id !== categoryId)
          const fallback = categories.length
            ? categories
            : [createBlankCompositeCategory('category-default', '默认合成')]
          return { categories: fallback, ...normalizeActiveSelection({ ...state, categories: fallback }) }
        }),
      addPage: (categoryId) =>
        set((state) => {
          let nextPageId = state.activePageId
          const categories = state.categories.map((category) => {
            if (category.id !== categoryId) return category
            const page = createBlankCompositePage(makeId('page'), `页面 ${category.pages.length + 1}`)
            nextPageId = page.id
            return { ...category, pages: [...category.pages, page] }
          })
          return { categories, activeCategoryId: categoryId, activePageId: nextPageId }
        }),
      duplicatePage: (categoryId, pageId) =>
        set((state) => {
          let nextPageId = state.activePageId
          const categories = state.categories.map((category) => {
            if (category.id !== categoryId) return category
            const page = category.pages.find((item) => item.id === pageId)
            if (!page) return category
            const copy = duplicateCompositePage(page, makeId('page'))
            nextPageId = copy.id
            return { ...category, pages: [...category.pages, copy] }
          })
          return { categories, activeCategoryId: categoryId, activePageId: nextPageId }
        }),
      deletePage: (categoryId, pageId) =>
        set((state) => {
          const categories = state.categories.map((category) => {
            if (category.id !== categoryId) return category
            const pages = category.pages.filter((page) => page.id !== pageId)
            return { ...category, pages: pages.length ? pages : [createBlankCompositePage(makeId('page'), '默认页面')] }
          })
          return { categories, ...normalizeActiveSelection({ ...state, categories }) }
        }),
      updatePage: (categoryId, pageId, patch) =>
        set((state) => ({
          categories: state.categories.map((category) =>
            category.id !== categoryId
              ? category
              : {
                  ...category,
                  pages: category.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
                },
          ),
        })),
      movePage: (pageId, targetCategoryId, targetIndex) =>
        set((state) => ({
          categories: moveCompositePage(state.categories, pageId, targetCategoryId, targetIndex),
          activeCategoryId: targetCategoryId,
          activePageId: pageId,
        })),
      updateActivePreset: (updater) =>
        set((state) => ({
          categories: mapActivePreset(state.categories, state.activeCategoryId, state.activePageId, updater),
        })),
      updateLayer: (layerId, patch) =>
        set((state) => ({
          categories: mapActivePreset(state.categories, state.activeCategoryId, state.activePageId, (preset) => ({
            ...preset,
            layers: preset.layers.map((layer) =>
              layer.id === layerId ? ({ ...layer, ...patch } as CompositeLayer) : layer,
            ),
          })),
        })),
      addLayer: (layer) =>
        set((state) => ({
          categories: mapActivePreset(state.categories, state.activeCategoryId, state.activePageId, (preset) => ({
            ...preset,
            layers: [...preset.layers, layer],
          })),
        })),
      deleteLayer: (layerId) =>
        set((state) => ({
          categories: mapActivePreset(state.categories, state.activeCategoryId, state.activePageId, (preset) => ({
            ...preset,
            layers: preset.layers.filter((layer) => layer.id !== layerId || layer.type === 'background'),
          })),
        })),
      moveLayer: (layerId, direction) =>
        set((state) => ({
          categories: mapActivePreset(state.categories, state.activeCategoryId, state.activePageId, (preset) => {
            const index = preset.layers.findIndex((layer) => layer.id === layerId)
            if (index < 0 || preset.layers[index]?.type === 'background') return preset
            const targetIndex = direction === 'up' ? index + 1 : index - 1
            if (targetIndex <= 0 || targetIndex >= preset.layers.length) return preset
            const layers = [...preset.layers]
            const [layer] = layers.splice(index, 1)
            layers.splice(targetIndex, 0, layer)
            return { ...preset, layers }
          }),
        })),
      setActiveProduct: (productId) => set({ activeProductId: productId }),
      addProduct: () =>
        set((state) => {
          const product = createBlankCompositeProduct(makeId('product'), `产品 ${state.products.length + 1}`)
          product.templateCategoryId = state.activeCategoryId
          product.templatePageId = state.activePageId
          return { products: [...state.products, product], activeProductId: product.id }
        }),
      updateProduct: (productId, patch) =>
        set((state) => ({
          products: state.products.map((product) => (product.id === productId ? { ...product, ...patch } : product)),
        })),
      deleteProduct: (productId) =>
        set((state) => {
          const products = state.products.filter((product) => product.id !== productId)
          const fallback = products.length ? products : [createBlankCompositeProduct('product-default', '默认产品')]
          return { products: fallback, activeProductId: findFirstProduct(fallback)?.id ?? '' }
        }),
      addProductSizeRule: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  sizeRules: [
                    ...product.sizeRules,
                    createCompositeProductSizeRule(makeId('size'), `尺寸 ${product.sizeRules.length + 1}`),
                  ],
                }
              : product,
          ),
        })),
      updateProductSizeRule: (productId, ruleId, patch) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  sizeRules: product.sizeRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
                }
              : product,
          ),
        })),
      deleteProductSizeRule: (productId, ruleId) =>
        set((state) => ({
          products: state.products.map((product) => {
            if (product.id !== productId) return product
            const sizeRules = product.sizeRules.filter((rule) => rule.id !== ruleId)
            return {
              ...product,
              sizeRules: sizeRules.length
                ? sizeRules
                : [createCompositeProductSizeRule(`${product.id}-main`, '主尺寸输出')],
            }
          }),
        })),
      addWatermarkPreset: (preset) =>
        set((state) => ({
          watermarkPresets: [...state.watermarkPresets, preset],
        })),
      updateWatermarkPreset: (presetId, patch) =>
        set((state) => ({
          watermarkPresets: state.watermarkPresets.map((preset) =>
            preset.id === presetId ? { ...preset, ...patch } : preset,
          ),
        })),
      duplicateWatermarkPreset: (presetId) =>
        set((state) => {
          const preset = state.watermarkPresets.find((item) => item.id === presetId)
          if (!preset) return {}
          const copy = duplicateWatermarkPreset(preset, makeId('watermark'))
          return {
            watermarkPresets: [...state.watermarkPresets, copy],
            products: state.products.map((product) => ({
              ...product,
              selectedWatermarkPresetIds: [...product.selectedWatermarkPresetIds, copy.id],
            })),
          }
        }),
      deleteWatermarkPreset: (presetId) =>
        set((state) => ({
          watermarkPresets: state.watermarkPresets.filter((preset) => preset.id !== presetId),
          watermarkGroups: state.watermarkGroups.map((group) => ({
            ...group,
            presetIds: group.presetIds.filter((id) => id !== presetId),
          })),
          products: state.products.map((product) => ({
            ...product,
            selectedWatermarkPresetIds: product.selectedWatermarkPresetIds.filter((id) => id !== presetId),
          })),
        })),
      addWatermarkGroup: (group) =>
        set((state) => ({
          watermarkGroups: [...state.watermarkGroups, group],
        })),
      updateWatermarkGroup: (groupId, patch) =>
        set((state) => ({
          watermarkGroups: state.watermarkGroups.map((group) =>
            group.id === groupId ? { ...group, ...patch } : group,
          ),
        })),
      deleteWatermarkGroup: (groupId) =>
        set((state) => ({
          watermarkGroups: state.watermarkGroups.filter((group) => group.id !== groupId),
          products: state.products.map((product) => ({
            ...product,
            selectedWatermarkGroupIds: product.selectedWatermarkGroupIds.filter((id) => id !== groupId),
          })),
        })),
      updateOutputPresetRule: (groupId, ruleId, patch) =>
        set((state) => ({
          outputPresetGroups: (state.outputPresetGroups?.length
            ? state.outputPresetGroups
            : createDefaultCompositeOutputPresetGroups()
          ).map((group) =>
            group.id === groupId
              ? { ...group, rules: group.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) }
              : group,
          ),
        })),
      setIconLibrary: (path, assets) => set({ iconLibraryPath: path, iconLibraryAssets: assets }),
      setExportProgress: (completed, total) => set({ exportCompleted: completed, exportTotal: total }),
      setExporting: (isExporting) => set({ isExporting }),
      setExportRecords: (exportRecords) => set({ exportRecords }),
    }),
    {
      name: 'doupao-composite-workspace-storage',
      version: 1,
      storage: createDesktopJsonStorage('compositeWorkspace', {
        read: async () => localStorage.getItem('doupao-composite-workspace-storage'),
      }),
      partialize: (state) => ({
        categories: state.categories,
        activeCategoryId: state.activeCategoryId,
        activePageId: state.activePageId,
        products: state.products,
        activeProductId: state.activeProductId,
        watermarkPresets: state.watermarkPresets,
        watermarkGroups: state.watermarkGroups,
        outputPresetGroups: state.outputPresetGroups,
        iconLibraryPath: state.iconLibraryPath,
        exportRecords: state.exportRecords,
      }),
    },
  ),
)

export function getActiveCompositePage(
  state: Pick<CompositeStoreState, 'categories' | 'activeCategoryId' | 'activePageId'>,
) {
  const category = state.categories.find((item) => item.id === state.activeCategoryId)
  const page = category?.pages.find((item) => item.id === state.activePageId)
  return { category: category ?? null, page: page ?? null }
}
