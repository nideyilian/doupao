import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { useStore } from '../store'

interface HelpModalProps {
  appMode: AppMode
  isFavoriteCollectionOverview?: boolean
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function HelpModal({ appMode, isFavoriteCollectionOverview = false, onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  const modalRef = useRef<HTMLDivElement>(null)
  const isAgentMode = appMode === 'agent'
  const isStrategyMode = appMode === 'strategy'
  const isOrderingMode = appMode === 'ordering'
  const isAssetLibrary = appMode === 'gallery'
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)
  useDialogFocusTrap(true, modalRef)

  return createPortal(
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        className="ds-modal-surface relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2
            id="help-dialog-title"
            className="text-base font-semibold text-ds-text dark:text-ds-text-subtle flex items-center gap-2"
          >
            <svg
              className="w-5 h-5 text-ds-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            操作指南
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-full p-1 text-ds-muted transition hover:bg-ds-subtle hover:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain mb-6 text-sm text-ds-muted dark:text-ds-muted space-y-6 custom-scrollbar pr-2">
          {isAssetLibrary ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-primary"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  素材库
                </h4>
                <ul className="list-disc space-y-2 pl-4">
                  <li>成功生成的图片会自动进入素材库，无需手动保存；删除生成任务不会删除素材。</li>
                  <li>
                    生图由任务卡承载：工具栏默认「任务卡片」视图，每次生成对应一张任务卡（提示词、参数、图片与进度都在这张卡上），
                    可随时切到「图片」大图模式只看图（同一批结果，两种展示形式）；左侧按全部、最近、收藏、未整理、项目和回收站浏览。
                  </li>
                  <li>搜索支持提示词、模型与项目；筛选支持评分、形状、来源、服务商、模型、日期和宽度。</li>
                  <li>
                    在空白处<strong className="text-ds-primary dark:text-ds-primary font-medium">拖拽框选</strong>
                    多张素材， 按{' '}
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl
                    </kbd>
                    /
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      ⌘
                    </kbd>{' '}
                    点击可增减选择，
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl
                    </kbd>
                    +
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      A
                    </kbd>{' '}
                    全选当前结果；底部批量栏支持收藏、评分、项目、下载、回收站。
                  </li>
                  <li>
                    双击素材可全屏大图浏览并前后切换；右键菜单可复制图片、加入参考图、复用提示词与参数、发送到后期处理、下载原图。
                  </li>
                  <li>
                    回收站中的素材仍占用原图空间，恢复或永久删除后才释放；永久删除前会提示被其他任务、工作区或 SOP
                    引用的素材，「清空回收站」默认勾选「解除引用并彻底删除」，可连同被引用的素材一并清空。
                  </li>
                  <li>
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">快捷键（Eagle 式）</strong>：
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      空格
                    </kbd>
                    打开 / 关闭大图查看器；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Enter
                    </kbd>
                    打开查看器；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Esc
                    </kbd>
                    关闭查看器 / 取消选择；查看器内
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      ←
                    </kbd>
                    /
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      →
                    </kbd>
                    前后切换、滚轮缩放、双击缩放切换；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      1-5
                    </kbd>
                    评分 /
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      0
                    </kbd>
                    清除评分、
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      F
                    </kbd>
                    收藏、
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      C
                    </kbd>
                    轮换颜色标签（选中素材同样生效）；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Delete
                    </kbd>
                    移入回收站；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl/Cmd+C / X
                    </kbd>
                    复制 / 剪切选中素材，
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl/Cmd+V
                    </kbd>
                    粘贴到当前项目（侧栏文件夹也可右键粘贴）；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl/Cmd+Z
                    </kbd>
                    撤销 /
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl/Cmd+Shift+Z
                    </kbd>
                    重做；
                    <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                      Ctrl/Cmd+F
                    </kbd>
                    聚焦搜索。
                  </li>
                  <li>桌面端可从素材详情打开文件位置；素材库元数据包含在备份与导入中。</li>
                </ul>
              </section>
            </>
          ) : isOrderingMode ? (
            <section>
              <ul className="list-disc space-y-2 pl-4">
                <li>按产品、渠道尺寸和素材类型组合需求，右侧会实时计算任务数量与额度。</li>
                <li>不兼容组合会自动排除；超过单次上限或每日额度时无法提交。</li>
                <li>提交后可在任务列表查看进度、取消未完成任务、重试失败单元并打开结果目录。</li>
                <li>管理员查看全部任务；优化师可新建需求并查看自己的任务。</li>
              </ul>
            </section>
          ) : isStrategyMode ? (
            <section>
              <ul className="list-disc space-y-2 pl-4">
                <li>左侧按产品、素材类型和策略组织内容，支持新建、重命名、复制和移动。</li>
                <li>策略依次配置生成方式、参考素材、核心要求、知识词条、SOP 和输出规则。</li>
                <li>测试任务会复用当前图片生成能力，完成后可将结果设为策略封面或复用提示词。</li>
                <li>图片生成 SOP 会自动调用画风逆向的多变体提示词直出规则。</li>
              </ul>
            </section>
          ) : isAgentMode ? (
            <>
              <section>
                <div className="space-y-4">
                  <ul className="list-disc pl-4 space-y-2">
                    <li>需要使用 Responses API 配置。</li>
                    <li>如需 Agent 搜索互联网或读取 URL 内容，可在设置的 Agent 配置中开启“网络搜索”。</li>
                    <li>
                      输入 <strong className="text-ds-primary dark:text-ds-primary font-medium">@</strong>{' '}
                      可引用参考图或前面轮次生成的图片；Agent 也会自行参考上下文中的图片。
                    </li>
                    <li>编辑某轮消息重新发送，或重新生成某轮消息，会产生可切换的分支。</li>
                    <li>生成的图片会同步到画廊；删除对话默认不会删除画廊中的任务。</li>
                  </ul>
                </div>
              </section>
            </>
          ) : isFavoriteCollectionOverview ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选收藏夹
                </h4>
                <div className="space-y-4">
                  {isMobile ? (
                    <p>
                      在收藏夹卡片上
                      <strong className="text-ds-primary dark:text-ds-primary font-medium">左右滑动</strong>
                      即可选中或取消选中该卡片。
                    </p>
                  ) : (
                    <ul className="list-disc pl-4 space-y-2">
                      <li>
                        使用鼠标在空白处
                        <strong className="text-ds-primary dark:text-ds-primary font-medium">拖拽框选</strong>
                        收藏夹卡片。
                      </li>
                      <li>
                        按住{' '}
                        <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                          Ctrl
                        </kbd>{' '}
                        或{' '}
                        <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                          ⌘
                        </kbd>{' '}
                        并点击卡片，可添加或移除单项。
                      </li>
                      <li>再次框选已选中的卡片会将其取消选中。</li>
                      <li>点击卡片外任意空白处可取消所有选择。</li>
                    </ul>
                  )}
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>
                    选中一个或多个收藏夹后，页面底部会出现操作栏，支持
                    <strong className="text-ds-muted dark:text-ds-muted font-medium">取消选择</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">全选收藏夹</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">反选收藏夹</strong>、
                    <strong className="text-ds-success dark:text-ds-success font-medium">下载选中</strong>，和
                    <strong className="text-ds-danger dark:text-ds-danger font-medium">删除选中</strong>。
                  </p>
                </div>
              </section>
            </>
          ) : isMobile ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选任务
                </h4>
                <div className="space-y-4">
                  <p>
                    在历史任务卡片上
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">左右滑动</strong>
                    即可选中或取消选中该卡片。
                  </p>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>
                    选中一个或多个任务后，页面底部会出现操作栏，支持
                    <strong className="text-ds-muted dark:text-ds-muted font-medium">取消选择</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">全选任务</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">反选任务</strong>、
                    <strong className="text-ds-warning dark:text-ds-warning font-medium">编辑收藏夹</strong>、
                    <strong className="text-ds-success dark:text-ds-success font-medium">下载选中</strong>，和
                    <strong className="text-ds-danger dark:text-ds-danger font-medium">删除选中</strong>。
                  </p>
                </div>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选任务
                </h4>
                <div className="space-y-4">
                  <ul className="list-disc pl-4 space-y-2">
                    <li>
                      在卡片间隙或卡片信息区
                      <strong className="text-ds-primary dark:text-ds-primary font-medium">拖拽框选</strong>
                      任务卡片；从左侧图片上按下拖动则是拖拽图片（如拖给 Agent）。
                    </li>
                    <li>
                      按住{' '}
                      <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                        Ctrl
                      </kbd>{' '}
                      或{' '}
                      <kbd className="px-1.5 py-0.5 rounded-md bg-ds-surface dark:bg-ds-subtle border border-ds-border dark:border-ds-border-strong text-xs font-sans">
                        ⌘
                      </kbd>{' '}
                      并点击卡片，可添加或移除单项。
                    </li>
                    <li>再次框选已选中的卡片会将其取消选中。</li>
                    <li>点击卡片外任意空白处可取消所有选择。</li>
                  </ul>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-medium text-ds-text dark:text-ds-text-subtle flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4 text-ds-muted dark:text-ds-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>
                    选中一个或多个任务后，页面底部会出现操作栏，支持
                    <strong className="text-ds-muted dark:text-ds-muted font-medium">取消选择</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">全选任务</strong>、
                    <strong className="text-ds-primary dark:text-ds-primary font-medium">反选任务</strong>、
                    <strong className="text-ds-warning dark:text-ds-warning font-medium">编辑收藏夹</strong>、
                    <strong className="text-ds-success dark:text-ds-success font-medium">下载选中</strong>，和
                    <strong className="text-ds-danger dark:text-ds-danger font-medium">删除选中</strong>。
                  </p>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="pt-4 border-t border-ds-border dark:border-ds-border flex justify-center">
          <a
            href="https://github.com/nideyilian/doupao"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-ds-muted dark:text-ds-muted hover:text-ds-text dark:hover:text-ds-text transition-colors group"
          >
            <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            @nideyilian
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
