import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from './lib/desktopJsonStorage'

export type WatermarkAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface WatermarkTemplate {
  id: string
  name: string
  type: 'image' | 'text' | 'image-text'
  // 锚点对齐
  anchor: WatermarkAnchor
  // 相对大小 (占据原图较短边的百分比，如 8 表示 8%)
  scalePercent: number
  // 相对边距 (距离边缘的百分比，如 4 表示 4%)
  marginPercent: number

  // 图片属性
  logoUrl?: string

  // 文字属性
  text?: string
  textColor?: string
  fontSize?: number // 基准字号比例，内部换算
  fontFamily?: string
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number

  // 图文组合属性
  layout?: 'logo-left' | 'logo-top' // logo在左或logo在上
  gapPercent?: number // 图文间距百分比
}

export interface ExportRule {
  id: string
  name: string
  templateId: string // 绑定的水印模板

  // 尺寸控制
  resizeEnabled: boolean
  targetWidth: number | null
  targetHeight: number | null
  resizeMode: 'contain' | 'cover'

  // 压缩控制
  compressEnabled: boolean
  format: 'jpeg' | 'webp' | 'png'
  maxSizeKb: number | null

  // 路径控制
  outputDir: string // 绝对路径
  fileNamePattern: string // 命名模板，如 {date}-{image}-{rule}
}

export interface ExportGroup {
  id: string
  name: string
  ruleIds: string[] // 包含的规则ID列表
}

interface PostprocessState {
  templates: WatermarkTemplate[]
  rules: ExportRule[]
  groups: ExportGroup[]

  addTemplate: (template: Omit<WatermarkTemplate, 'id'>) => void
  updateTemplate: (id: string, updates: Partial<WatermarkTemplate>) => void
  deleteTemplate: (id: string) => void

  addRule: (rule: Omit<ExportRule, 'id'>) => void
  updateRule: (id: string, updates: Partial<ExportRule>) => void
  deleteRule: (id: string) => void

  addGroup: (group: Omit<ExportGroup, 'id'>) => void
  updateGroup: (id: string, updates: Partial<ExportGroup>) => void
  deleteGroup: (id: string) => void
}

const defaultTemplates: WatermarkTemplate[] = [
  {
    id: 'tpl-default-logo',
    name: '官方标志 (右下角)',
    type: 'image',
    anchor: 'bottom-right',
    scalePercent: 10,
    marginPercent: 4,
    logoUrl: './app-icon.png',
  },
  {
    id: 'tpl-default-text',
    name: '版权声明 (中下)',
    type: 'text',
    anchor: 'bottom-center',
    scalePercent: 6,
    marginPercent: 5,
    text: '豆泡官方出品',
    textColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,
    fontWeight: 700,
  },
]

export const usePostprocessStore = create<PostprocessState>()(
  persist(
    (set) => ({
      templates: defaultTemplates,
      rules: [],
      groups: [],

      addTemplate: (template) =>
        set((state) => ({
          templates: [...state.templates, { ...template, id: `tpl-${Date.now()}` }],
        })),
      updateTemplate: (id, updates) =>
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),
      deleteTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        })),

      addRule: (rule) =>
        set((state) => ({
          rules: [...state.rules, { ...rule, id: `rule-${Date.now()}` }],
        })),
      updateRule: (id, updates) =>
        set((state) => ({
          rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      deleteRule: (id) =>
        set((state) => ({
          rules: state.rules.filter((r) => r.id !== id),
        })),

      addGroup: (group) =>
        set((state) => ({
          groups: [...state.groups, { ...group, id: `group-${Date.now()}` }],
        })),
      updateGroup: (id, updates) =>
        set((state) => ({
          groups: state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
        })),
      deleteGroup: (id) =>
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id),
        })),
    }),
    {
      name: 'doupao-postprocess-storage',
      version: 1,
      storage: createDesktopJsonStorage('postprocess', {
        read: async () => localStorage.getItem('doupao-postprocess-storage'),
      }),
    },
  ),
)

export type PostprocessPersistedState = Pick<PostprocessState, 'templates' | 'rules' | 'groups'>

export function getPostprocessPersistedState(): PostprocessPersistedState {
  const { templates, rules, groups } = usePostprocessStore.getState()
  return { templates, rules, groups }
}

export function replacePostprocessPersistedState(snapshot: PostprocessPersistedState): void {
  usePostprocessStore.setState({
    templates: Array.isArray(snapshot.templates) ? snapshot.templates : [],
    rules: Array.isArray(snapshot.rules) ? snapshot.rules : [],
    groups: Array.isArray(snapshot.groups) ? snapshot.groups : [],
  })
}
