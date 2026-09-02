import {
  Button,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  SearchField,
  SelectField,
  TextArea,
  TextField,
} from '../../design-system'
import {
  CopyIcon as Copy,
  PlusIcon as Plus,
  SaveIcon as Save,
  SparklesIcon as Sparkles,
  TrashIcon as Trash2,
} from '../../design-system/icons'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import type { SopMetaInstruction } from './types'
import SopAiRevisionPanel from './SopAiRevisionPanel'
import { META_QUICK_INSTRUCTIONS } from './sopAiQuickInstructions'

export type SopMetaTabProps = {
  filteredMetaInstructions: SopMetaInstruction[]
  metaSearch: string
  setMetaSearch: (value: string) => void
  selectedMetaId: string
  selectMeta: (item: SopMetaInstruction) => void
  setSelectedMetaId: (id: string) => void
  metaDraft: SopMetaInstruction | null
  setMetaDraft: React.Dispatch<React.SetStateAction<SopMetaInstruction | null>>
  metaDirty: boolean
  metaEditorHint: string
  metaChatOpen: boolean
  setMetaChatOpen: React.Dispatch<React.SetStateAction<boolean>>
  addMeta: () => void
  onSaveMetaInstruction: (item: SopMetaInstruction) => void
  onDuplicateMetaInstruction: (itemId: string) => string | null
  onDeleteMetaInstruction: (itemId: string) => void
}

/** SOP 管理中心「生成元指令」标签页：元指令列表 + 编辑面板 + AI 对话。 */
export default function SopMetaTab({
  filteredMetaInstructions,
  metaSearch,
  setMetaSearch,
  selectedMetaId,
  selectMeta,
  setSelectedMetaId,
  metaDraft,
  setMetaDraft,
  metaDirty,
  metaEditorHint,
  metaChatOpen,
  setMetaChatOpen,
  addMeta,
  onSaveMetaInstruction,
  onDuplicateMetaInstruction,
  onDeleteMetaInstruction,
}: SopMetaTabProps) {
  const { openConfirmDialog } = useAppDialog()
  const showToast = useStore((state) => state.showToast)

  return (
    <DialogWorkspace layout="split" className="sop-center-meta-grid min-h-0 flex-1">
      <DialogPane as="aside" className="sop-center-list-panel">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">生成元指令</h3>
            <p className="sop-center-quiet-text mt-1 text-xs">控制 AI 如何编译 SOP。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={addMeta} leadingIcon={<Plus size={15} />}>
            新建
          </Button>
        </div>
        <SearchField
          className="mt-3"
          label="搜索元指令"
          value={metaSearch}
          onChange={setMetaSearch}
          onClear={() => setMetaSearch('')}
          placeholder="搜索名称、说明或正文"
        />
        <div className="mt-4 space-y-2">
          {filteredMetaInstructions.map((item) => (
            <ListRow
              key={item.id}
              className="sop-center-meta-row"
              selected={selectedMetaId === item.id}
              title={item.name}
              description={item.description || '暂无说明'}
              interactive={{ onClick: () => selectMeta(item), 'aria-label': `编辑${item.name}` }}
              actions={
                <div className="flex gap-1">
                  <IconButton
                    size="sm"
                    onClick={() => {
                      const id = onDuplicateMetaInstruction(item.id)
                      if (id) {
                        setSelectedMetaId(id)
                        showToast(`已复制元指令「${item.name}」`, 'success')
                      } else {
                        showToast('复制元指令失败，请重试', 'error')
                      }
                    }}
                    aria-label={`复制${item.name}`}
                    title="复制元指令"
                    icon={<Copy size={14} />}
                  />
                  <IconButton
                    size="sm"
                    onClick={() =>
                      openConfirmDialog({
                        title: '删除生成元指令？',
                        message: `将永久删除「${item.name}」。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => {
                          onDeleteMetaInstruction(item.id)
                          showToast(`已删除元指令「${item.name}」`, 'success')
                        },
                      })
                    }
                    aria-label={`删除${item.name}`}
                    title="删除元指令"
                    icon={<Trash2 size={14} />}
                    className="sop-center-action--danger"
                  />
                </div>
              }
            />
          ))}
          {filteredMetaInstructions.length === 0 && (
            <EmptyState title="没有匹配的元指令" description="换个关键词，或新建一个生成元指令。" />
          )}
        </div>
      </DialogPane>
      <DialogPane tone="canvas" className="sop-center-editor-panel flex min-h-0 flex-col">
        {metaDraft ? (
          <div className="sop-center-editor-card sop-center-meta-editor flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">编辑生成元指令</h3>
                <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">
                  {metaEditorHint}
                </p>
              </div>
              <Inline gap={2}>
                <Button
                  variant="secondary"
                  onClick={() => setMetaChatOpen((current) => !current)}
                  aria-pressed={metaChatOpen}
                  leadingIcon={<Sparkles size={14} />}
                >
                  AI 对话
                </Button>
                <Button
                  disabled={!metaDraft.name.trim() || !metaDraft.instruction.trim()}
                  onClick={() => {
                    onSaveMetaInstruction({ ...metaDraft, updatedAt: Date.now() })
                    showToast('生成元指令已保存', 'success')
                  }}
                  variant={metaDirty ? 'primary' : 'secondary'}
                  leadingIcon={<Save size={15} />}
                >
                  保存
                </Button>
              </Inline>
            </div>
            <div className="grid shrink-0 gap-4 sm:grid-cols-2">
              <TextField
                label="名称"
                value={metaDraft.name}
                onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })}
              />
              <SelectField
                label="类型"
                value={metaDraft.kind}
                onChange={(event) =>
                  setMetaDraft({ ...metaDraft, kind: event.target.value as SopMetaInstruction['kind'] })
                }
                options={[
                  { value: 'general', label: '通用 SOP' },
                  { value: 'image-prompt', label: '图片提示词 SOP' },
                  { value: 'prompt-reverse', label: '提示词反推 SOP' },
                  { value: 'variable-prompt-skill', label: '变量提示词技能' },
                  { value: 'custom', label: '自定义' },
                ]}
              />
            </div>
            <TextArea
              label="说明"
              value={metaDraft.description}
              onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })}
              containerClassName="shrink-0"
              className="leading-6"
            />
            <TextArea
              label="元指令正文"
              value={metaDraft.instruction}
              onChange={(event) => setMetaDraft({ ...metaDraft, instruction: event.target.value })}
              containerClassName="sop-center-meta-instruction-field"
              className="sop-center-meta-instruction-input font-mono text-xs"
            />
          </div>
        ) : (
          <EmptyState
            className="h-full"
            title="选择或新建一个生成元指令"
            description="从左侧列表选择内容后即可编辑。"
          />
        )}
      </DialogPane>
      {metaDraft && metaChatOpen && (
        <SopAiRevisionPanel
          documentId={`meta-instruction:${metaDraft.id}`}
          value={metaDraft.instruction}
          revisionTarget="meta-instruction"
          onApply={(instruction) => setMetaDraft({ ...metaDraft, instruction })}
          instructionTemplates={META_QUICK_INSTRUCTIONS}
        />
      )}
    </DialogWorkspace>
  )
}
