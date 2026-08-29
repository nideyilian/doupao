import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { ApiProfile } from '../types'
import {
  DEFAULT_RESPONSES_MODEL,
  getActiveApiProfile,
  getAgentTextApiProfile,
  getApiProviderLabel,
} from '../lib/apiProfiles'
import { fetchAvailableModels, type AvailableModel } from '../lib/modelCatalog'
import {
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from '../design-system/icons'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

/**
 * 输入框内的一键模型切换器：
 * - 生图模型：列出全部 API 配置（profiles），点击切换 activeProfileId。
 * - 文本模型：列出 Agent 文本模型（agentProfile.model），可下拉已连接的模型目录，也可手动输入。
 * 点击底部「管理 API 配置」可进入设置页维护配置。
 */
export default function ModelSwitcher() {
  const settings = useStore((s) => s.settings)
  const appMode = useStore((s) => s.appMode)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const setShowSettings = useStore((s) => s.setShowSettings)

  const [open, setOpen] = useState(false)
  const [textModels, setTextModels] = useState<AvailableModel[] | null>(null)
  const [textModelsLoading, setTextModelsLoading] = useState(false)
  const [textModelsError, setTextModelsError] = useState<string | null>(null)
  const [manualModel, setManualModel] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useCloseOnEscape(open, close)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, close])

  const imageProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const textProfile = useMemo(() => getAgentTextApiProfile(settings), [settings])
  const currentTextModel = textProfile.model || DEFAULT_RESPONSES_MODEL

  // 打开时按当前文本连接拉取模型目录（失败不阻塞，可手动输入）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setTextModelsLoading(true)
    setTextModelsError(null)
    if (!textProfile.baseUrl.trim() || !textProfile.apiKey.trim()) {
      setTextModels(null)
      setTextModelsLoading(false)
      return
    }
    fetchAvailableModels(textProfile)
      .then((models) => {
        if (cancelled) return
        // 文本模型列表排除纯生图模型
        setTextModels(models.filter((model) => model.type !== 'image'))
      })
      .catch((error) => {
        if (cancelled) return
        setTextModelsError(error instanceof Error ? error.message : '获取模型列表失败')
        setTextModels(null)
      })
      .finally(() => {
        if (!cancelled) setTextModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, textProfile])

  const switchImageProfile = useCallback(
    (profileId: string) => {
      const profile = settings.profiles.find((item) => item.id === profileId)
      setSettings({ activeProfileId: profileId })
      showToast(`已切换生图配置：${profile?.name ?? profileId}（${profile?.model || '未配置模型'}）`, 'success')
      setOpen(false)
    },
    [settings.profiles, setSettings, showToast],
  )

  const switchTextModel = useCallback(
    (modelId: string) => {
      const id = modelId.trim()
      if (!id) return
      // 更新 agentProfiles 中当前激活项（agentProfile 是它的镜像，由 normalizeSettings 回填）
      const agentProfiles: ApiProfile[] = settings.agentProfiles.map((profile) =>
        profile.id === settings.activeAgentProfileId
          ? { ...profile, model: id, provider: 'openai', apiMode: 'responses' }
          : profile,
      )
      setSettings({ agentProfiles })
      showToast(`已切换文本模型：${id}`, 'success')
      setManualModel('')
      setOpen(false)
    },
    [settings.agentProfiles, settings.activeAgentProfileId, setSettings, showToast],
  )

  // 当前文本模型置顶，再追加目录模型（去重）
  const textModelOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    if (currentTextModel) {
      list.push(currentTextModel)
      seen.add(currentTextModel)
    }
    for (const model of textModels ?? []) {
      if (!seen.has(model.id)) {
        list.push(model.id)
        seen.add(model.id)
      }
    }
    return list
  }, [currentTextModel, textModels])

  // 文本配置显示名：独立配置用 agentProfile.name；共享连接时为「生图配置名 · Agent」
  const textConfigName =
    textProfile.name || (settings.agentShareApiParameters ? `${imageProfile.name} · Agent` : 'Agent 服务')

  const sectionHeaderClass = 'px-2 pb-1 pt-0.5 text-[13px] font-medium text-ds-muted dark:text-ds-muted'
  const listClass = 'max-h-48 overflow-y-auto custom-scrollbar'
  const itemBaseClass = 'flex w-full items-center gap-2 rounded-ds-lg px-2 py-1.5 text-left text-xs transition-colors'
  const itemActiveClass = 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
  const itemIdleClass = 'text-ds-text hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换模型"
        title={`生图：${imageProfile.name}（${imageProfile.model || '未配置'}） · 文本：${textConfigName}（${currentTextModel}）`}
        className={`inline-flex h-ds-control-md w-ds-control-md shrink-0 items-center justify-center rounded-ds-lg shadow-sm transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] ${
          open
            ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
            : 'bg-ds-subtle text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text'
        }`}
      >
        <SlidersHorizontalIcon className="h-[15px] w-[15px]" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="切换模型"
          className="absolute bottom-full left-0 z-dropdown mb-2 w-[340px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-ds-xl border border-ds-border/70 bg-ds-surface/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-ds-border dark:bg-ds-scrim/95 dark:ring-white/10"
        >
          <div className={sectionHeaderClass}>
            生图模型
            <span className="ml-1 font-normal text-ds-muted/80 dark:text-ds-muted/70">（按 API 配置）</span>
          </div>
          <div className={listClass}>
            {settings.profiles.map((profile) => {
              const active = profile.id === settings.activeProfileId
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-profile-id={profile.id}
                  onClick={() => switchImageProfile(profile.id)}
                  className={`${itemBaseClass} ${active ? itemActiveClass : itemIdleClass}`}
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted dark:text-ds-muted" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{profile.name}</span>
                    <span className="text-ds-muted dark:text-ds-muted"> · </span>
                    <span className="font-mono text-[13px] text-ds-text-subtle dark:text-ds-muted">
                      {profile.model || '未配置'}
                    </span>
                  </span>
                  <span className="shrink-0 rounded bg-ds-surface px-1.5 py-0.5 text-xs text-ds-muted dark:bg-ds-surface dark:text-ds-muted">
                    {getApiProviderLabel(settings, profile.provider)}
                  </span>
                  {active && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-primary" />}
                </button>
              )
            })}
          </div>

          <div className="mx-2 my-1.5 border-t border-ds-border/70 dark:border-ds-border" />

          <div className="flex items-center justify-between">
            <div className={sectionHeaderClass}>
              文本模型
              <span className="ml-1 font-normal text-ds-muted/80 dark:text-ds-muted/70">（{textConfigName}）</span>
            </div>
            {textModelsLoading && <Loader2Icon className="mr-2 h-3.5 w-3.5 animate-spin text-ds-muted" />}
          </div>
          <div className={listClass}>
            {textModelOptions.map((modelId) => {
              const active = modelId === currentTextModel
              return (
                <button
                  key={modelId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-text-model-id={modelId}
                  onClick={() => switchTextModel(modelId)}
                  className={`${itemBaseClass} ${active ? itemActiveClass : itemIdleClass}`}
                >
                  <TypeIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted dark:text-ds-muted" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{textConfigName}</span>
                    <span className="text-ds-muted dark:text-ds-muted"> · </span>
                    <span className="font-mono text-[13px] text-ds-text-subtle dark:text-ds-muted">{modelId}</span>
                  </span>
                  {active && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-primary" />}
                </button>
              )
            })}
            {!textModelsLoading && textModels && textModels.length === 0 && (
              <p className="px-2 py-1 text-[13px] text-ds-muted dark:text-ds-muted">
                未获取到模型列表，可手动输入模型 ID
              </p>
            )}
            {textModelsError && (
              <p className="px-2 py-1 text-[13px] text-ds-danger dark:text-ds-danger">{textModelsError}</p>
            )}
          </div>

          <form
            className="mt-1 flex items-center gap-1.5 px-1 pb-1"
            onSubmit={(event) => {
              event.preventDefault()
              switchTextModel(manualModel)
            }}
          >
            <input
              value={manualModel}
              onChange={(event) => setManualModel(event.target.value)}
              placeholder={`为「${textConfigName}」输入模型 ID，如 ${DEFAULT_RESPONSES_MODEL}`}
              aria-label="手动输入文本模型"
              title={`将切换到文本配置「${textConfigName}」的模型`}
              className="min-w-0 flex-1 rounded-ds-lg border border-ds-border/70 bg-ds-surface/55 px-2.5 py-1.5 text-xs text-ds-text outline-none transition placeholder:text-ds-muted focus:border-ds-primary/35 focus:ring-2 focus:ring-ds-focus/70 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/40 dark:focus:ring-ds-focus/10"
            />
            <button
              type="submit"
              disabled={!manualModel.trim()}
              className="shrink-0 rounded-ds-lg bg-ds-primary-subtle px-2.5 py-1.5 text-xs font-medium text-ds-primary transition-colors hover:bg-ds-primary-subtle disabled:cursor-not-allowed disabled:opacity-45 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
            >
              应用
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setShowSettings(true, appMode === 'agent' ? 'agent' : 'api')
              close()
            }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-ds-lg px-2 py-1.5 text-left text-xs font-medium text-ds-primary transition-colors hover:bg-ds-primary-subtle dark:text-ds-primary dark:hover:bg-ds-primary/10"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            管理 API 配置
          </button>
        </div>
      )}
    </div>
  )
}
