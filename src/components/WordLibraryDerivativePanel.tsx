import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, SegmentedControl, SparklesIcon } from '../design-system'
import { generateDerivedWordEntries } from '../lib/agentApi'
import { getAgentApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { useStore } from '../store'
import type { WordLibraryDerivativeRule } from '../types'

export function parseWordLibraryEntryLines(text: string): string[] {
  return text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function mergeWordLibraryEntryLines(currentText: string, generated: string[]): string {
  const lines = parseWordLibraryEntryLines(currentText)
  const seen = new Set(lines)
  for (const item of generated) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    lines.push(value)
  }
  return lines.join('\n')
}

interface WordLibraryDerivativePanelProps {
  entryKey: string
  draftValues: string
  onDraftValuesChange: (value: string) => void
}

export default function WordLibraryDerivativePanel({
  entryKey,
  draftValues,
  onDraftValuesChange,
}: WordLibraryDerivativePanelProps) {
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const toast = useStore((state) => state.showToast)
  const [similarity, setSimilarity] = useState(85)
  const [count, setCount] = useState(6)
  const [loading, setLoading] = useState(false)
  const [generatedEntries, setGeneratedEntries] = useState<string[]>([])
  const [rulesOpen, setRulesOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const enabledRules = useMemo(
    () => settings.wordLibraryDerivativeRules.filter((rule) => rule.enabled),
    [settings.wordLibraryDerivativeRules],
  )
  const ruleSummary =
    enabledRules.length === 0
      ? '默认规则'
      : enabledRules.length === 1
        ? enabledRules[0].name
        : `${enabledRules.length} 条规则`
  const contextEntries = parseWordLibraryEntryLines(draftValues)

  useEffect(() => () => abortRef.current?.abort(), [])

  const updateRules = (rules: WordLibraryDerivativeRule[]) => {
    setSettings({ wordLibraryDerivativeRules: rules })
  }

  const setRuleMode = (mode: 'single' | 'multiple') => {
    const rules = settings.wordLibraryDerivativeRules
    if (mode === 'multiple') {
      setSettings({ wordLibraryDerivativeRuleMode: mode })
      return
    }
    let enabledSeen = false
    const normalized = rules.map((rule) => {
      const enabled = rule.enabled && !enabledSeen
      if (enabled) enabledSeen = true
      return { ...rule, enabled }
    })
    if (!enabledSeen && normalized[0]) normalized[0] = { ...normalized[0], enabled: true }
    setSettings({ wordLibraryDerivativeRuleMode: mode, wordLibraryDerivativeRules: normalized })
  }

  const toggleRule = (ruleId: string) => {
    const rules = settings.wordLibraryDerivativeRules
    const next =
      settings.wordLibraryDerivativeRuleMode === 'single'
        ? rules.map((rule) => ({ ...rule, enabled: rule.id === ruleId }))
        : rules.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule))
    updateRules(next)
  }

  const addRule = () => {
    const id = `rule-${Date.now().toString(36)}`
    updateRules([
      ...settings.wordLibraryDerivativeRules,
      {
        id,
        name: '新规则',
        content: '描述衍生方向，例如：保留主体名词，只替换颜色、风格或材质形容词。',
        enabled: false,
      },
    ])
    setEditingRuleId(id)
    toast('已添加新规则', 'success')
  }

  const copyRule = (rule: WordLibraryDerivativeRule) => {
    const id = `rule-${Date.now().toString(36)}`
    updateRules([
      ...settings.wordLibraryDerivativeRules,
      {
        id,
        name: `${rule.name} 副本`,
        content: rule.content,
        enabled: false,
      },
    ])
    setEditingRuleId(id)
    toast('规则已复制', 'success')
  }

  const patchRule = (ruleId: string, patch: Partial<WordLibraryDerivativeRule>) => {
    updateRules(
      settings.wordLibraryDerivativeRules.map((rule) =>
        rule.id === ruleId && !rule.builtIn ? { ...rule, ...patch } : rule,
      ),
    )
  }

  const deleteRule = (ruleId: string) => {
    const target = settings.wordLibraryDerivativeRules.find((rule) => rule.id === ruleId)
    if (!target || target.builtIn) return
    let next = settings.wordLibraryDerivativeRules.filter((rule) => rule.id !== ruleId)
    if (!next.some((rule) => rule.enabled) && next[0]) {
      next = next.map((rule, index) => ({ ...rule, enabled: index === 0 }))
    }
    updateRules(next)
    if (editingRuleId === ruleId) setEditingRuleId(null)
    toast('规则已删除', 'success')
  }

  const generate = async () => {
    const seedEntry = contextEntries[0]
    if (!seedEntry) {
      toast('请先输入至少一个候选值', 'error')
      return
    }
    const profile = getAgentApiProfile(settings)
    const validationError = validateApiProfile(profile)
    if (validationError) {
      toast(`请先完善 Agent 配置：${validationError}`, 'error')
      return
    }
    if (profile.apiMode !== 'responses') {
      toast('AI 衍生需要 Agent 使用 Responses API', 'error')
      return
    }

    const normalizedCount = Math.max(1, Math.min(100, Math.trunc(Number(count) || 1)))
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCount(normalizedCount)
    setGeneratedEntries([])
    setLoading(true)
    try {
      const generated = await generateDerivedWordEntries({
        settings,
        profile,
        seedEntry,
        variableName: entryKey,
        contextEntries,
        similarity,
        count: normalizedCount,
        signal: controller.signal,
      })
      if (generated.length === 0) {
        toast('未生成可用词条，请调整相似度后重试', 'error')
        return
      }
      setGeneratedEntries(generated)
      toast(`已生成 ${generated.length} 条词条`, 'success')
    } catch (error) {
      if (controller.signal.aborted) return
      toast(error instanceof Error ? error.message : 'AI 衍生失败', 'error')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  return (
    <section
      className="mb-4 rounded-lg border border-ds-border bg-ds-subtle/20 p-3"
      aria-labelledby="word-library-derivative-title"
      data-testid="word-library-ai-derivative"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-ds-primary" aria-hidden="true">
          <SparklesIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="word-library-derivative-title" className="text-sm font-semibold">
            AI 衍生词条
          </h3>
          <p className="mt-1 text-xs leading-5 text-ds-muted">分析当前全部候选值，生成可替换同一变量的新词条。</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_76px] gap-3">
        <label className="min-w-0 text-xs text-ds-muted">
          <span className="flex items-center justify-between">
            <span>相似度</span>
            <output>{similarity}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={similarity}
            onChange={(event) => setSimilarity(Number(event.target.value))}
            className="mt-2 w-full accent-blue-600"
          />
        </label>
        <label className="text-xs text-ds-muted">
          数量
          <input
            type="number"
            min="1"
            max="100"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="mt-1 h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-canvas px-2 text-sm text-ds-text"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-ds-muted" title={ruleSummary}>
          规则：{ruleSummary}
        </span>
        <button
          type="button"
          className="shrink-0 text-ds-primary hover:underline"
          onClick={() => setRulesOpen((open) => !open)}
        >
          {rulesOpen ? '收起规则' : '管理规则'}
        </button>
      </div>

      {rulesOpen && (
        <div className="mt-3 border-t border-ds-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <SegmentedControl
              aria-label="衍生规则选择模式"
              size="sm"
              value={settings.wordLibraryDerivativeRuleMode}
              options={[
                { value: 'single', label: '单选' },
                { value: 'multiple', label: '多选' },
              ]}
              onValueChange={setRuleMode}
            />
            <Button size="sm" variant="secondary" onClick={addRule}>
              添加规则
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {settings.wordLibraryDerivativeRules.map((rule) => {
              const editing = editingRuleId === rule.id && !rule.builtIn
              return (
                <article
                  key={rule.id}
                  className={`rounded-md border p-2.5 ${rule.enabled ? 'border-ds-primary/50 bg-ds-primary/10' : 'border-ds-border bg-ds-canvas'}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type={settings.wordLibraryDerivativeRuleMode === 'single' ? 'radio' : 'checkbox'}
                      name="word-library-derivative-rule"
                      checked={rule.enabled}
                      onChange={() => toggleRule(rule.id)}
                      aria-label={`启用 ${rule.name}`}
                      className="mt-1 accent-blue-600"
                    />
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <div className="space-y-2">
                          <input
                            value={rule.name}
                            onChange={(event) => patchRule(rule.id, { name: event.target.value })}
                            aria-label="规则名称"
                            className="h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-canvas px-2 text-sm text-ds-text"
                          />
                          <textarea
                            value={rule.content}
                            onChange={(event) => patchRule(rule.id, { content: event.target.value })}
                            aria-label="规则内容"
                            className="min-h-24 w-full resize-y rounded-md border border-ds-border bg-ds-canvas p-2 text-xs leading-5 text-ds-text"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-semibold">{rule.name}</p>
                            {rule.builtIn && <span className="shrink-0 text-xs text-ds-primary">默认</span>}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-ds-muted">{rule.content}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    {editing ? (
                      <button type="button" className="text-xs text-ds-primary" onClick={() => setEditingRuleId(null)}>
                        完成
                      </button>
                    ) : (
                      <>
                        {!rule.builtIn && (
                          <button
                            type="button"
                            className="text-xs text-ds-muted hover:text-ds-text"
                            onClick={() => setEditingRuleId(rule.id)}
                          >
                            编辑
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-xs text-ds-muted hover:text-ds-text"
                          onClick={() => copyRule(rule)}
                        >
                          复制
                        </button>
                        {!rule.builtIn && (
                          <button type="button" className="text-xs text-ds-danger" onClick={() => deleteRule(rule.id)}>
                            删除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      <Button
        className="mt-3 w-full"
        size="sm"
        loading={loading}
        disabled={contextEntries.length === 0}
        onClick={() => void generate()}
      >
        {loading ? '正在生成' : '生成衍生词条'}
      </Button>

      {generatedEntries.length > 0 && (
        <div className="mt-3" aria-live="polite">
          <div className="max-h-40 overflow-y-auto rounded-md border border-ds-border bg-ds-canvas p-2">
            {generatedEntries.map((entry, index) => (
              <p
                key={`${entry}-${index}`}
                className="border-b border-ds-border py-1.5 text-xs leading-5 last:border-b-0"
              >
                {entry}
              </p>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onDraftValuesChange(mergeWordLibraryEntryLines(draftValues, generatedEntries))
                setGeneratedEntries([])
                toast('已追加到候选值，请保存词条', 'success')
              }}
            >
              追加
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onDraftValuesChange(generatedEntries.join('\n'))
                setGeneratedEntries([])
                toast('已替换候选值，请保存词条', 'success')
              }}
            >
              替换
            </Button>
          </div>
          <button
            type="button"
            className="mt-2 w-full text-center text-xs text-ds-muted hover:text-ds-text"
            onClick={() => setGeneratedEntries([])}
          >
            丢弃结果
          </button>
        </div>
      )}
    </section>
  )
}
