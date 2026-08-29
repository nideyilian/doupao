import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SearchIcon as Search,
  ShuffleIcon as Shuffle,
  SquareIcon as Square,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { naturalSortBackgrounds } from '../lib/compositeBackgrounds'
import { createCompositeExportSnapshot, expandCompositeExportItems } from '../lib/compositeExportPlan'
import { runCompositeV2Export, retryCompositeExportTask } from '../lib/compositeExportRuntime'
import { stripTemplateIndex } from '../lib/compositePathTemplates'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import { ExportResultsPanel } from './ExportResultsPanel'
import { DistributionSettingsPanel } from './DistributionSettingsPanel'
import { GlobalOutputRulesPanel } from './GlobalOutputRulesPanel'
import { runDistribution } from '../lib/compositeDistribution'
import { useAppDialog } from '../../../hooks/useAppDialog'
import AssetPickerModal from '../../assetLibrary/AssetPickerModal'
import { assetCommands } from '../../../lib/assetCommands'
import { getSourceHeight, getSourceWidth, loadImageOriented } from '../../../lib/canvasImage'

type PreviewFile = {
  path: string
  name: string
  dataUrl: string
}

function getElectronApi() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

function getSelectedGroup<T extends { id: string }>(items: T[], selectedId: string) {
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null
}

function getPreviewPath(previewHistory: string[], previewHistoryIndex: number) {
  if (previewHistoryIndex < 0) return ''
  return previewHistory[previewHistoryIndex] ?? ''
}

export function BatchExportTab() {
  const { openConfirmDialog } = useAppDialog()
  const backgroundFolders = useCompositeV2Store((state) => state.backgroundFolders)
  const recursiveBackgrounds = useCompositeV2Store((state) => state.recursiveBackgrounds)
  const backgrounds = useCompositeV2Store((state) => state.backgrounds)
  const previewHistory = useCompositeV2Store((state) => state.previewHistory)
  const previewHistoryIndex = useCompositeV2Store((state) => state.previewHistoryIndex)
  const presets = useCompositeV2Store((state) => state.presets)
  const groups = useCompositeV2Store((state) => state.presetGroups)
  const outputRuleGroups = useCompositeV2Store((state) => state.outputRuleGroups)
  const globalFitMode = useCompositeV2Store((state) => state.globalFitMode)
  const selectedPresetGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const enabledPresetIdsForRun = useCompositeV2Store((state) => state.enabledPresetIdsForRun)
  const smartMatchOrientation = useCompositeV2Store((state) => state.smartMatchOrientation)
  const customValue = useCompositeV2Store((state) => state.customValue)
  const customVariables = useCompositeV2Store((state) => state.customVariables)
  const preserveSourceDir = useCompositeV2Store((state) => state.preserveSourceDir)
  const archiveExportsToLibrary = useCompositeV2Store((state) => state.archiveExportsToLibrary)
  const setArchiveExportsToLibrary = useCompositeV2Store((state) => state.setArchiveExportsToLibrary)
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const exportCompleted = useCompositeV2Store((state) => state.exportCompleted)
  const exportTotal = useCompositeV2Store((state) => state.exportTotal)
  const history = useCompositeV2Store((state) => state.history)
  const exportSuccesses = useCompositeV2Store((state) => state.exportSuccesses)
  const exportFailures = useCompositeV2Store((state) => state.exportFailures)
  const setBackgroundFolders = useCompositeV2Store((state) => state.setBackgroundFolders)
  const setRecursiveBackgrounds = useCompositeV2Store((state) => state.setRecursiveBackgrounds)
  const setBackgrounds = useCompositeV2Store((state) => state.setBackgrounds)
  const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const setEnabledPresetIdsForRun = useCompositeV2Store((state) => state.setEnabledPresetIdsForRun)
  const setSmartMatchOrientation = useCompositeV2Store((state) => state.setSmartMatchOrientation)
  const setCustomValue = useCompositeV2Store((state) => state.setCustomValue)
  const setPreserveSourceDir = useCompositeV2Store((state) => state.setPreserveSourceDir)
  const setExportProgress = useCompositeV2Store((state) => state.setExportProgress)
  const setExportStatus = useCompositeV2Store((state) => state.setExportStatus)
  const setExportCancelRequested = useCompositeV2Store((state) => state.setExportCancelRequested)
  const setDistributionCancelRequested = useCompositeV2Store((state) => state.setDistributionCancelRequested)
  const pushPreviewBackground = useCompositeV2Store((state) => state.pushPreviewBackground)
  const previousPreviewBackground = useCompositeV2Store((state) => state.previousPreviewBackground)
  const nextPreviewBackground = useCompositeV2Store((state) => state.nextPreviewBackground)
  const resetExportResults = useCompositeV2Store((state) => state.resetExportResults)
  const addExportSuccess = useCompositeV2Store((state) => state.addExportSuccess)
  const addExportFailure = useCompositeV2Store((state) => state.addExportFailure)
  const setDistributionProgress = useCompositeV2Store((state) => state.setDistributionProgress)
  const setDistributionStatus = useCompositeV2Store((state) => state.setDistributionStatus)
  const resetDistributionResults = useCompositeV2Store((state) => state.resetDistributionResults)
  const addDistributionSuccess = useCompositeV2Store((state) => state.addDistributionSuccess)
  const addDistributionFailure = useCompositeV2Store((state) => state.addDistributionFailure)
  const addHistoryRecord = useCompositeV2Store((state) => state.addHistoryRecord)
  const setExportTasks = useCompositeV2Store((state) => state.setExportTasks)
  const updateExportTask = useCompositeV2Store((state) => state.updateExportTask)
  const distributionConfig = useCompositeV2Store((state) => state.distributionConfig)
  const distributionStatus = useCompositeV2Store((state) => state.distributionStatus)
  const distributionCompleted = useCompositeV2Store((state) => state.distributionCompleted)
  const distributionTotal = useCompositeV2Store((state) => state.distributionTotal)
  const distributionSuccesses = useCompositeV2Store((state) => state.distributionSuccesses)
  const distributionFailures = useCompositeV2Store((state) => state.distributionFailures)

  const [backgroundStatus, setBackgroundStatus] = useState('选择文件夹后加载背景图片。')
  const [previewStatus, setPreviewStatus] = useState('加载背景后将随机显示一张预览。')
  const [runStatusText, setRunStatusText] = useState('请完成背景、预设和尺寸规则配置。')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  // 预览画布尺寸：跟随当前背景图的真实比例（等比缩放，最大边 960px）。
  // 之前固定用预设 baseCanvas（默认 16:9），导致任何比例的图都被裁切/拉伸成 16:9。
  const [previewCanvasSize, setPreviewCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [folderInputs, setFolderInputs] = useState<string[]>(backgroundFolders.length ? backgroundFolders : [''])
  // 预览对比网格：多个勾选预设的画布引用
  const previewCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanRequestRef = useRef(0)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  // 导出完成后的成功提示条（含"打开输出文件夹"入口），用户关闭后本次不再弹出
  const [dismissSuccessNotice, setDismissSuccessNotice] = useState(false)

  const toggleGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const electronApi = getElectronApi()
  const canBrowseBackgrounds = Boolean(electronApi?.isElectron && electronApi.scanEnteredCompositeBackgroundFolder)
  const selectedGroup = useMemo(() => getSelectedGroup(groups, selectedPresetGroupId), [groups, selectedPresetGroupId])
  const groupPresets = useMemo(
    () =>
      (selectedGroup?.presetIds ?? [])
        .map((presetId) => presets.find((preset) => preset.id === presetId) ?? null)
        .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset)),
    [presets, selectedGroup],
  )
  const enabledPresetIdsSet = useMemo(() => new Set(enabledPresetIdsForRun), [enabledPresetIdsForRun])
  const enabledPresets = useMemo(
    () => groupPresets.filter((preset) => enabledPresetIdsSet.has(preset.id)),
    [enabledPresetIdsSet, groupPresets],
  )
  const plannedExportCount = useMemo(() => {
    if (!selectedGroup || !backgrounds.length || !enabledPresets.length) return 0

    const snapshot = createCompositeExportSnapshot({
      id: 'shell-preview',
      date: 'shell',
      backgroundFolders,
      recursive: recursiveBackgrounds,
      backgrounds,
      presets,
      presetGroup: selectedGroup,
      enabledPresetIds: enabledPresets.map((preset) => preset.id),
      outputRuleGroups,
      smartMatchOrientation,
      custom: customValue,
      customVariables,
      fitMode: globalFitMode,
      preserveSourceDir,
      archiveExportsToLibrary: archiveExportsToLibrary ?? false,
    })

    return expandCompositeExportItems(snapshot).length
  }, [
    backgroundFolders,
    backgrounds,
    archiveExportsToLibrary,
    customValue,
    customVariables,
    smartMatchOrientation,
    enabledPresets,
    globalFitMode,
    outputRuleGroups,
    preserveSourceDir,
    presets,
    recursiveBackgrounds,
    selectedGroup,
  ])
  const currentPreviewPath = useMemo(
    () => getPreviewPath(previewHistory, previewHistoryIndex),
    [previewHistory, previewHistoryIndex],
  )
  const currentPreviewBackground = useMemo(
    () => backgrounds.find((background) => background.path === currentPreviewPath) ?? null,
    [backgrounds, currentPreviewPath],
  )
  const selectedPreviewPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPreviewPresetId) ?? enabledPresets[0] ?? null,
    [enabledPresets, presets, selectedPreviewPresetId],
  )
  const canGoPrevious = previewHistoryIndex > 0
  const canGoNext = previewHistoryIndex >= 0 && previewHistoryIndex < previewHistory.length - 1
  const canPickRandom = backgrounds.length > 0

  const missingRequirements: string[] = []
  if (backgrounds.length === 0) missingRequirements.push('未加载背景图片')
  if (!selectedGroup) missingRequirements.push('未选择预设组')
  if (enabledPresets.length === 0) missingRequirements.push('未勾选任何预设')
  else {
    const presetsMissingDir = enabledPresets.filter((preset) => !preset.outputRootPath.trim())
    if (presetsMissingDir.length > 0) {
      missingRequirements.push(`以下预设缺少输出目录：${presetsMissingDir.map((p) => p.name).join('、')}`)
    }
  }
  if (plannedExportCount === 0 && enabledPresets.length > 0 && backgrounds.length > 0) {
    const hasEnabledRules = enabledPresets.some(
      (preset) =>
        preset.outputRuleGroupsOverride?.some((g) => g.rules.some((r) => r.enabled)) ||
        outputRuleGroups.some((g) => g.rules.some((r) => r.enabled)),
    )
    if (!hasEnabledRules) {
      missingRequirements.push('当前预设均未启用任何尺寸规则')
    } else if (smartMatchOrientation) {
      missingRequirements.push('原图比例与启用的尺寸规则比例不匹配（横版配横版，竖版配竖版，方形配方形）')
    } else {
      missingRequirements.push('由于未知原因无法生成导出计划')
    }
  }

  const canStartExport = missingRequirements.length === 0

  // 子文件夹拆分警告：文件夹命名跟随文件名模板（去掉 {index} 序号）。
  // 去掉序号后若仍含 {source}/{sourceDir}（每张背景都不同），或输出根目录含
  // {index}/{source}/{sourceDir}，批量送入的一组图片会被拆成每图一个独立文件夹，
  // 看起来像"每张图一个任务"。这是可配置行为，不阻止导出，仅提示。
  const folderSplitWarnings: string[] = []
  if (backgrounds.length > 1 && enabledPresets.length > 0) {
    const folderSplitVariables = ['{source}', '{sourceDir}']
    const rootSplitVariables = ['{index}', '{source}', '{sourceDir}']
    const warnedPresetNames = new Set<string>()
    for (const preset of enabledPresets) {
      if (warnedPresetNames.has(preset.name)) continue
      const folderTemplate = stripTemplateIndex(preset.filenameTemplate || '')
      const folderVariable = folderSplitVariables.find((variable) => folderTemplate.includes(variable))
      const rootVariable = rootSplitVariables.find((variable) => (preset.outputRootPath || '').includes(variable))
      const variableLabel = folderVariable ?? rootVariable
      if (variableLabel) {
        warnedPresetNames.add(preset.name)
        folderSplitWarnings.push(
          `预设「${preset.name}」的文件名模板去掉序号后包含 ${variableLabel}，${backgrounds.length} 张背景图会被拆成 ${backgrounds.length} 个独立文件夹；如需聚合到同一文件夹，请把源文件相关变量移出文件名模板。`,
        )
      }
    }
  }

  // 分步向导状态：素材 → 预设与规则 → 分配（可选）→ 导出
  const exportSteps = useMemo(
    () => [
      { label: '① 素材', ready: backgrounds.length > 0, optional: false },
      {
        label: '② 预设与规则',
        ready: Boolean(selectedGroup && enabledPresets.length > 0 && plannedExportCount > 0),
        optional: false,
      },
      { label: '③ 分配', ready: true, optional: true },
      { label: '④ 导出', ready: canStartExport, optional: false },
    ],
    [backgrounds.length, canStartExport, enabledPresets.length, plannedExportCount, selectedGroup],
  )

  useEffect(() => {
    if (backgroundFolders.length > 0 && backgrounds.length === 0 && !isLoadingBackgrounds) {
      void loadBackgroundFolders(backgroundFolders, recursiveBackgrounds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  useEffect(
    () => () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    let active = true

    async function loadPreview() {
      if (!currentPreviewPath) {
        setPreviewFile(null)
        setPreviewStatus(backgrounds.length ? '选择预览步骤以查看当前背景。' : '加载背景后，这里将显示随机预览。')
        return
      }

      if (!electronApi?.isElectron || !electronApi.readImageFile) {
        setPreviewFile(null)
        setPreviewStatus('当前环境不支持桌面端预览。')
        return
      }

      setIsLoadingPreview(true)
      setPreviewStatus('正在加载预览背景...')

      try {
        // dataUrl 素材（素材库送入、无本地文件）直接使用内存数据，否则从磁盘读取
        const dataUrlBackground = currentPreviewBackground?.dataUrl
        const file: PreviewFile | null = dataUrlBackground
          ? {
              path: currentPreviewBackground.path,
              name: currentPreviewBackground.name,
              dataUrl: dataUrlBackground,
            }
          : await electronApi.readImageFile(currentPreviewPath)
        if (!active) return
        if (!file?.dataUrl) {
          setPreviewFile(null)
          setPreviewCanvasSize(null)
          setPreviewStatus('无法从磁盘读取预览图片。')
          return
        }
        // 解码背景图真实尺寸，预览画布跟随图片比例（完整显示，不再被压成固定 16:9）
        let nextSize: { width: number; height: number } | null = null
        try {
          const source = await loadImageOriented(file.dataUrl)
          const sourceWidth = getSourceWidth(source)
          const sourceHeight = getSourceHeight(source)
          if (sourceWidth > 0 && sourceHeight > 0) {
            const MAX_PREVIEW_EDGE = 960
            const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(sourceWidth, sourceHeight))
            nextSize = {
              width: Math.max(1, Math.round(sourceWidth * scale)),
              height: Math.max(1, Math.round(sourceHeight * scale)),
            }
          }
          // ImageBitmap 用完即释放，避免连续切换预览时泄漏解码位图
          if (typeof (source as ImageBitmap).close === 'function') {
            ;(source as ImageBitmap).close()
          }
        } catch {
          // 尺寸解码失败时回退到预设画布比例
          nextSize = null
        }
        if (!active) return
        setPreviewFile(file)
        setPreviewCanvasSize(nextSize)
        setPreviewStatus('预览按原图真实比例显示。')
      } catch (error) {
        if (!active) return
        setPreviewFile(null)
        setPreviewStatus(error instanceof Error ? error.message : '预览图片加载失败。')
      } finally {
        if (active) setIsLoadingPreview(false)
      }
    }

    void loadPreview()
    return () => {
      active = false
    }
  }, [
    backgrounds.length,
    currentPreviewBackground?.dataUrl,
    currentPreviewBackground?.name,
    currentPreviewBackground?.path,
    currentPreviewPath,
    electronApi,
  ])

  // 对比网格：最多同时预览 4 个已勾选预设
  const previewPresets = useMemo(() => enabledPresets.slice(0, 4), [enabledPresets])

  useEffect(() => {
    if (!previewFile?.dataUrl || previewPresets.length === 0) return
    let active = true
    // 预览画布跟随背景图真实比例；尺寸解码失败时回退到预设画布比例
    const targetSize = previewCanvasSize ?? previewPresets[0]?.baseCanvas
    const renders = previewPresets.map(async (preset, index) => {
      const canvas = previewCanvasRefs.current[index]
      if (!canvas || !targetSize) return
      try {
        await renderCompositeV2ToCanvas(
          {
            backgroundDataUrl: previewFile.dataUrl,
            preset,
            targetSize,
            fitMode: globalFitMode,
          },
          canvas,
          { isStale: () => !active },
        )
      } catch (error) {
        if (active) setPreviewStatus(error instanceof Error ? error.message : '合成预览失败。')
      }
    })
    void Promise.all(renders)
    return () => {
      active = false
    }
  }, [globalFitMode, previewCanvasSize, previewFile?.dataUrl, previewPresets])

  async function loadBackgroundFolders(nextFolders: string[], nextRecursive: boolean) {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    const seenFolders = new Set<string>()
    const validFolders = nextFolders
      .map((folder) => folder.trim())
      .filter((folder) => {
        if (!folder) return false
        const key = folder.replace(/[\\/]+$/, '').toLocaleLowerCase()
        if (seenFolders.has(key)) return false
        seenFolders.add(key)
        return true
      })
    const requestId = ++scanRequestRef.current

    if (!electronApi?.isElectron || !electronApi.scanEnteredCompositeBackgroundFolder) {
      setIsLoadingBackgrounds(false)
      setBackgroundStatus('桌面端文件夹读取在当前环境不可用。')
      return
    }

    setRecursiveBackgrounds(nextRecursive)

    if (validFolders.length === 0) {
      setIsLoadingBackgrounds(false)
      setBackgroundStatus('请添加至少一个背景文件夹。')
      setBackgroundFolders([])
      setBackgrounds([])
      return
    }

    setIsLoadingBackgrounds(true)
    setBackgroundStatus(nextRecursive ? '正在递归加载背景图片...' : '正在加载背景图片...')

    try {
      let allFiles: typeof backgrounds = []
      const resolvedFolders: string[] = []
      for (const folder of validFolders) {
        const result = await electronApi.scanEnteredCompositeBackgroundFolder(folder, nextRecursive)
        if (requestId !== scanRequestRef.current) return
        if (!result.success) throw new Error(`${folder}：${result.error}`)
        resolvedFolders.push(result.folderPath)
        allFiles = [...allFiles, ...result.files]
      }
      if (requestId !== scanRequestRef.current) return
      const nextBackgrounds = naturalSortBackgrounds(allFiles)
      setBackgroundFolders(resolvedFolders)
      setBackgrounds(nextBackgrounds)
      setBackgroundStatus(
        nextBackgrounds.length
          ? `已加载 ${nextBackgrounds.length} 个背景文件。`
          : '在选择的文件夹中没有找到支持的背景图片。',
      )
    } catch (error) {
      if (requestId !== scanRequestRef.current) return
      setBackgrounds([])
      setBackgroundStatus(error instanceof Error ? error.message : '加载背景文件夹失败。')
    } finally {
      if (requestId === scanRequestRef.current) setIsLoadingBackgrounds(false)
    }
  }

  function scheduleFolderScan(nextFolders: string[]) {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    scanTimerRef.current = setTimeout(() => {
      void loadBackgroundFolders(nextFolders, recursiveBackgrounds)
    }, 500)
  }

  function updateFolderInput(index: number, value: string, immediate = false) {
    const nextFolders = folderInputs.map((folder, folderIndex) => (folderIndex === index ? value : folder))
    setFolderInputs(nextFolders)
    if (immediate) void loadBackgroundFolders(nextFolders, recursiveBackgrounds)
    else scheduleFolderScan(nextFolders)
  }

  async function handleBrowseBackgroundFolder(index: number) {
    if (!electronApi?.isElectron || !electronApi.selectDirectory || !electronApi.scanEnteredCompositeBackgroundFolder) {
      setBackgroundStatus('桌面端文件夹选择在当前环境不可用。')
      return
    }

    const nextFolder = await electronApi.selectDirectory()
    if (!nextFolder) {
      setBackgroundStatus('已取消选择背景文件夹。')
      return
    }

    const nextFolders = folderInputs.map((folder, folderIndex) => (folderIndex === index ? nextFolder : folder))
    setFolderInputs(nextFolders)
    await loadBackgroundFolders(nextFolders, recursiveBackgrounds)
  }

  async function handleRemoveBackgroundFolder(index: number) {
    const remainingFolders = folderInputs.filter((_, folderIndex) => folderIndex !== index)
    const nextFolders = remainingFolders.length ? remainingFolders : ['']
    setFolderInputs(nextFolders)
    useStore.getState().showToast('已移除文件夹地址', 'success')
    await loadBackgroundFolders(nextFolders, recursiveBackgrounds)
  }

  async function handleRecursiveChange(nextRecursive: boolean) {
    if (!folderInputs.some((folder) => folder.trim())) {
      setRecursiveBackgrounds(nextRecursive)
      setBackgroundStatus('递归模式已更新，请输入文件夹地址。')
      return
    }

    await loadBackgroundFolders(folderInputs, nextRecursive)
  }

  async function handleReloadBackgrounds() {
    if (!folderInputs.some((folder) => folder.trim())) {
      setBackgroundStatus('请先添加背景文件夹。')
      return
    }

    await loadBackgroundFolders(folderInputs, recursiveBackgrounds)
  }

  function handleRandomPreview() {
    if (!backgrounds.length) return
    const randomIndex = Math.min(backgrounds.length - 1, Math.max(0, Math.floor(Math.random() * backgrounds.length)))
    const nextBackground = backgrounds[randomIndex] ?? backgrounds[0]
    if (!nextBackground) return
    pushPreviewBackground(nextBackground.path)
    setPreviewStatus(`预览已切换至 ${nextBackground.name}。`)
  }

  function handleTogglePreset(presetId: string, checked: boolean) {
    const orderedIds = groupPresets.map((preset) => preset.id)
    const nextSelectedIds = checked
      ? orderedIds.filter((id) => id === presetId || enabledPresetIdsSet.has(id))
      : orderedIds.filter((id) => id !== presetId && enabledPresetIdsSet.has(id))
    setEnabledPresetIdsForRun(nextSelectedIds)
  }

  async function handleStartExport() {
    if (!selectedGroup || !canStartExport) return
    const startedAt = Date.now()
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const snapshot = createCompositeExportSnapshot(
      {
        id: `export-${startedAt}`,
        date,
        backgroundFolders,
        recursive: recursiveBackgrounds,
        backgrounds,
        presets,
        presetGroup: selectedGroup,
        enabledPresetIds: enabledPresets.map((preset) => preset.id),
        outputRuleGroups,
        smartMatchOrientation,
        custom: customValue,
        customVariables,
        fitMode: globalFitMode,
        preserveSourceDir,
        archiveExportsToLibrary: archiveExportsToLibrary ?? false,
      },
      startedAt,
    )
    resetExportResults()
    // 每次导出重新显示成功提示条（若上次被关闭）
    setDismissSuccessNotice(false)
    // 初始化任务流（每个输出一个任务卡片，含 pending/done/failed 状态）
    setExportTasks(
      expandCompositeExportItems(snapshot).map((item) => ({
        key: `${item.preset.id}|${item.outputRule.channelName}|${item.outputRule.name}|${item.index}`,
        backgroundPath: item.background.path,
        presetId: item.preset.id,
        presetName: item.preset.name,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        index: item.index,
        date: snapshot.date,
        custom: snapshot.custom,
        status: 'pending' as const,
      })),
    )
    // 暂停/取消状态存放在 store 中：弹窗关闭重开后，后台任务依旧能被新的 UI 控制
    setExportCancelRequested(false)
    setDistributionCancelRequested(false)
    setExportStatus('running')
    setExportProgress(0, plannedExportCount)
    setRunStatusText('正在导出...')
    const successes: typeof exportSuccesses = []
    const failures: typeof exportFailures = []
    try {
      await runCompositeV2Export(snapshot, {
        onProgress: setExportProgress,
        onSuccess: (item) => {
          successes.push(item)
          addExportSuccess(item)
          updateExportTask(`${item.presetId}|${item.channel}|${item.size}|${item.index}`, {
            status: 'done',
            outputPath: item.path,
          })
        },
        onFailure: (item) => {
          failures.push(item)
          addExportFailure(item)
          updateExportTask(`${item.presetId}|${item.channel}|${item.size}|${item.index ?? ''}`, {
            status: 'failed',
            reason: item.reason,
          })
        },
        shouldPause: () => useCompositeV2Store.getState().exportStatus === 'paused',
        shouldCancel: () => useCompositeV2Store.getState().exportCancelRequested,
      })
      const canceled = useCompositeV2Store.getState().exportCancelRequested
      setExportStatus(canceled ? 'canceled' : 'completed')

      let finalStatusText = canceled ? '导出已取消。' : `导出完成：${successes.length} 成功，${failures.length} 失败。`

      // Auto distribution
      let distributionStatus: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | undefined
      let distributionSuccessCount = 0
      let distributionFailureCount = 0
      let distributionErrors: string[] = []
      const distributionSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[] = []
      const distributionFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[] = []

      if (!canceled && distributionConfig.enabled && successes.length > 0 && electronApi) {
        if (!distributionConfig.startDate || !/^(\d{4})(\d{2})(\d{2})$/.test(distributionConfig.startDate)) {
          finalStatusText += `\n分配跳过：起始日期格式错误（期望 YYYYMMDD）。`
          distributionStatus = 'failed'
          distributionErrors.push('起始日期格式错误，期望 YYYYMMDD')
        } else {
          setRunStatusText('正在执行分配...')
          distributionStatus = 'running'
          setDistributionStatus('running')
          resetDistributionResults()
          const distResult = await runDistribution(successes, distributionConfig, electronApi, presets, {
            onProgress: setDistributionProgress,
            onSuccess: (item) => {
              distributionSuccesses.push(item)
              addDistributionSuccess(item)
            },
            onFailure: (item) => {
              distributionFailures.push(item)
              addDistributionFailure(item)
            },
            shouldCancel: () => useCompositeV2Store.getState().distributionCancelRequested,
          })
          distributionSuccessCount = distResult.success
          distributionFailureCount = distResult.failed
          distributionErrors = distResult.errors
          if (distResult.canceled) {
            distributionStatus = 'canceled'
            setDistributionStatus('canceled')
            finalStatusText += `\n分配已取消：已完成 ${distributionSuccessCount} 个。`
          } else {
            distributionStatus = distResult.errors.length > 0 && distResult.success === 0 ? 'failed' : 'completed'
            setDistributionStatus(distributionStatus)
            finalStatusText += `\n分配完成：${distributionSuccessCount} 成功，${distributionFailureCount} 失败。`
          }
          if (distResult.errors.length > 0) {
            console.error('分发错误：', distResult.errors)
          }
        }
      }

      setRunStatusText(finalStatusText)

      addHistoryRecord({
        id: snapshot.id,
        status: canceled ? 'canceled' : failures.length ? 'completed-with-failures' : 'completed',
        startedAt,
        endedAt: Date.now(),
        backgroundFolders,
        recursive: recursiveBackgrounds,
        backgroundCount: backgrounds.length,
        presetGroupName: selectedGroup.name,
        enabledPresetCount: enabledPresets.length,
        plannedCount: plannedExportCount,
        successCount: successes.length,
        failureCount: failures.length,
        successes,
        failures,
        distributionStatus,
        distributionSuccessCount,
        distributionFailureCount,
        distributionErrors,
        distributionSuccesses,
        distributionFailures,
      })
    } catch (error) {
      setExportStatus('failed')
      setRunStatusText(error instanceof Error ? error.message : '导出运行失败。')
    }
  }

  function handlePauseResume() {
    const isPaused = useCompositeV2Store.getState().exportStatus === 'paused'
    const nextPaused = !isPaused
    setExportStatus(nextPaused ? 'paused' : 'running')
    setRunStatusText(nextPaused ? '导出已暂停。' : '正在继续导出...')
  }

  async function cancelExport(deleteExportedFiles: boolean) {
    setExportCancelRequested(true)
    setExportStatus('canceling')
    if (deleteExportedFiles && exportSuccesses.length) {
      const cleanup = await window.electronAPI?.deleteCompositeFiles?.(exportSuccesses.map((item) => item.path))
      setRunStatusText(
        cleanup?.failed.length ? `已取消，${cleanup.failed.length} 个文件删除失败。` : '已取消并删除已导出文件。',
      )
    }
  }

  function handleCancelDistribution() {
    setDistributionCancelRequested(true)
    setRunStatusText('正在取消分配...')
  }

  /** 打开第一个成功输出的所在目录（资源管理器），失败时给出提示 */
  function handleOpenOutputFolder() {
    const firstSuccess = exportSuccesses[0]
    if (!firstSuccess) return
    const directory = firstSuccess.path.replace(/[/\\][^/\\]+$/, '')
    void window.electronAPI?.openInExplorer?.(directory).then((result) => {
      if (result && !result.ok) {
        void import('../../../store').then(({ useStore }) =>
          useStore
            .getState()
            .showToast(result.error ? `打开输出文件夹失败：${result.error}` : '打开输出文件夹失败', 'error'),
        )
      }
    })
  }

  /** 单张失败任务重试：走与主导出相同的渲染管线，成功后更新任务与结果列表 */
  async function handleRetryTask(task: import('../lib/compositeV2Types').CompositeV2ExportTask) {
    updateExportTask(task.key, { status: 'running', reason: undefined })
    setRunStatusText(`正在重试 ${task.presetName} / ${task.size}...`)
    try {
      await retryCompositeExportTask(task, {
        onSuccess: (item) => {
          addExportSuccess(item)
          updateExportTask(task.key, { status: 'done', outputPath: item.path })
          useStore.getState().showToast('已重新导出', 'success')
        },
        onFailure: (item) => {
          addExportFailure(item)
          updateExportTask(task.key, { status: 'failed', reason: item.reason })
          useStore.getState().showToast(`重试失败：${item.reason}`, 'error')
        },
      })
    } catch (error) {
      updateExportTask(task.key, {
        status: 'failed',
        reason: error instanceof Error ? error.message : '重试失败',
      })
      useStore.getState().showToast(`重试失败：${error instanceof Error ? error.message : '重试失败'}`, 'error')
    }
  }

  function handleCancel() {
    openConfirmDialog({
      title: '取消当前导出？',
      message: '导出任务会立即停止，尚未处理的文件不会继续生成。',
      confirmText: '继续取消',
      tone: 'warning',
      action: () => {
        if (!exportSuccesses.length) {
          void cancelExport(false)
          return
        }
        openConfirmDialog({
          title: '处理已导出的文件',
          message: `已经导出 ${exportSuccesses.length} 个文件。是否同时删除这些文件？`,
          confirmText: '删除文件',
          cancelText: '保留文件',
          tone: 'danger',
          action: () => void cancelExport(true),
          cancelAction: () => void cancelExport(false),
        })
      },
    })
  }

  return (
    <>
      <div className="relative grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px_300px] overflow-hidden border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim">
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden border-r border-ds-border dark:border-ds-border">
          <div className="grid min-h-0 grid-cols-[230px_minmax(0,1fr)_240px] overflow-hidden border-b border-ds-border dark:border-ds-border">
            <section className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim">
              <div className="border-b border-ds-border px-3 py-2 dark:border-ds-border">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text-subtle">原图来源</h2>
                  <button
                    type="button"
                    onClick={() => setAssetPickerOpen(true)}
                    className="shrink-0 rounded-md border border-ds-border px-2 py-1 text-xs font-medium text-ds-text transition hover:bg-ds-subtle active:scale-[0.98] dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                  >
                    从素材库选择
                  </button>
                </div>
                <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
                  选择历史素材，或加载本地文件夹中的图片。
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col">
                <div className="flex flex-col gap-2 mb-3 shrink-0">
                  <span className="text-xs font-medium text-ds-text dark:text-ds-muted">文件夹地址</span>
                  {folderInputs.map((folder, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        aria-label={`文件夹地址 ${index + 1}`}
                        placeholder="输入或粘贴文件夹地址"
                        value={folder}
                        onChange={(event) => updateFolderInput(index, event.target.value)}
                        onPaste={(event) => {
                          event.preventDefault()
                          updateFolderInput(index, event.clipboardData.getData('text'), true)
                        }}
                        onBlur={() => void loadBackgroundFolders(folderInputs, recursiveBackgrounds)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return
                          event.preventDefault()
                          void loadBackgroundFolders(folderInputs, recursiveBackgrounds)
                        }}
                        className="min-w-0 flex-1 rounded-md border border-ds-border px-3 py-1.5 text-xs outline-none transition focus:border-ds-primary dark:border-ds-border dark:bg-ds-scrim dark:text-ds-text-subtle"
                      />
                      <button
                        type="button"
                        aria-label={`浏览文件夹地址 ${index + 1}`}
                        onClick={() => void handleBrowseBackgroundFolder(index)}
                        disabled={isLoadingBackgrounds || !canBrowseBackgrounds}
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-ds-border text-ds-text transition hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface shrink-0"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除文件夹地址 ${index + 1}`}
                        onClick={() => void handleRemoveBackgroundFolder(index)}
                        className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-danger-subtle hover:text-ds-danger dark:border-ds-border dark:hover:bg-ds-danger/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFolderInputs([...folderInputs, ''])}
                    className="inline-flex h-[30px] w-full items-center justify-center gap-1.5 rounded-md bg-ds-primary-subtle px-3 text-xs font-medium text-ds-primary transition hover:bg-ds-primary-subtle dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加文件夹地址
                  </button>
                </div>

                <div className="mt-3 rounded-md bg-ds-surface px-3 py-2 text-xs text-ds-muted dark:bg-ds-surface dark:text-ds-muted shrink-0">
                  <div className="mt-1">{backgroundStatus}</div>
                </div>

                <label className="mt-4 flex items-center gap-2 text-sm text-ds-text dark:text-ds-text-subtle shrink-0">
                  <input
                    type="checkbox"
                    aria-label="包含子文件夹背景"
                    checked={recursiveBackgrounds}
                    onChange={(event) => void handleRecursiveChange(event.target.checked)}
                  />
                  <span>递归加载子文件夹</span>
                </label>

                <button
                  type="button"
                  onClick={() => void handleReloadBackgrounds()}
                  disabled={isLoadingBackgrounds || backgroundFolders.length === 0}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-ds-border px-3 py-2 text-sm font-medium text-ds-text transition hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface shrink-0"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingBackgrounds ? 'animate-spin' : ''}`} />
                  <span>重新加载</span>
                </button>

                <dl className="mt-4 grid gap-3 text-sm text-ds-muted dark:text-ds-muted">
                  <div className="rounded-md border border-ds-border px-3 py-2 dark:border-ds-border">
                    <dt className="text-xs text-ds-muted dark:text-ds-muted">已加载</dt>
                    <dd className="mt-1 font-medium">{backgrounds.length} 张</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim">
              <div className="flex items-start justify-between gap-3 border-b border-ds-border px-4 py-2 dark:border-ds-border">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text-subtle">合成预览</h2>
                  <p className="mt-1 truncate text-xs text-ds-muted dark:text-ds-muted">
                    {currentPreviewBackground?.name ?? '尚未选择背景'}
                    {currentPreviewBackground?.relativeDir ? ` - ${currentPreviewBackground.relativeDir}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label="上一个预览"
                    title="上一个预览"
                    onClick={previousPreviewBackground}
                    disabled={!canGoPrevious}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-surface"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="随机预览"
                    title="随机预览"
                    onClick={handleRandomPreview}
                    disabled={!canPickRandom}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-surface"
                  >
                    <Shuffle className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="下一个预览"
                    title="下一个预览"
                    onClick={nextPreviewBackground}
                    disabled={!canGoNext}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-surface"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div
                  className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${
                    previewPresets.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {previewFile?.dataUrl && previewPresets.length > 0 ? (
                    previewPresets.map((preset, index) => {
                      const isSelected = preset.id === selectedPreviewPresetId
                      return (
                        <div
                          key={preset.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`对比预览预设 ${preset.name}`}
                          onClick={() => setSelectedPreviewPresetId(preset.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedPreviewPresetId(preset.id)
                            }
                          }}
                          className={`flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-md border bg-ds-surface transition dark:bg-ds-scrim ${
                            isSelected
                              ? 'border-ds-primary ring-1 ring-ds-primary/40 dark:border-ds-primary'
                              : 'border-ds-border hover:border-ds-primary/50 dark:border-ds-border'
                          }`}
                        >
                          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-1.5">
                            <canvas
                              ref={(el) => {
                                previewCanvasRefs.current[index] = el
                              }}
                              aria-label={`预览 ${previewFile.name} 与 ${preset.name}`}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="shrink-0 truncate border-t border-ds-border/60 px-2 py-1 text-xs dark:border-ds-border/60">
                            <span
                              className={
                                isSelected
                                  ? 'font-medium text-ds-primary dark:text-ds-primary'
                                  : 'text-ds-muted dark:text-ds-muted'
                              }
                            >
                              {preset.name}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="col-span-2 flex items-center justify-center rounded-md border border-dashed border-ds-border bg-ds-surface p-6 dark:border-ds-border dark:bg-ds-surface">
                      <div className="px-6 text-center text-sm text-ds-muted dark:text-ds-muted">
                        {isLoadingPreview ? '正在加载预览...' : '加载背景并勾选预设后，这里并排显示合成对比预览。'}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-ds-muted dark:text-ds-muted">
                  <span className="truncate">{previewStatus}</span>
                  <span className="shrink-0">
                    {previewHistoryIndex >= 0 ? `${previewHistoryIndex + 1} / ${previewHistory.length}` : '0 / 0'}
                  </span>
                </div>
              </div>
            </section>

            <div className="min-h-0 overflow-hidden bg-ds-surface dark:bg-ds-scrim">
              <div className="h-full min-h-0 p-4">
                <DistributionSettingsPanel />
              </div>
            </div>
          </div>

          <div className="shrink-0 bg-ds-surface dark:bg-ds-scrim border-t border-ds-border dark:border-ds-border">
            <div className="p-4 pt-3 pb-[14px]">
              <GlobalOutputRulesPanel />
            </div>
          </div>
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim">
          <div className="border-b border-ds-border px-4 py-2 dark:border-ds-border">
            <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text-subtle">本次导出</h2>
            <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
              每次选择一个预设组，并临时勾选本次需要导出的产品预设。
            </p>
          </div>

          {/* 分步向导：四步状态一目了然，缺失项用感叹号标记 */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ds-border px-4 py-2 dark:border-ds-border">
            {exportSteps.map((step) => (
              <span
                key={step.label}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 ${
                  step.ready
                    ? 'border-ds-success/40 bg-ds-success-subtle text-ds-success dark:border-ds-success/30 dark:bg-ds-success/10 dark:text-ds-success'
                    : 'border-ds-warning/40 bg-ds-warning-subtle text-ds-warning dark:border-ds-warning/30 dark:bg-ds-warning/10 dark:text-ds-warning'
                }`}
              >
                <span aria-hidden="true">{step.ready ? '✓' : '!'}</span>
                <span>
                  {step.label}
                  {step.optional ? '（可选）' : ''}
                </span>
              </span>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="space-y-1">
                {groups.map((group) => {
                  const isSelected = group.id === selectedGroup?.id
                  const isExpanded = expandedGroups.has(group.id)
                  const currentGroupPresets = group.presetIds
                    .map((presetId) => presets.find((preset) => preset.id === presetId))
                    .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset))

                  return (
                    <div key={group.id} className="space-y-0.5">
                      <div className={`rounded-md ${isSelected ? 'bg-ds-primary-subtle dark:bg-ds-primary/10' : ''}`}>
                        <div className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm group">
                          <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => toggleGroup(group.id, e)}
                              className="p-0.5 text-ds-muted hover:text-ds-muted dark:hover:text-ds-text shrink-0"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0"
                              onClick={() => setSelectedPresetGroup(group.id)}
                            >
                              {isExpanded ? (
                                <FolderOpen className="h-4 w-4 shrink-0 text-ds-primary" />
                              ) : (
                                <Folder className="h-4 w-4 shrink-0 text-ds-primary" />
                              )}
                              <span
                                className={`truncate ${isSelected ? 'text-ds-primary dark:text-ds-primary' : 'text-ds-text dark:text-ds-text-subtle'}`}
                              >
                                {group.name}
                              </span>
                            </button>
                          </div>
                          <span className="text-xs opacity-70 w-4 text-right">{group.presetIds.length}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pl-6 pr-2 py-1 space-y-0.5">
                          {currentGroupPresets.map((preset) => {
                            const isEnabled = enabledPresetIdsSet.has(preset.id)
                            const isPreviewPreset = selectedPreviewPresetId === preset.id

                            return (
                              <div
                                key={preset.id}
                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition ${
                                  isPreviewPreset
                                    ? 'bg-ds-primary-subtle dark:bg-ds-primary/20'
                                    : 'hover:bg-ds-subtle dark:hover:bg-ds-surface'
                                }`}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0 opacity-50 text-ds-muted" />
                                <button
                                  type="button"
                                  aria-pressed={isPreviewPreset}
                                  aria-label={`预览预设 ${preset.name}`}
                                  onClick={() => {
                                    if (group.id !== selectedGroup?.id) {
                                      setSelectedPresetGroup(group.id)
                                    }
                                    setSelectedPreviewPresetId(preset.id)
                                  }}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <span
                                    className={`truncate text-xs ${isPreviewPreset ? 'text-ds-primary dark:text-ds-primary font-medium' : 'text-ds-text dark:text-ds-text-subtle'}`}
                                  >
                                    {preset.name}
                                  </span>
                                </button>
                                <label className="mt-0.5 inline-flex shrink-0 items-center text-xs text-ds-muted dark:text-ds-muted">
                                  <input
                                    type="checkbox"
                                    value={preset.id}
                                    aria-label={`包含预设 ${preset.name}`}
                                    checked={isEnabled}
                                    onChange={(event) => {
                                      if (group.id !== selectedGroup?.id) {
                                        setSelectedPresetGroup(group.id)
                                      }
                                      handleTogglePreset(preset.id, event.target.checked)
                                    }}
                                  />
                                </label>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 shrink-0 border-t border-ds-border pt-4 dark:border-ds-border">
              <label className="block text-xs font-medium text-ds-muted dark:text-ds-muted">
                自定义参数
                <input
                  value={customValue}
                  onChange={(event) => setCustomValue(event.target.value)}
                  placeholder="本次导出全局共用"
                  className="mt-1 w-full rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-text outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus/10 dark:border-ds-border dark:bg-ds-scrim dark:text-ds-text-subtle"
                />
              </label>

              <label className="mt-4 flex items-center gap-2 text-sm text-ds-text dark:text-ds-text-subtle">
                <input
                  type="checkbox"
                  aria-label="保留源文件夹层级"
                  checked={preserveSourceDir}
                  onChange={(event) => setPreserveSourceDir(event.target.checked)}
                />
                <span>保留源文件夹层级</span>
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-ds-text dark:text-ds-text-subtle">
                <input
                  type="checkbox"
                  aria-label="导出成图归档到素材库"
                  checked={archiveExportsToLibrary}
                  onChange={(event) => setArchiveExportsToLibrary(event.target.checked)}
                />
                <span>导出成图归档到素材库（写入 cache-images）</span>
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-ds-text dark:text-ds-text-subtle">
                <input
                  type="checkbox"
                  aria-label="智能匹配原图与尺寸比例"
                  checked={smartMatchOrientation}
                  onChange={(event) => setSmartMatchOrientation(event.target.checked)}
                />
                <span>智能匹配原图与尺寸比例（横配横、竖配竖）</span>
              </label>

              <div className="mt-4 rounded-md bg-ds-surface px-3 py-2 text-xs text-ds-muted dark:bg-ds-surface dark:text-ds-muted">
                <div>本次已选择 {enabledPresets.length} 个预设。</div>
                {exportStatus === 'idle' ? (
                  <>
                    {missingRequirements.length > 0 ? (
                      <div className="mt-1 text-ds-danger dark:text-ds-danger">
                        无法导出，缺少以下配置：
                        <ul className="list-inside list-disc pl-1 mt-0.5">
                          {missingRequirements.map((req, i) => (
                            <li key={i}>{req}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="mt-1 text-ds-success dark:text-ds-success">配置已就绪。</div>
                    )}
                    {folderSplitWarnings.length > 0 && (
                      <div className="mt-1 text-ds-warning dark:text-ds-warning">
                        <ul className="list-inside list-disc pl-1 mt-0.5">
                          {folderSplitWarnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-1">{canStartExport ? `预计输出 ${plannedExportCount} 张` : ''}</div>
                  </>
                ) : (
                  <div className="mt-1">{runStatusText}</div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleStartExport()}
                disabled={
                  !canStartExport ||
                  exportStatus === 'running' ||
                  exportStatus === 'paused' ||
                  exportStatus === 'canceling'
                }
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ds-primary px-3 py-2 text-sm font-semibold text-ds-text-inverse transition hover:bg-ds-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                <span>开始导出</span>
              </button>
              {(exportStatus === 'running' || exportStatus === 'paused') && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handlePauseResume}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-ds-border px-3 py-2 text-sm dark:border-ds-border"
                  >
                    {exportStatus === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {exportStatus === 'paused' ? '继续' : '暂停'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-ds-danger/35 px-3 py-2 text-sm text-ds-danger dark:border-ds-danger/30"
                  >
                    <Square className="h-4 w-4" />
                    取消
                  </button>
                </div>
              )}
              {distributionStatus === 'running' && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void handleCancelDistribution()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-ds-danger/35 px-3 py-2 text-sm text-ds-danger dark:border-ds-danger/30"
                  >
                    <Square className="h-4 w-4" />
                    取消分配
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="min-h-0 overflow-hidden bg-ds-surface dark:bg-ds-scrim">
          <ExportResultsPanel
            status={exportStatus}
            completed={exportCompleted}
            total={exportTotal}
            history={history}
            successes={exportSuccesses}
            failures={exportFailures}
            distributionStatus={distributionStatus}
            distributionCompleted={distributionCompleted}
            distributionTotal={distributionTotal}
            distributionSuccesses={distributionSuccesses}
            distributionFailures={distributionFailures}
            onRetryTask={handleRetryTask}
          />
        </div>
      </div>

      {/* 导出完成成功提示：右下角浮动小卡片，可直接打开输出文件夹 */}
      {exportStatus === 'completed' && exportSuccesses.length > 0 && !dismissSuccessNotice && (
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-3 rounded-lg border border-ds-success/35 bg-ds-surface-raised px-4 py-3 shadow-lg dark:border-ds-success/25 dark:bg-ds-scrim dark:shadow-black/40">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ds-success-subtle text-ds-success dark:bg-ds-success/15 dark:text-ds-success">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">
              导出完成：{exportSuccesses.length} 张成功
              {exportFailures.length > 0 ? `，${exportFailures.length} 张失败` : ''}
            </div>
            <div className="mt-0.5 text-xs text-ds-muted dark:text-ds-muted">
              已输出至 {exportSuccesses[0]?.path.replace(/[/\\][^/\\]+$/, '')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleOpenOutputFolder()}
            className="shrink-0 rounded-md border border-ds-primary/35 bg-ds-primary-subtle px-3 py-1.5 text-xs font-medium text-ds-primary transition hover:bg-ds-primary-subtle dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
          >
            打开输出文件夹
          </button>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setDismissSuccessNotice(true)}
            className="shrink-0 rounded-md p-1 text-ds-muted transition hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <AssetPickerModal
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        selectionLimit={200}
        onSelect={(assets) => {
          if (assets.length === 0) return
          void assetCommands.openInPostprocessBatch(assets.map((asset) => asset.id))
        }}
        title="选择素材进入后期处理"
        description="所选素材会全部作为当前批量合成的原图载入（可多选）。"
      />
    </>
  )
}
