import { useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Badge,
  BoxIcon,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  Dialog,
  Disclosure,
  Drawer,
  EmptyState,
  Fieldset,
  FolderOpenIcon,
  Icon,
  IconButton,
  ImageIcon,
  Kbd,
  KeyValue,
  ListRow,
  Menu,
  MenuItem,
  MenuSeparator,
  MoonIcon,
  MoreHorizontalIcon,
  NavList,
  Panel,
  Popover,
  PlusIcon,
  Progress,
  RadioGroup,
  SearchField,
  SectionHeader,
  SegmentedControl,
  ColorSchemeSwitcher,
  ColorPresetGrid,
  COLOR_SCHEME_OPTIONS,
  type ColorSchemeValue,
  SelectField,
  SettingsIcon,
  Skeleton,
  Stat,
  StatusIndicator,
  Stepper,
  Surface,
  Switch,
  SunIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TextArea,
  TextField,
  Thumbnail,
  ToastMessage,
  Toolbar,
  Tooltip,
  CopyIcon,
  DialogPane,
  DialogWorkspace,
  TrashIcon,
  componentCategoryLabels,
  componentSpecs,
  interactionPatterns,
  legacyComponentCoverage,
  pageCoverage,
} from '.'

const colors = [
  ['主色', '--ds-color-primary'],
  ['成功', '--ds-color-success'],
  ['警告', '--ds-color-warning'],
  ['危险', '--ds-color-danger'],
  ['信息', '--ds-color-info'],
]

const iconShowcase = [
  ['copy', '复制'],
  ['download', '下载'],
  ['upload', '导入'],
  ['trash', '删除'],
  ['edit', '编辑'],
  ['search', '搜索'],
  ['settings', '设置'],
  ['folderOpen', '文件夹'],
  ['image', '图片'],
  ['history', '历史'],
  ['calendar', '日程'],
  ['favorite', '收藏'],
  ['layers', '图层'],
  ['play', '运行'],
  ['pause', '暂停'],
  ['refresh', '刷新'],
] as const

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <SectionHeader title={title} description={description} />
      <Surface className="p-4 sm:p-5">{children}</Surface>
    </section>
  )
}

export default function DesignSystemPreview() {
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))
  const [scheme, setScheme] = useState<ColorSchemeValue>(
    (document.documentElement.getAttribute('data-skin') as ColorSchemeValue) || 'default',
  )
  const handleSchemeChange = (next: ColorSchemeValue) => {
    setScheme(next)
    document.documentElement.setAttribute('data-skin', next)
  }
  const [checked, setChecked] = useState(true)
  const [switchOn, setSwitchOn] = useState(true)
  const [radio, setRadio] = useState('balanced')
  const [segment, setSegment] = useState('gallery')
  const [quality, setQuality] = useState('auto')
  const [search, setSearch] = useState('')
  const [count, setCount] = useState(4)
  const [tab, setTab] = useState('overview')
  const [nav, setNav] = useState('presets')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toastVisible, setToastVisible] = useState(true)
  const [catalogQuery, setCatalogQuery] = useState('')

  const filteredSpecs = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase()
    if (!query) return componentSpecs
    return componentSpecs.filter((spec) =>
      [spec.name, componentCategoryLabels[spec.category], spec.purpose, spec.useWhen]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [catalogQuery])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <main className="min-h-dvh bg-[hsl(var(--ds-color-canvas))] px-4 py-8 text-[hsl(var(--ds-color-text))] sm:px-8">
      <div className="mx-auto grid w-full min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] gap-10">
        <header className="grid gap-5 border-b border-[hsl(var(--ds-color-border))] pb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge tone="info">项目级活文档</Badge>
              <h1 className="mt-3 text-2xl font-bold tracking-[-0.025em]">DOUPAO Design System</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[hsl(var(--ds-color-text-muted))]">
                覆盖当前项目登记的全部正式 UI 模块，并为高频重复模式提供可直接复用的组件。
                业务工作台通过这些组件组合，不复制成第二套业务实现。
              </p>
            </div>
            <IconButton
              aria-label={dark ? '切换浅色主题' : '切换深色主题'}
              icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              onClick={toggleTheme}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="共享组件规范" value={componentSpecs.length} />
            <Stat label="已登记 UI 模块" value={legacyComponentCoverage.length} />
            <Stat label="交互模式配方" value={interactionPatterns.length} />
            <Stat label="页面覆盖登记" value={pageCoverage.length} />
          </div>
        </header>

        <Section title="颜色与基础动作" description="所有状态都使用语义 Token；颜色不作为唯一信息信号。">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {colors.map(([label, token]) => (
              <div key={token} className="grid gap-2 text-xs text-[hsl(var(--ds-color-text-muted))]">
                <span
                  className="h-14 rounded-ds-lg border border-ds-border"
                  style={{ background: `hsl(var(${token}))` }}
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <Toolbar label="按钮示例" className="mt-6">
            <Button leadingIcon={<PlusIcon size={15} />}>新建任务</Button>
            <Button variant="secondary">次要操作</Button>
            <Button variant="ghost">低强调操作</Button>
            <Button variant="danger">删除</Button>
            <Button loading>生成中</Button>
            <Button disabled>不可用</Button>
            <Tooltip content="添加参考图片">
              <IconButton aria-label="添加参考图片" icon={<ImageIcon size={16} />} />
            </Tooltip>
            <span className="text-xs text-[hsl(var(--ds-color-text-muted))]">
              发送 <Kbd>Enter</Kbd>
            </span>
          </Toolbar>
        </Section>

        <Section
          title="全局 SVG 图标库"
          description="业务界面统一从 design-system/icons 取图标，默认 20px、2px 线宽，装饰图标自动隐藏给读屏器。"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {iconShowcase.map(([name, label]) => (
              <div
                key={name}
                className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-ds-lg border border-ds-border bg-[hsl(var(--ds-color-surface-raised))] text-[hsl(var(--ds-color-text-muted))]"
              >
                <Icon name={name} size={20} />
                <span className="text-xs">{label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="视觉皮肤" description="一次性切换颜色、字体、圆角、阴影与表面质感，与全局皮肤注册表完全同步。">
          <div className="grid gap-4">
            <ColorPresetGrid value={scheme} onChange={handleSchemeChange} columns={4} />
            <ColorSchemeSwitcher value={scheme} onChange={handleSchemeChange} />
            <p className="text-xs text-[hsl(var(--ds-color-text-muted))]">
              上方卡片网格用于设置页，紧凑 SegmentedControl 用于顶栏等空间受限场景。切换后本页会跟随更新。
            </p>
          </div>
        </Section>

        <Section title="表单控件" description="覆盖当前项目中的输入、选择、开关、分段模式和数量调节。">
          <div className="grid gap-5 md:grid-cols-2">
            <TextField label="任务名称" placeholder="例如：夏季主图" helperText="名称用于任务列表和导出目录。" />
            <SelectField
              label="生成质量"
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
              options={[
                { value: 'auto', label: '自动' },
                { value: 'medium', label: '标准' },
                { value: 'high', label: '高质量' },
              ]}
            />
            <div className="md:col-span-2">
              <TextArea
                label="提示词"
                required
                placeholder="描述你想生成的图片…"
                helperText="说明主体、环境、光线与构图；避免堆叠同义词。"
              />
            </div>
            <Fieldset legend="生成选项" description="相关字段使用 fieldset 和 legend 建立语义分组。">
              <Checkbox
                checked={checked}
                onChange={setChecked}
                label="生成完成后自动保存"
                description="保存到当前工作区配置的输出目录。"
              />
              <Switch
                checked={switchOn}
                onCheckedChange={setSwitchOn}
                label="启用内容安全检查"
                description="设置切换后立即生效。"
              />
              <RadioGroup
                label="布局密度"
                value={radio}
                onValueChange={setRadio}
                options={[
                  { value: 'compact', label: '紧凑' },
                  { value: 'balanced', label: '平衡' },
                  { value: 'comfortable', label: '宽松' },
                ]}
                orientation="horizontal"
              />
            </Fieldset>
            <Fieldset legend="模式与数量">
              <SegmentedControl
                aria-label="工作模式"
                value={segment}
                onValueChange={setSegment}
                options={[
                  { value: 'gallery', label: '画廊' },
                  { value: 'strategy', label: '策略' },
                  { value: 'agent', label: 'Agent' },
                ]}
              />
              <div>
                <div className="mb-2 text-xs font-medium">生成数量</div>
                <Stepper label="生成数量" value={count} onChange={setCount} min={1} max={16} />
              </div>
              <SearchField
                label="搜索组件"
                value={search}
                onChange={setSearch}
                onClear={() => setSearch('')}
                placeholder="搜索任务、参数或标签…"
              />
            </Fieldset>
            <div className="md:col-span-2">
              <div className="mb-2 text-xs font-medium">搜索框尺寸：sm（紧凑工具栏）/ md / lg（默认）</div>
              <div className="flex flex-wrap items-center gap-3">
                <SearchField
                  size="sm"
                  className="w-52"
                  label="搜索（紧凑）"
                  value={search}
                  onChange={setSearch}
                  onClear={() => setSearch('')}
                  placeholder="搜索任务、参数或标签…"
                />
                <SearchField
                  size="md"
                  className="w-52"
                  label="搜索（中等）"
                  value={search}
                  onChange={setSearch}
                  onClear={() => setSearch('')}
                  placeholder="搜索任务、参数或标签…"
                />
                <SearchField
                  className="w-52"
                  label="搜索（默认）"
                  value={search}
                  onChange={setSearch}
                  onClear={() => setSearch('')}
                  placeholder="搜索任务、参数或标签…"
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="导航与信息架构" description="Tabs 用于同级内容；NavList 用于侧栏目的地；Toolbar 用于相关命令。">
          <Breadcrumbs
            items={[
              { label: '工作区', onClick: () => undefined },
              { label: '后期处理', onClick: () => undefined },
              { label: '预设编辑器' },
            ]}
          />
          <Tabs
            aria-label="预设内容"
            value={tab}
            onValueChange={setTab}
            className="mt-4"
            items={[
              { value: 'overview', label: '概览' },
              { value: 'layers', label: '图层', badge: <Badge>4</Badge> },
              { value: 'export', label: '导出' },
            ]}
          />
          <div className="mt-5 grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
            <NavList
              label="设置导航"
              value={nav}
              onValueChange={setNav}
              items={[
                { value: 'presets', label: '输出预设', icon: <SettingsIcon size={15} /> },
                { value: 'library', label: '素材库', icon: <FolderOpenIcon size={15} /> },
                { value: 'history', label: '导出历史', badge: '12' },
              ]}
            />
            <Panel
              title="输出预设"
              description="面板适合具有标题、说明、动作和稳定内容边界的工作区。"
              actions={<Button size="sm">保存预设</Button>}
            >
              <KeyValue label="格式" value="PNG" />
              <KeyValue label="画布" value="2048 × 2048" />
              <KeyValue label="命名模板" value="{{date}}-{{index}}" />
            </Panel>
          </div>
        </Section>

        <Section title="反馈与系统状态" description="加载、空、成功、警告和错误都具有明确语义和恢复路径。">
          <div className="grid gap-4">
            <Alert tone="info" title="批量任务已排队">
              系统将按当前并发限制依次执行，你可以继续编辑其他任务。
            </Alert>
            <Alert
              tone="danger"
              title="API 配置不可用"
              actions={
                <Button size="sm" variant="secondary">
                  检查设置
                </Button>
              }
            >
              当前配置无法建立连接，请检查地址、密钥和模型名称。
            </Alert>
            <Progress label="正在导出图片" value={68} showValue />
            <div className="flex flex-wrap gap-4">
              <StatusIndicator tone="success">已完成</StatusIndicator>
              <StatusIndicator tone="info" pulse>
                生成中
              </StatusIndicator>
              <StatusIndicator tone="warning">待确认</StatusIndicator>
              <StatusIndicator tone="danger">失败</StatusIndicator>
            </div>
            {toastVisible && (
              <ToastMessage tone="success" title="预设已保存" onDismiss={() => setToastVisible(false)}>
                下次新建任务时会自动使用这套设置。
              </ToastMessage>
            )}
            {!toastVisible && (
              <Button size="sm" variant="secondary" onClick={() => setToastVisible(true)}>
                再次显示通知
              </Button>
            )}
          </div>
        </Section>

        <Section title="数据展示" description="列表、卡片、键值、表格、缩略图和渐进披露共享统一层级。">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>夏季主图生成</CardTitle>
                <CardDescription>12 张图片 · 3 个提示词变体</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((index) => (
                  <Thumbnail
                    key={index}
                    src="/app-icon.png"
                    alt={`示例缩略图 ${index}`}
                    ratio={1}
                    selected={index === 1}
                  />
                ))}
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="secondary" leadingIcon={<CopyIcon size={14} />}>
                  复制参数
                </Button>
                <Button size="sm">查看结果</Button>
              </CardFooter>
            </Card>
            <div>
              <ListRow
                leading={<Thumbnail src="/app-icon.png" alt="" className="h-10 w-10" />}
                title="电商白底主图"
                description="最近运行于 14:32"
                meta={<Badge tone="success">完成</Badge>}
                actions={<IconButton size="sm" aria-label="更多操作" icon={<MoreHorizontalIcon size={15} />} />}
                selected
              />
              <ListRow
                leading={<Thumbnail src="/app-icon.png" alt="" className="h-10 w-10" />}
                title="场景氛围图"
                description="队列中还有 4 个任务"
                meta={<Badge tone="info">运行中</Badge>}
              />
              <Disclosure summary="查看技术参数">
                <KeyValue label="模型" value="gpt-image-1" />
                <KeyValue label="质量" value="high" />
              </Disclosure>
            </div>
          </div>
          <div className="mt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>夏季主图</TableCell>
                  <TableCell>
                    <StatusIndicator tone="success">完成</StatusIndicator>
                  </TableCell>
                  <TableCell>18.4 秒</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>详情页场景图</TableCell>
                  <TableCell>
                    <StatusIndicator tone="info">生成中</StatusIndicator>
                  </TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <CodeBlock language="命名模板" className="mt-5">
            {'{{date}}/{{preset}}/{{index}}.png'}
          </CodeBlock>
        </Section>

        <Section
          title="浮层与模态模式"
          description="Menu 处理命令，Popover 处理轻量设置，Dialog 和 Drawer 处理需要焦点管理的任务。"
        >
          <Toolbar label="浮层示例">
            <Button onClick={() => setDialogOpen(true)}>打开对话框</Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              打开侧栏
            </Button>
          </Toolbar>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Popover label="输出格式快捷设置">
              <div className="mb-3 text-sm font-semibold">输出格式</div>
              <SegmentedControl
                aria-label="快捷输出格式"
                value={quality}
                onValueChange={setQuality}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'medium', label: '标准' },
                  { value: 'high', label: '高质量' },
                ]}
                size="sm"
              />
            </Popover>
            <Menu label="任务操作">
              <MenuItem icon={<CopyIcon size={15} />} shortcut={<Kbd>⌘D</Kbd>}>
                复制任务
              </MenuItem>
              <MenuItem icon={<FolderOpenIcon size={15} />}>打开输出目录</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon size={15} />} tone="danger">
                删除任务
              </MenuItem>
            </Menu>
          </div>
          <div className="mt-5 overflow-hidden rounded-ds-xl border border-ds-border">
            <DialogWorkspace layout="triple" className="min-h-64">
              <DialogPane as="aside" tone="sidebar">
                <SectionHeader title="分组" description="复杂弹窗内只保留一套 pane 层级。" />
                <NavList
                  label="弹窗分组示例"
                  value="all"
                  onValueChange={() => undefined}
                  items={[
                    { value: 'all', label: '全部' },
                    { value: 'recent', label: '最近使用' },
                  ]}
                />
              </DialogPane>
              <DialogPane tone="content">
                <SectionHeader title="列表" description="列表 pane 不再额外套页面背景。" />
                <ListRow title="未命名 SOP" description="暂无说明" selected />
                <ListRow title="天体图竖版" description="暂无说明" />
              </DialogPane>
              <DialogPane tone="content">
                <SectionHeader title="编辑区" description="表单直接落在内容 pane 内。" />
                <TextField label="名称" defaultValue="未命名 SOP" />
                <TextArea
                  label="正文"
                  className="mt-3 min-h-24"
                  defaultValue="保持同一弹窗内的容器、字体、颜色和选择状态一致。"
                />
              </DialogPane>
            </DialogWorkspace>
          </div>
        </Section>

        <Section
          title={`组件规范目录 · ${filteredSpecs.length}/${componentSpecs.length}`}
          description="每个共享组件都说明用途、适用场景、禁用场景、变体和可访问性要求。"
        >
          <SearchField
            label="搜索组件规范"
            value={catalogQuery}
            onChange={setCatalogQuery}
            onClear={() => setCatalogQuery('')}
            placeholder="搜索组件、分类或用途…"
          />
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>组件</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>用途</TableHead>
                  <TableHead>何时使用</TableHead>
                  <TableHead>避免使用</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSpecs.map((spec) => (
                  <TableRow key={spec.name}>
                    <TableCell>
                      <strong>{spec.name}</strong>
                    </TableCell>
                    <TableCell>{componentCategoryLabels[spec.category]}</TableCell>
                    <TableCell>{spec.purpose}</TableCell>
                    <TableCell>{spec.useWhen}</TableCell>
                    <TableCell>{spec.avoidWhen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section
          title={`现有模块覆盖 · ${legacyComponentCoverage.length}`}
          description="每个现有 UI 模块都有责任边界、处理决策和对应的共享组件。"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模块</TableHead>
                <TableHead>职责</TableHead>
                <TableHead>决策</TableHead>
                <TableHead>组件组合</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legacyComponentCoverage.map((entry) => (
                <TableRow key={entry.module}>
                  <TableCell>
                    <code className="text-xs">{entry.module.replace('src/', '')}</code>
                  </TableCell>
                  <TableCell>{entry.responsibility}</TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        entry.decision === 'migrate' ? 'success' : entry.decision === 'compose' ? 'info' : 'neutral'
                      }
                    >
                      {entry.decision}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.targets.join(' · ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section
          title={`交互模式配方 · ${interactionPatterns.length}`}
          description="跨两个以上场景重复出现的组合模式（对应 COMPONENTS.md 2.8）。新页面遇到同类需求必须按配方组合，不得重新发明结构。"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模式</TableHead>
                <TableHead>适用</TableHead>
                <TableHead>组件组合</TableHead>
                <TableHead>关键规则</TableHead>
                <TableHead>MASTER</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interactionPatterns.map((pattern) => (
                <TableRow key={pattern.id}>
                  <TableCell>
                    <strong>{pattern.name}</strong>
                  </TableCell>
                  <TableCell>{pattern.appliesTo}</TableCell>
                  <TableCell className="text-xs">{pattern.recipe.join(' · ')}</TableCell>
                  <TableCell className="whitespace-pre-line text-xs">{pattern.rules.join('\n')}</TableCell>
                  <TableCell className="text-xs text-[hsl(var(--ds-color-text-muted))]">
                    {pattern.relatedMaster}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section
          title={`页面覆盖登记 · ${pageCoverage.length}`}
          description="各顶层工作区与全局规范（MASTER.md）的差异登记（对应 pages/ 目录）。只记录偏离规则，含业务理由与删除条件。"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>工作区</TableHead>
                <TableHead>入口</TableHead>
                <TableHead>关键差异</TableHead>
                <TableHead>文档</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageCoverage.map((page) => (
                <TableRow key={page.id}>
                  <TableCell>
                    <strong>{page.workspace}</strong>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{page.entry}</code>
                  </TableCell>
                  <TableCell className="text-xs">{page.differences.join(' / ')}</TableCell>
                  <TableCell>
                    <code className="text-xs text-[hsl(var(--ds-color-text-muted))]">{page.document}</code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="加载与空状态" description="骨架保留最终布局；空状态解释原因并给出下一步。">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="grid content-start gap-3" aria-label="任务正在加载">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="mt-2 h-28 w-full" />
            </div>
            <EmptyState
              icon={<BoxIcon size={22} />}
              title="还没有生成任务"
              description="输入提示词并选择参数后，生成结果会显示在这里。"
              action={<Button size="sm">开始创建</Button>}
            />
          </div>
        </Section>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="删除当前任务？"
        description="任务记录和本地结果索引将被删除，此操作无法撤销。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              确认删除
            </Button>
          </>
        }
      >
        <Alert tone="warning">如果只想释放空间，可以先导出结果再删除任务。</Alert>
      </Dialog>

      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="图层属性"
        description="侧栏保留主画布上下文，适合频繁调整。"
        footer={<Button onClick={() => setDrawerOpen(false)}>应用设置</Button>}
      >
        <Fieldset legend="位置与尺寸">
          <TextField label="X 坐标" defaultValue="120" />
          <TextField label="Y 坐标" defaultValue="84" />
          <Switch checked={switchOn} onCheckedChange={setSwitchOn} label="锁定比例" />
        </Fieldset>
      </Drawer>
    </main>
  )
}
