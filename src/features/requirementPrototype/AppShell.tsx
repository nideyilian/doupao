import { useState, type ReactNode } from 'react'
import {
  BarChart3Icon as BarChart3,
  BookOpenCheckIcon as BookOpenCheck,
  CircleUserRoundIcon as CircleUserRound,
  ClipboardPlusIcon as ClipboardPlus,
  Clock3Icon as Clock3,
  DatabaseIcon as Database,
  FolderOpenIcon as FolderOpen,
  ImageIcon,
  Layers3Icon as Layers3,
  ListChecksIcon as ListChecks,
  LogOutIcon as LogOut,
  PlusIcon as Plus,
  SaveIcon as Save,
  Settings2Icon as Settings2,
  ShieldCheckIcon as ShieldCheck,
  SparklesIcon as Sparkles,
  UsersIcon as Users,
  WrenchIcon as Wrench,
  ZapIcon as Zap,
} from '../../design-system/icons'
import { analyzeKnowledgeFolder } from './knowledgeAnalysis'
import StrategyWorkspace from '../strategy/adapters/RequirementStrategyWorkspace'
import {
  RequirementOrderingCreatePage,
  RequirementOrderingHistoryPage,
} from '../ordering/adapters/RequirementOrderingWorkspace'
import { useRequirementPrototype } from './store'
import type { CatalogChannel, CatalogMaterialType, CatalogProduct, RequirementRole, RequirementRoute } from './types'

const roleLabel: Record<RequirementRole, string> = {
  optimizer: '信息流优化师',
  strategist: '策略师',
  admin: '管理员',
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-ds-xl border border-ds-border bg-ds-surface shadow-sm dark:border-ds-border-strong dark:bg-ds-scrim ${className}`}
    >
      {children}
    </section>
  )
}

function LoginPage() {
  const login = useRequirementPrototype((state) => state.login)
  const [username, setUsername] = useState('optimizer')
  const [password, setPassword] = useState('demo123')
  const [error, setError] = useState('')

  const submit = () => {
    const result = login(username, password)
    setError(result.error ?? '')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ds-surface p-6 dark:bg-ds-scrim">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="border-b border-ds-border bg-ds-primary px-8 py-7 text-ds-text-inverse dark:border-ds-border-strong">
          <div className="mb-3 flex h-ds-control-lg w-ds-control-lg items-center justify-center rounded-ds-lg bg-ds-surface/15">
            <Sparkles size={23} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold">广告素材需求中心</h1>
          <p className="mt-2 text-sm text-ds-primary">本地原型 · 需求下单、策略与知识库</p>
        </div>
        <div className="space-y-5 p-8">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ds-text dark:text-ds-text-subtle">账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-ds-control-lg w-full rounded-ds-lg border border-ds-border bg-ds-surface px-3 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ds-text dark:text-ds-text-subtle">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
              className="h-ds-control-lg w-full rounded-ds-lg border border-ds-border bg-ds-surface px-3 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim"
            />
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-ds-danger-subtle px-3 py-2 text-sm text-ds-danger dark:bg-ds-danger/40 dark:text-ds-danger"
            >
              {error}
            </p>
          )}
          <button
            onClick={submit}
            className="h-ds-control-lg w-full rounded-ds-lg bg-ds-primary font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover focus:outline-none focus:ring-2 focus:ring-ds-focus focus:ring-offset-2"
          >
            登录
          </button>
          <div>
            <p className="mb-2 text-xs text-ds-muted">模拟账号（密码均为 demo123）</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['optimizer', '优化师'],
                ['strategist', '策略师'],
                ['admin', '管理员'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setUsername(value)
                    setPassword('demo123')
                    setError('')
                  }}
                  className={`rounded-lg border px-2 py-2 text-xs ${username === value ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/40 dark:text-ds-primary' : 'border-ds-border text-ds-muted hover:bg-ds-subtle dark:border-ds-border-strong dark:text-ds-muted dark:hover:bg-ds-subtle'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function LegacyStrategyPage() {
  const userId = useRequirementPrototype((state) => state.sessionUserId)
  const users = useRequirementPrototype((state) => state.users)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const drafts = useRequirementPrototype((state) => state.strategyDrafts)
  const versions = useRequirementPrototype((state) => state.strategyVersions)
  const saveDraft = useRequirementPrototype((state) => state.saveStrategyDraft)
  const submitDraft = useRequirementPrototype((state) => state.submitStrategyDraft)
  const publishDraft = useRequirementPrototype((state) => state.publishStrategyDraft)
  const rollback = useRequirementPrototype((state) => state.rollbackMaterialType)
  const createStrategyTest = useRequirementPrototype((state) => state.createStrategyTest)
  const saveMaterialType = useRequirementPrototype((state) => state.saveMaterialType)
  const user = users.find((item) => item.id === userId)
  const [selectedId, setSelectedId] = useState(catalog.materialTypes[0]?.id ?? '')
  const selected = catalog.materialTypes.find((item) => item.id === selectedId)
  const storedDraft = selected ? drafts[selected.id] : undefined
  const [summary, setSummary] = useState('')
  const [strategy, setStrategy] = useState('')
  const [rules, setRules] = useState('')
  const [ratios, setRatios] = useState<Array<'16:9' | '9:16'>>(['16:9', '9:16'])
  const [testMessage, setTestMessage] = useState('')

  const load = (materialType: CatalogMaterialType) => {
    const draft = drafts[materialType.id]
    setSelectedId(materialType.id)
    setSummary(draft?.summary ?? materialType.summary)
    setStrategy(draft?.strategy ?? materialType.strategy)
    setRules((draft?.fixedRules ?? materialType.fixedRules ?? []).join('\n'))
    setRatios(draft?.supportedRatios ?? materialType.supportedRatios ?? ['16:9', '9:16'])
  }

  if (!selected) return null
  const currentSummary = summary || storedDraft?.summary || selected.summary
  const currentStrategy = strategy || storedDraft?.strategy || selected.strategy
  const currentRules = rules || (storedDraft?.fixedRules ?? selected.fixedRules ?? []).join('\n')

  const save = () =>
    saveDraft({
      materialTypeId: selected.id,
      baseVersion: selected.version,
      summary: currentSummary,
      strategy: currentStrategy,
      fixedRules: currentRules
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      supportedRatios: ratios,
      status: 'draft',
    })

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="self-start overflow-hidden">
        <div className="border-b border-ds-border p-4 dark:border-ds-border-strong">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">生图策略与固定规则</h2>
            <button
              onClick={() => {
                const created: CatalogMaterialType = {
                  id: `type-${Date.now()}`,
                  name: '新素材类型',
                  summary: '请补充方向说明',
                  mode: 'intelligent',
                  strategy: '请补充生图策略',
                  color: 'from-blue-500 to-cyan-500',
                  published: false,
                  version: 1,
                }
                saveMaterialType(created)
                load(created)
              }}
              className="rounded-lg border border-ds-border p-1.5 hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
              title="新增素材类型"
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="mt-1 text-xs text-ds-muted">优化师只会使用已发布版本。</p>
        </div>
        {catalog.materialTypes.map((item) => (
          <button
            key={item.id}
            onClick={() => load(item)}
            className={`flex w-full items-center justify-between border-b border-ds-border p-4 text-left dark:border-ds-border-strong ${item.id === selected.id ? 'bg-ds-primary-subtle dark:bg-ds-primary-subtle/20' : 'hover:bg-ds-subtle dark:hover:bg-ds-subtle'}`}
          >
            <span>
              <span className="block text-sm font-medium">{item.name}</span>
              <span className="mt-1 block text-xs text-ds-muted">
                {item.mode === 'fixed' ? '固定规则' : '智能策略'} · v{item.version}
              </span>
            </span>
            {drafts[item.id] && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${drafts[item.id].status === 'review' ? 'bg-ds-warning-subtle text-ds-warning' : 'bg-ds-surface text-ds-muted dark:bg-ds-subtle dark:text-ds-muted'}`}
              >
                {drafts[item.id].status === 'review' ? '待审核' : '草稿'}
              </span>
            )}
          </button>
        ))}
      </Card>
      <div className="space-y-5">
        <Card className="p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="mt-1 text-sm text-ds-muted">
                当前线上版本 v{selected.version} · {selected.mode === 'fixed' ? '固定规则' : '智能差异化'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  saveMaterialType({ ...selected, archived: !selected.archived, version: selected.version + 1 })
                }
                className="rounded-lg border border-ds-danger/35 px-3 py-2 text-sm text-ds-danger hover:bg-ds-danger-subtle dark:border-ds-danger dark:hover:bg-ds-danger/30"
              >
                {selected.archived ? '恢复类型' : '删除类型'}
              </button>
              <button
                onClick={save}
                className="flex items-center gap-2 rounded-lg border border-ds-border px-3 py-2 text-sm hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
              >
                <Save size={15} />
                保存草稿
              </button>
              <button
                onClick={() => {
                  save()
                  const result = createStrategyTest(selected.id)
                  setTestMessage(result.error ?? '')
                }}
                className="rounded-lg border border-ds-primary/35 px-3 py-2 text-sm text-ds-primary hover:bg-ds-primary-subtle dark:border-ds-primary dark:text-ds-primary dark:hover:bg-ds-primary/30"
              >
                测试生成 1 张
              </button>
              {storedDraft?.status !== 'review' && (
                <button
                  onClick={() => {
                    save()
                    submitDraft(selected.id)
                  }}
                  className="rounded-lg bg-ds-primary px-3 py-2 text-sm text-ds-text-inverse hover:bg-ds-primary-hover"
                >
                  提交审核
                </button>
              )}
              {user?.role === 'admin' && storedDraft?.status === 'review' && (
                <button
                  onClick={() => publishDraft(selected.id)}
                  className="rounded-lg bg-ds-success px-3 py-2 text-sm text-ds-text-inverse hover:bg-ds-success-hover"
                >
                  审核并发布
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-4">
            {testMessage && (
              <p className="rounded-lg bg-ds-danger-subtle px-3 py-2 text-sm text-ds-danger dark:bg-ds-danger/30 dark:text-ds-danger">
                {testMessage}
              </p>
            )}
            <label>
              <span className="mb-2 block text-sm font-medium">方向说明</span>
              <input
                value={currentSummary}
                onChange={(event) => setSummary(event.target.value)}
                className="h-ds-control-lg w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
              />
            </label>
            <label>
              <span className="mb-2 block text-sm font-medium">生图策略</span>
              <textarea
                value={currentStrategy}
                onChange={(event) => setStrategy(event.target.value)}
                className="min-h-28 w-full rounded-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 dark:border-ds-border-strong dark:bg-ds-scrim"
              />
            </label>
            {selected.mode === 'fixed' && (
              <>
                <label>
                  <span className="mb-2 block text-sm font-medium">固定生图规范（每行一条）</span>
                  <textarea
                    value={currentRules}
                    onChange={(event) => setRules(event.target.value)}
                    className="min-h-44 w-full rounded-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 dark:border-ds-border-strong dark:bg-ds-scrim"
                  />
                </label>
                <div>
                  <span className="mb-2 block text-sm font-medium">支持尺寸</span>
                  <div className="flex gap-2">
                    {(['16:9', '9:16'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() =>
                          setRatios((current) =>
                            current.includes(ratio) ? current.filter((item) => item !== ratio) : [...current, ratio],
                          )
                        }
                        className={`rounded-lg border px-4 py-2 text-sm ${ratios.includes(ratio) ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border dark:border-ds-border-strong'}`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
        {user?.role === 'admin' && (versions[selected.id]?.length ?? 0) > 0 && (
          <Card className="p-5">
            <h3 className="font-semibold">版本历史</h3>
            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {versions[selected.id].map((version) => (
                <div key={version.version} className="flex items-center justify-between py-3 text-sm">
                  <span>
                    v{version.version} · {version.summary}
                  </span>
                  <button
                    onClick={() => rollback(selected.id, version.version)}
                    className="rounded-lg border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
                  >
                    回滚为新版本
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function KnowledgePage() {
  const catalog = useRequirementPrototype((state) => state.catalog)
  const batches = useRequirementPrototype((state) => state.knowledgeBatches)
  const insights = useRequirementPrototype((state) => state.knowledgeInsights)
  const addBatch = useRequirementPrototype((state) => state.addKnowledgeBatch)
  const updateBatch = useRequirementPrototype((state) => state.updateKnowledgeBatch)
  const replaceInsights = useRequirementPrototype((state) => state.replaceKnowledgeInsights)
  const [folderPath, setFolderPath] = useState('')
  const [fileCount, setFileCount] = useState(0)
  const [productId, setProductId] = useState(catalog.products[0]?.id ?? '')
  const [channelId, setChannelId] = useState(catalog.channels[0]?.id ?? '')
  const [materialTypeId, setMaterialTypeId] = useState('')
  const [error, setError] = useState('')

  const chooseFolder = async () => {
    const path = await window.electronAPI?.selectDirectory?.()
    if (!path) return
    setFolderPath(path)
    try {
      const files = window.electronAPI?.listCompositeBackgroundFiles
        ? await window.electronAPI.listCompositeBackgroundFiles(path, true)
        : await window.electronAPI?.listImageFiles?.(path)
      setFileCount(files?.length ?? 0)
      setError('')
    } catch (reason) {
      setFileCount(0)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const create = () => {
    if (!folderPath || fileCount === 0) {
      setError('请选择至少包含一张 JPG、PNG 或 WebP 图片的文件夹')
      return
    }
    addBatch({
      name: `素材沉淀 ${formatDate(Date.now())}`,
      folderPath,
      productId,
      channelId,
      materialTypeId: materialTypeId || undefined,
      fileCount,
      status: 'ready',
      analyzedCount: 0,
      stableInsights: 0,
      exploratoryInsights: 0,
    })
    setError('')
  }

  const analyze = async (batchId: string) => {
    const batch = batches.find((item) => item.id === batchId)
    if (!batch) return
    updateBatch(batchId, { status: 'analyzing', analyzedCount: 0, error: undefined })
    try {
      const result = await analyzeKnowledgeFolder(
        batch.folderPath,
        {
          product: catalog.products.find((item) => item.id === batch.productId)?.name ?? batch.productId,
          channel: catalog.channels.find((item) => item.id === batch.channelId)?.name ?? batch.channelId,
          materialType: catalog.materialTypes.find((item) => item.id === batch.materialTypeId)?.name ?? '',
        },
        (analyzedCount, total) => updateBatch(batchId, { analyzedCount, fileCount: total }),
      )
      replaceInsights(batchId, result)
      updateBatch(batchId, {
        status: 'review',
        analyzedCount: batch.fileCount,
        stableInsights: result.filter((item) => item.category === 'stable').length,
        exploratoryInsights: result.filter((item) => item.category === 'exploratory').length,
      })
    } catch (reason) {
      updateBatch(batchId, { status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">历史素材知识沉淀</h2>
          <p className="mt-1 text-sm text-ds-muted">
            递归扫描本地文件夹；第一阶段由视觉分析模型完成提炼，数据表可后续统一映射曝光、点击、转化。
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1.5fr)_1fr_1fr_1fr_auto]">
          <button
            onClick={chooseFolder}
            className="flex min-h-ds-control-lg items-center gap-3 rounded-ds-lg border border-dashed border-ds-border px-4 text-left hover:border-ds-primary hover:bg-ds-primary-subtle dark:border-ds-border-strong dark:hover:bg-ds-primary/20"
          >
            <FolderOpen size={18} className="text-ds-primary" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{folderPath || '选择历史素材文件夹'}</span>
              <span className="block text-xs text-ds-muted">
                {folderPath ? `发现 ${fileCount} 张图片` : '支持递归扫描子文件夹'}
              </span>
            </span>
          </button>
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="h-ds-control-lg rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          >
            {catalog.products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            className="h-ds-control-lg rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          >
            {catalog.channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={materialTypeId}
            onChange={(event) => setMaterialTypeId(event.target.value)}
            className="h-ds-control-lg rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          >
            <option value="">自动判断类型</option>
            {catalog.materialTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            onClick={create}
            className="h-ds-control-lg rounded-ds-lg bg-ds-primary px-5 text-sm font-medium text-ds-text-inverse hover:bg-ds-primary-hover"
          >
            创建分析批次
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-ds-danger">{error}</p>}
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {batches.map((batch) => {
          const percent = batch.fileCount ? Math.round((batch.analyzedCount / batch.fileCount) * 100) : 0
          return (
            <Card key={batch.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{batch.name}</h3>
                  <p className="mt-1 text-xs text-ds-muted">
                    {batch.fileCount} 张 · {formatDate(batch.createdAt)}
                  </p>
                </div>
                <span className="rounded-full bg-ds-surface px-2 py-1 text-xs text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
                  {batch.status === 'ready'
                    ? '待分析'
                    : batch.status === 'analyzing'
                      ? '分析中'
                      : batch.status === 'review'
                        ? '待审核'
                        : '已完成'}
                </span>
              </div>
              <p className="mt-4 truncate text-xs text-ds-muted">{batch.folderPath}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-ds-surface dark:bg-ds-subtle">
                <div className="h-full bg-ds-primary transition" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-ds-muted">
                <span>
                  {batch.analyzedCount} / {batch.fileCount}
                </span>
                <span>
                  稳定 {batch.stableInsights} · 探索 {batch.exploratoryInsights}
                </span>
              </div>
              {batch.error && <p className="mt-3 text-xs leading-5 text-ds-danger">{batch.error}</p>}
              {(batch.status === 'ready' || batch.status === 'error') && (
                <button
                  onClick={() => void analyze(batch.id)}
                  className="mt-4 w-full rounded-lg border border-ds-primary/35 py-2 text-sm text-ds-primary hover:bg-ds-primary-subtle dark:border-ds-primary dark:text-ds-primary dark:hover:bg-ds-primary/30"
                >
                  {batch.status === 'error' ? '重试视觉分析' : '开始视觉分析'}
                </button>
              )}
              {batch.status === 'review' && (
                <button
                  onClick={() => updateBatch(batch.id, { status: 'completed' })}
                  className="mt-4 w-full rounded-lg bg-ds-success py-2 text-sm text-ds-text-inverse hover:bg-ds-success-hover"
                >
                  审核并发布知识条目
                </button>
              )}
              {insights.filter((item) => item.batchId === batch.id).length > 0 && (
                <div className="mt-4 space-y-2 border-t border-ds-border pt-4 dark:border-ds-border-strong">
                  {insights
                    .filter((item) => item.batchId === batch.id)
                    .slice(0, 4)
                    .map((insight) => (
                      <div key={insight.id} className="rounded-lg bg-ds-surface p-3 dark:bg-ds-scrim">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-xs">{insight.title}</strong>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${insight.category === 'stable' ? 'bg-ds-primary-subtle text-ds-primary' : 'bg-ds-primary-subtle text-ds-primary'}`}
                          >
                            {insight.category === 'stable' ? '稳定' : '探索'}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ds-muted">{insight.description}</p>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          )
        })}
        {batches.length === 0 && (
          <Card className="col-span-full flex min-h-48 items-center justify-center text-sm text-ds-muted">
            尚未创建知识沉淀批次
          </Card>
        )}
      </div>
    </div>
  )
}

function EditableCatalogCard<T extends CatalogProduct | CatalogChannel>({
  item,
  kind,
  onSave,
}: {
  item: T
  kind: 'product' | 'channel'
  onSave: (item: T) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [summary, setSummary] = useState(item.summary)
  const [outputPath, setOutputPath] = useState(item.outputPath ?? '')
  const save = () => {
    onSave({
      ...item,
      name: name.trim(),
      summary: summary.trim(),
      outputPath: outputPath.trim() || undefined,
      version: item.version + 1,
    } as T)
    setEditing(false)
  }
  return (
    <div className="rounded-ds-lg border border-ds-border p-4 dark:border-ds-border-strong">
      {editing ? (
        <div className="space-y-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-ds-control-md w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          />
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="min-h-20 w-full rounded-lg border border-ds-border bg-ds-surface p-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          />
          <input
            value={outputPath}
            onChange={(event) => setOutputPath(event.target.value)}
            placeholder="预设保存目录（可选）"
            className="h-ds-control-md w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          />
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-ds-primary px-3 py-1.5 text-xs text-ds-text-inverse">
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-ds-border px-3 py-1.5 text-xs dark:border-ds-border-strong"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="font-medium">{item.name}</h4>
              <p className="mt-1 text-xs text-ds-muted">
                {kind === 'product' ? '产品 SKU' : '投放渠道'} · v{item.version}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onSave({ ...item, published: !item.published, version: item.version + 1 } as T)}
                className={`rounded-lg px-2.5 py-1.5 text-xs ${item.published ? 'bg-ds-success-subtle text-ds-success' : 'bg-ds-surface text-ds-muted dark:bg-ds-subtle dark:text-ds-muted'}`}
              >
                {item.published ? '已发布' : '未发布'}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
              >
                编辑
              </button>
              <button
                onClick={() => onSave({ ...item, archived: !item.archived, version: item.version + 1 } as T)}
                className="rounded-lg border border-ds-danger/35 px-2.5 py-1.5 text-xs text-ds-danger hover:bg-ds-danger-subtle dark:border-ds-danger dark:hover:bg-ds-danger/30"
              >
                {item.archived ? '恢复' : '删除'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm leading-5 text-ds-muted dark:text-ds-muted">{item.summary}</p>
          <p className="mt-3 truncate text-xs text-ds-muted">目录：{item.outputPath || '跟随系统默认目录'}</p>
        </div>
      )}
    </div>
  )
}

function AdminPage() {
  const settings = useRequirementPrototype((state) => state.settings)
  const updateSettings = useRequirementPrototype((state) => state.updateSettings)
  const users = useRequirementPrototype((state) => state.users)
  const orders = useRequirementPrototype((state) => state.orders)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const audits = useRequirementPrototype((state) => state.audits)
  const approveUrgent = useRequirementPrototype((state) => state.approveUrgent)
  const saveProduct = useRequirementPrototype((state) => state.saveProduct)
  const saveChannel = useRequirementPrototype((state) => state.saveChannel)
  const saveUser = useRequirementPrototype((state) => state.saveUser)
  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState<RequirementRole>('optimizer')
  const pendingUrgent = orders.filter(
    (item) => item.urgentRequested && !item.urgentApproved && !item.urgentRejected && item.status !== 'cancelled',
  )

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [Users, '模拟账号', users.length, '三种角色'],
          [
            ListChecks,
            '全部需求',
            orders.length,
            `${orders.filter((item) => item.status === 'running').length} 个生成中`,
          ],
          [ImageIcon, '计划图片', orders.reduce((sum, item) => sum + item.totalImages, 0), '本地原型累计'],
          [Zap, '加急待审批', pendingUrgent.length, '审批后提升优先级'],
        ].map(([Icon, label, value, detail]) => {
          const Component = Icon as typeof Users
          return (
            <Card key={String(label)} className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ds-muted">{String(label)}</span>
                <Component size={18} className="text-ds-primary" />
              </div>
              <strong className="mt-3 block text-2xl">{String(value)}</strong>
              <span className="mt-1 block text-xs text-ds-muted">{String(detail)}</span>
            </Card>
          )
        })}
      </div>

      {pendingUrgent.length > 0 && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Zap size={17} className="text-ds-warning" />
            加急审批
          </h2>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {pendingUrgent.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {order.number} · {order.createdByName} · {order.totalImages} 张
                  </p>
                  <p className="mt-1 text-xs text-ds-muted">{order.urgentReason}</p>
                </div>
                <button
                  onClick={() => approveUrgent(order.id, true)}
                  className="rounded-lg bg-ds-warning px-3 py-2 text-xs font-medium text-ds-text-inverse hover:bg-ds-warning-hover"
                >
                  批准加急
                </button>
                <button
                  onClick={() => approveUrgent(order.id, false)}
                  className="rounded-lg border border-ds-border px-3 py-2 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
                >
                  拒绝
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Settings2 size={17} />
          原型参数
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ['单次下单上限', 'maxImagesPerOrder', settings.maxImagesPerOrder],
            ['默认每日额度', 'defaultDailyQuota', settings.defaultDailyQuota],
            ['生成并发', 'generationConcurrency', settings.generationConcurrency],
          ].map(([label, key, value]) => (
            <label key={String(key)}>
              <span className="mb-2 block text-sm text-ds-muted dark:text-ds-muted">{String(label)}</span>
              <input
                type="number"
                min={1}
                value={Number(value)}
                onChange={(event) => updateSettings({ [String(key)]: Number(event.target.value) })}
                className="h-ds-control-lg w-full rounded-lg border border-ds-border bg-ds-surface px-3 dark:border-ds-border-strong dark:bg-ds-scrim"
              />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="font-semibold">账号与角色</h2>
            <p className="mt-1 text-xs text-ds-muted">新账号默认密码 demo123，可配置角色、状态与每日额度。</p>
          </div>
          <input
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            placeholder="登录账号"
            className="h-ds-control-lg rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          />
          <input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="显示名称"
            className="h-ds-control-lg rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          />
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as RequirementRole)}
            className="h-ds-control-lg rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
          >
            <option value="optimizer">信息流优化师</option>
            <option value="strategist">策略师</option>
            <option value="admin">管理员</option>
          </select>
          <button
            disabled={
              !newUsername.trim() ||
              !newDisplayName.trim() ||
              users.some((item) => item.username === newUsername.trim())
            }
            onClick={() => {
              saveUser({
                id: `user-${Date.now()}`,
                username: newUsername.trim(),
                displayName: newDisplayName.trim(),
                role: newRole,
                dailyQuota: settings.defaultDailyQuota,
                password: 'demo123',
              })
              setNewUsername('')
              setNewDisplayName('')
            }}
            className="h-ds-control-lg rounded-lg bg-ds-primary px-4 text-sm text-ds-text-inverse hover:bg-ds-primary-hover disabled:bg-ds-subtle"
          >
            创建账号
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {users.map((item) => (
            <div key={item.id} className="rounded-ds-lg border border-ds-border p-4 dark:border-ds-border-strong">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-sm">{item.displayName}</strong>
                  <p className="mt-1 text-xs text-ds-muted">
                    {item.username} · {roleLabel[item.role]}
                  </p>
                </div>
                <button
                  onClick={() => saveUser({ ...item, disabled: !item.disabled })}
                  className={`rounded-full px-2.5 py-1 text-xs ${item.disabled ? 'bg-ds-danger-subtle text-ds-danger' : 'bg-ds-success-subtle text-ds-success'}`}
                >
                  {item.disabled ? '已停用' : '启用中'}
                </button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-ds-muted">
                每日额度
                <input
                  type="number"
                  min={1}
                  value={item.dailyQuota}
                  onChange={(event) => saveUser({ ...item, dailyQuota: Number(event.target.value) })}
                  className="h-ds-control-sm w-24 rounded-lg border border-ds-border bg-ds-surface px-2 text-ds-text dark:border-ds-border-strong dark:bg-ds-scrim dark:text-ds-text-subtle"
                />
              </label>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">产品配置</h2>
            <button
              onClick={() =>
                saveProduct({
                  id: `product-${Date.now()}`,
                  name: '新产品 SKU',
                  category: '待配置',
                  summary: '请补充产品说明',
                  facts: [],
                  audience: '',
                  scenes: [],
                  forbidden: [],
                  color: 'from-blue-500 to-cyan-500',
                  published: false,
                  version: 1,
                })
              }
              className="flex items-center gap-1 rounded-lg border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
            >
              <Plus size={13} />
              新增
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {catalog.products.map((item) => (
              <EditableCatalogCard key={item.id} item={item} kind="product" onSave={saveProduct} />
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">渠道配置</h2>
            <button
              onClick={() =>
                saveChannel({
                  id: `channel-${Date.now()}`,
                  name: '新渠道',
                  summary: '请补充渠道要求',
                  ratios: ['16:9', '9:16'],
                  requirements: [],
                  forbidden: [],
                  published: false,
                  version: 1,
                })
              }
              className="flex items-center gap-1 rounded-lg border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle dark:border-ds-border-strong dark:hover:bg-ds-subtle"
            >
              <Plus size={13} />
              新增
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {catalog.channels.map((item) => (
              <EditableCatalogCard key={item.id} item={item} kind="channel" onSave={saveChannel} />
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">审计记录</h2>
        <div className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
          {audits.slice(0, 10).map((event) => (
            <div key={event.id} className="grid gap-1 py-3 md:grid-cols-[140px_120px_1fr]">
              <span className="text-ds-muted">{formatDate(event.createdAt)}</span>
              <span>{event.actorName}</span>
              <span>
                {event.action} · {event.detail}
              </span>
            </div>
          ))}
          {audits.length === 0 && <p className="py-6 text-center text-ds-muted">暂无审计记录</p>}
        </div>
      </Card>
    </div>
  )
}

const navConfig: Record<
  RequirementRole,
  Array<{ route: RequirementRoute; label: string; icon: typeof ClipboardPlus }>
> = {
  optimizer: [
    { route: 'order', label: '新建需求', icon: ClipboardPlus },
    { route: 'orders', label: '我的任务', icon: ListChecks },
  ],
  strategist: [
    { route: 'strategy', label: '策略规则', icon: BookOpenCheck },
    { route: 'knowledge', label: '知识沉淀', icon: Database },
  ],
  admin: [
    { route: 'admin', label: '管理总览', icon: ShieldCheck },
    { route: 'orders', label: '全部任务', icon: ListChecks },
    { route: 'strategy', label: '策略审核', icon: BookOpenCheck },
    { route: 'knowledge', label: '知识库', icon: Database },
    { route: 'legacy', label: '现有工具', icon: Wrench },
  ],
}

export default function RequirementPrototypeShell({ legacy }: { legacy: ReactNode }) {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const users = useRequirementPrototype((state) => state.users)
  const route = useRequirementPrototype((state) => state.route)
  const setRoute = useRequirementPrototype((state) => state.setRoute)
  const logout = useRequirementPrototype((state) => state.logout)
  const user = users.find((item) => item.id === sessionUserId)

  if (!user) return <LoginPage />
  if (route === 'legacy' && user.role === 'admin')
    return (
      <div className="requirement-legacy-shell">
        <button
          onClick={() =>
            setRoute(user.role === 'optimizer' ? 'order' : user.role === 'strategist' ? 'strategy' : 'admin')
          }
          className="requirement-legacy-return"
          aria-label="返回需求中心"
        >
          <Layers3 size={16} />
          <span>返回需求中心</span>
        </button>
        {legacy}
      </div>
    )

  const allowed = navConfig[user.role].some((item) => item.route === route)
  const activeRoute = allowed ? route : navConfig[user.role][0].route
  const page =
    activeRoute === 'order' ? (
      <RequirementOrderingCreatePage />
    ) : activeRoute === 'orders' ? (
      <RequirementOrderingHistoryPage />
    ) : activeRoute === 'strategy' ? (
      <StrategyWorkspace />
    ) : activeRoute === 'knowledge' ? (
      <KnowledgePage />
    ) : (
      <AdminPage />
    )

  return (
    <div className="min-h-screen bg-ds-surface text-ds-text dark:bg-ds-scrim dark:text-ds-text-subtle">
      <header className="sticky top-0 z-40 border-b border-ds-border bg-ds-surface/95 backdrop-blur dark:border-ds-border-strong dark:bg-ds-scrim/95">
        <div className="mx-auto flex h-ds-16 max-w-[1600px] items-center gap-5 px-5">
          <button onClick={() => setRoute(navConfig[user.role][0].route)} className="flex items-center gap-3">
            <span className="flex h-ds-control-md w-ds-control-md items-center justify-center rounded-ds-lg bg-ds-primary text-ds-text-inverse">
              <Sparkles size={19} />
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-semibold">广告素材需求中心</span>
              <span className="block text-xs text-ds-muted">Windows 本地原型</span>
            </span>
          </button>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="主导航">
            {navConfig[user.role].map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.route}
                  onClick={() => setRoute(item.route)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${activeRoute === item.route ? 'bg-ds-primary-subtle font-medium text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'text-ds-muted hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-subtle'}`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="flex items-center gap-3 border-l border-ds-border pl-4 dark:border-ds-border-strong">
            <CircleUserRound size={20} className="text-ds-muted" />
            <div className="hidden text-right md:block">
              <span className="block text-xs font-medium">{user.displayName}</span>
              <span className="block text-xs text-ds-muted">{roleLabel[user.role]}</span>
            </div>
            <button
              onClick={logout}
              title="退出登录"
              className="rounded-lg p-2 text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-subtle dark:hover:text-white"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <main className={activeRoute === 'strategy' ? 'w-full p-0' : 'mx-auto max-w-[1600px] p-5'}>{page}</main>
    </div>
  )
}
