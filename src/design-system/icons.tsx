import type { SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlignCenter as LucideAlignCenter,
  AlignLeft as LucideAlignLeft,
  AlignRight as LucideAlignRight,
  AlertCircle as LucideAlertCircle,
  Archive as LucideArchive,
  ArrowDown as LucideArrowDown,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  BarChart3 as LucideBarChart3,
  Bookmark as LucideBookmark,
  BookOpenCheck as LucideBookOpenCheck,
  Box as LucideBox,
  Calendar as LucideCalendar,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  Circle as LucideCircle,
  ClipboardPlus as LucideClipboardPlus,
  Code2 as LucideCode,
  Copy as LucideCopy,
  Diamond as LucideDiamond,
  Download as LucideDownload,
  Edit2 as LucideEdit2,
  Edit3 as LucideEdit3,
  Expand as LucideExpand,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  FileImage as LucideFileImage,
  FileText as LucideFileText,
  Folder as LucideFolder,
  FolderOpen as LucideFolderOpen,
  FolderPlus as LucideFolderPlus,
  Grid2X2 as LucideGrid2X2,
  GripHorizontal as LucideGripHorizontal,
  GripVertical as LucideGripVertical,
  HelpCircle as LucideHelpCircle,
  History as LucideHistory,
  Image as LucideImage,
  ImagePlus as LucideImagePlus,
  Images as LucideImages,
  Info as LucideInfo,
  Layers3 as LucideLayers3,
  Library as LucideLibrary,
  Link as LucideLink,
  List as LucideList,
  ListChecks as LucideListChecks,
  Loader2 as LucideLoader2,
  LoaderCircle as LucideLoaderCircle,
  Lock as LucideLock,
  LockOpen as LucideLockOpen,
  LogOut as LucideLogOut,
  Minus as LucideMinus,
  Moon as LucideMoon,
  MoreHorizontal as LucideMoreHorizontal,
  MousePointerClick as LucideMousePointerClick,
  Palette as LucidePalette,
  PanelLeft as LucidePanelLeft,
  Pause as LucidePause,
  Pencil as LucidePencil,
  Pin as LucidePin,
  PinOff as LucidePinOff,
  Play as LucidePlay,
  Plus as LucidePlus,
  RefreshCw as LucideRefresh,
  RotateCcw as LucideRotateCcw,
  Save as LucideSave,
  Scissors as LucideScissors,
  Search as LucideSearch,
  SearchX as LucideSearchX,
  Send as LucideSend,
  Settings as LucideSettings,
  Settings2 as LucideSettings2,
  ShieldCheck as LucideShieldCheck,
  Shuffle as LucideShuffle,
  SlidersHorizontal as LucideSlidersHorizontal,
  Sparkles as LucideSparkles,
  Square as LucideSquare,
  Star as LucideStar,
  Sun as LucideSun,
  Tags as LucideTags,
  ThumbsUp as LucideThumbsUp,
  Trash2 as LucideTrash,
  TriangleAlert as LucideTriangleAlert,
  Type as LucideType,
  Upload as LucideUpload,
  CircleUserRound as LucideCircleUserRound,
  Clock3 as LucideClock3,
  Database as LucideDatabase,
  Users as LucideUsers,
  Wand2 as LucideWand2,
  WandSparkles as LucideWandSparkles,
  Wrench as LucideWrench,
  X as LucideX,
  XCircle as LucideXCircle,
  Zap as LucideZap,
} from 'lucide-react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'strokeWidth'> {
  size?: number | string
  strokeWidth?: number | string
  title?: string
}

export interface FavoriteIconProps extends IconProps {
  filled?: boolean
}

function getA11yProps(title: string | undefined) {
  return title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true }
}

function makeIcon(SourceIcon: LucideIcon, displayName: string) {
  function IconComponent({ size = 20, strokeWidth = 2, title, ...props }: IconProps) {
    return <SourceIcon size={size} strokeWidth={strokeWidth} focusable="false" {...getA11yProps(title)} {...props} />
  }

  IconComponent.displayName = displayName
  return IconComponent
}

export const CopyIcon = makeIcon(LucideCopy, 'CopyIcon')
export const TrashIcon = makeIcon(LucideTrash, 'TrashIcon')
export const PlusIcon = makeIcon(LucidePlus, 'PlusIcon')
export const CloseIcon = makeIcon(LucideX, 'CloseIcon')
export const ChevronDownIcon = makeIcon(LucideChevronDown, 'ChevronDownIcon')
export const ArrowDownIcon = makeIcon(LucideArrowDown, 'ArrowDownIcon')
export const ChevronLeftIcon = makeIcon(LucideChevronLeft, 'ChevronLeftIcon')
export const ChevronRightIcon = makeIcon(LucideChevronRight, 'ChevronRightIcon')
export const ExportIcon = makeIcon(LucideDownload, 'ExportIcon')
export const ImportIcon = makeIcon(LucideUpload, 'ImportIcon')
export const DownloadIcon = makeIcon(LucideDownload, 'DownloadIcon')
export const FolderOpenIcon = makeIcon(LucideFolderOpen, 'FolderOpenIcon')
export const EditIcon = makeIcon(LucidePencil, 'EditIcon')
export const RefreshIcon = makeIcon(LucideRefresh, 'RefreshIcon')
export const CodeIcon = makeIcon(LucideCode, 'CodeIcon')
export const LinkIcon = makeIcon(LucideLink, 'LinkIcon')
export const SidebarLeftIcon = makeIcon(LucidePanelLeft, 'SidebarLeftIcon')
export const DragHandleIcon = makeIcon(LucideGripHorizontal, 'DragHandleIcon')
export const HistoryIcon = makeIcon(LucideHistory, 'HistoryIcon')
export const CalendarIcon = makeIcon(LucideCalendar, 'CalendarIcon')
export const InstallIcon = makeIcon(LucideDownload, 'InstallIcon')
export const HelpCircleIcon = makeIcon(LucideHelpCircle, 'HelpCircleIcon')
export const SettingsIcon = makeIcon(LucideSettings, 'SettingsIcon')
export const SunIcon = makeIcon(LucideSun, 'SunIcon')
export const MoonIcon = makeIcon(LucideMoon, 'MoonIcon')
export const CollectionManageIcon = makeIcon(LucideList, 'CollectionManageIcon')

export const SearchIcon = makeIcon(LucideSearch, 'SearchIcon')
export const AlertCircleIcon = makeIcon(LucideAlertCircle, 'AlertCircleIcon')
export const AlertTriangleIcon = makeIcon(LucideTriangleAlert, 'AlertTriangleIcon')
export const CheckCircleIcon = makeIcon(LucideCheckCircle, 'CheckCircleIcon')
export const InfoIcon = makeIcon(LucideInfo, 'InfoIcon')
export const TriangleAlertIcon = makeIcon(LucideTriangleAlert, 'TriangleAlertIcon')
export const XIcon = CloseIcon
export const CheckIcon = makeIcon(LucideCheck, 'CheckIcon')
export const ClipboardPlusIcon = makeIcon(LucideClipboardPlus, 'ClipboardPlusIcon')
export const MinusIcon = makeIcon(LucideMinus, 'MinusIcon')
export const ZapIcon = makeIcon(LucideZap, 'ZapIcon')
export const ListChecksIcon = makeIcon(LucideListChecks, 'ListChecksIcon')
export const ArrowLeftIcon = makeIcon(LucideArrowLeft, 'ArrowLeftIcon')
export const ArrowRightIcon = makeIcon(LucideArrowRight, 'ArrowRightIcon')
export const ArrowUpIcon = makeIcon(LucideArrowUp, 'ArrowUpIcon')
export const ArchiveIcon = makeIcon(LucideArchive, 'ArchiveIcon')
export const BarChart3Icon = makeIcon(LucideBarChart3, 'BarChart3Icon')
export const BookmarkIcon = makeIcon(LucideBookmark, 'BookmarkIcon')
export const FileTextIcon = makeIcon(LucideFileText, 'FileTextIcon')
export const FileImageIcon = makeIcon(LucideFileImage, 'FileImageIcon')
export const FolderIcon = makeIcon(LucideFolder, 'FolderIcon')
export const FolderPlusIcon = makeIcon(LucideFolderPlus, 'FolderPlusIcon')
export const PauseIcon = makeIcon(LucidePause, 'PauseIcon')
export const PlayIcon = makeIcon(LucidePlay, 'PlayIcon')
export const ShuffleIcon = makeIcon(LucideShuffle, 'ShuffleIcon')
export const SquareIcon = makeIcon(LucideSquare, 'SquareIcon')
export const CircleIcon = makeIcon(LucideCircle, 'CircleIcon')
export const DiamondIcon = makeIcon(LucideDiamond, 'DiamondIcon')
export const ImageIcon = makeIcon(LucideImage, 'ImageIcon')
export const ImagePlusIcon = makeIcon(LucideImagePlus, 'ImagePlusIcon')
export const ImagesIcon = makeIcon(LucideImages, 'ImagesIcon')
export const TypeIcon = makeIcon(LucideType, 'TypeIcon')
export const Edit2Icon = makeIcon(LucideEdit2, 'Edit2Icon')
export const Edit3Icon = makeIcon(LucideEdit3, 'Edit3Icon')
export const ExpandIcon = makeIcon(LucideExpand, 'ExpandIcon')
export const ChevronUpIcon = makeIcon(LucideChevronUp, 'ChevronUpIcon')
export const EyeIcon = makeIcon(LucideEye, 'EyeIcon')
export const EyeOffIcon = makeIcon(LucideEyeOff, 'EyeOffIcon')
export const LockIcon = makeIcon(LucideLock, 'LockIcon')
export const LockOpenIcon = makeIcon(LucideLockOpen, 'LockOpenIcon')
export const BookOpenCheckIcon = makeIcon(LucideBookOpenCheck, 'BookOpenCheckIcon')
export const Grid2X2Icon = makeIcon(LucideGrid2X2, 'Grid2X2Icon')
export const Layers3Icon = makeIcon(LucideLayers3, 'Layers3Icon')
export const LibraryIcon = makeIcon(LucideLibrary, 'LibraryIcon')
export const Loader2Icon = makeIcon(LucideLoader2, 'Loader2Icon')
export const LoaderCircleIcon = makeIcon(LucideLoaderCircle, 'LoaderCircleIcon')
export const SearchXIcon = makeIcon(LucideSearchX, 'SearchXIcon')
export const GripVerticalIcon = makeIcon(LucideGripVertical, 'GripVerticalIcon')
export const PencilIcon = EditIcon
export const SaveIcon = makeIcon(LucideSave, 'SaveIcon')
export const ScissorsIcon = makeIcon(LucideScissors, 'ScissorsIcon')
export const Settings2Icon = makeIcon(LucideSettings2, 'Settings2Icon')
export const MoreHorizontalIcon = makeIcon(LucideMoreHorizontal, 'MoreHorizontalIcon')
export const BoxIcon = makeIcon(LucideBox, 'BoxIcon')
export const CircleUserRoundIcon = makeIcon(LucideCircleUserRound, 'CircleUserRoundIcon')
export const Clock3Icon = makeIcon(LucideClock3, 'Clock3Icon')
export const DatabaseIcon = makeIcon(LucideDatabase, 'DatabaseIcon')
export const LogOutIcon = makeIcon(LucideLogOut, 'LogOutIcon')
export const MousePointerClickIcon = makeIcon(LucideMousePointerClick, 'MousePointerClickIcon')
export const PaletteIcon = makeIcon(LucidePalette, 'PaletteIcon')
export const RotateCcwIcon = makeIcon(LucideRotateCcw, 'RotateCcwIcon')
export const SendIcon = makeIcon(LucideSend, 'SendIcon')
export const ShieldCheckIcon = makeIcon(LucideShieldCheck, 'ShieldCheckIcon')
export const SlidersHorizontalIcon = makeIcon(LucideSlidersHorizontal, 'SlidersHorizontalIcon')
export const SparklesIcon = makeIcon(LucideSparkles, 'SparklesIcon')
export const StarIcon = makeIcon(LucideStar, 'StarIcon')
export const TagsIcon = makeIcon(LucideTags, 'TagsIcon')
export const ThumbsUpIcon = makeIcon(LucideThumbsUp, 'ThumbsUpIcon')
export const UsersIcon = makeIcon(LucideUsers, 'UsersIcon')
export const Wand2Icon = makeIcon(LucideWand2, 'Wand2Icon')
export const WandSparklesIcon = makeIcon(LucideWandSparkles, 'WandSparklesIcon')
export const WrenchIcon = makeIcon(LucideWrench, 'WrenchIcon')
export const XCircleIcon = makeIcon(LucideXCircle, 'XCircleIcon')
export const AlignLeftIcon = makeIcon(LucideAlignLeft, 'AlignLeftIcon')
export const AlignCenterIcon = makeIcon(LucideAlignCenter, 'AlignCenterIcon')
export const AlignRightIcon = makeIcon(LucideAlignRight, 'AlignRightIcon')

export function GithubIcon({ size = 20, title, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
      {...getA11yProps(title)}
      {...props}
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

export function FavoriteIcon({ filled, fill, size = 20, strokeWidth = 2, title, ...props }: FavoriteIconProps) {
  return (
    <LucideStar
      size={size}
      strokeWidth={strokeWidth}
      fill={filled ? 'currentColor' : (fill ?? 'none')}
      focusable="false"
      {...getA11yProps(title)}
      {...props}
    />
  )
}

export function PinIcon({ filled, size = 20, strokeWidth = 2, title, ...props }: FavoriteIconProps) {
  return (
    <LucidePin
      size={size}
      strokeWidth={strokeWidth}
      fill={filled ? 'currentColor' : 'none'}
      focusable="false"
      {...getA11yProps(title)}
      {...props}
    />
  )
}

export const iconRegistry = {
  add: PlusIcon,
  alignCenter: AlignCenterIcon,
  alignLeft: AlignLeftIcon,
  alignRight: AlignRightIcon,
  alert: AlertCircleIcon,
  alertTriangle: AlertTriangleIcon,
  archive: ArchiveIcon,
  arrowDown: ArrowDownIcon,
  arrowLeft: ArrowLeftIcon,
  arrowRight: ArrowRightIcon,
  arrowUp: ArrowUpIcon,
  barChart: BarChart3Icon,
  bookmark: BookmarkIcon,
  bookOpenCheck: BookOpenCheckIcon,
  box: BoxIcon,
  calendar: CalendarIcon,
  check: CheckIcon,
  checkCircle: CheckCircleIcon,
  chevronDown: ChevronDownIcon,
  chevronLeft: ChevronLeftIcon,
  chevronRight: ChevronRightIcon,
  chevronUp: ChevronUpIcon,
  circle: CircleIcon,
  circleUser: CircleUserRoundIcon,
  clock: Clock3Icon,
  close: CloseIcon,
  code: CodeIcon,
  collectionManage: CollectionManageIcon,
  copy: CopyIcon,
  database: DatabaseIcon,
  diamond: DiamondIcon,
  download: DownloadIcon,
  dragHandle: DragHandleIcon,
  edit: EditIcon,
  edit2: Edit2Icon,
  edit3: Edit3Icon,
  export: ExportIcon,
  expand: ExpandIcon,
  eye: EyeIcon,
  eyeOff: EyeOffIcon,
  favorite: FavoriteIcon,
  fileImage: FileImageIcon,
  fileText: FileTextIcon,
  folder: FolderIcon,
  folderOpen: FolderOpenIcon,
  folderPlus: FolderPlusIcon,
  github: GithubIcon,
  grid: Grid2X2Icon,
  gripVertical: GripVerticalIcon,
  help: HelpCircleIcon,
  history: HistoryIcon,
  image: ImageIcon,
  imagePlus: ImagePlusIcon,
  images: ImagesIcon,
  import: ImportIcon,
  info: InfoIcon,
  install: InstallIcon,
  layers: Layers3Icon,
  library: LibraryIcon,
  link: LinkIcon,
  listChecks: ListChecksIcon,
  loader2: Loader2Icon,
  loader: LoaderCircleIcon,
  lock: LockIcon,
  lockOpen: LockOpenIcon,
  logOut: LogOutIcon,
  minus: MinusIcon,
  moon: MoonIcon,
  more: MoreHorizontalIcon,
  mousePointerClick: MousePointerClickIcon,
  palette: PaletteIcon,
  pause: PauseIcon,
  pin: PinIcon,
  play: PlayIcon,
  refresh: RefreshIcon,
  rotateCcw: RotateCcwIcon,
  save: SaveIcon,
  search: SearchIcon,
  searchX: SearchXIcon,
  send: SendIcon,
  settings: SettingsIcon,
  settings2: Settings2Icon,
  shieldCheck: ShieldCheckIcon,
  shuffle: ShuffleIcon,
  slidersHorizontal: SlidersHorizontalIcon,
  sparkles: SparklesIcon,
  sidebarLeft: SidebarLeftIcon,
  square: SquareIcon,
  star: StarIcon,
  sun: SunIcon,
  tags: TagsIcon,
  thumbsUp: ThumbsUpIcon,
  trash: TrashIcon,
  triangleAlert: TriangleAlertIcon,
  type: TypeIcon,
  upload: ImportIcon,
  users: UsersIcon,
  wand2: Wand2Icon,
  wandSparkles: WandSparklesIcon,
  wrench: WrenchIcon,
  xCircle: XCircleIcon,
  zap: ZapIcon,
} as const

export type IconName = keyof typeof iconRegistry

export interface IconComponentProps extends IconProps {
  name: IconName
}

export function Icon({ name, ...props }: IconComponentProps) {
  const IconComponent = iconRegistry[name]
  return <IconComponent {...props} />
}
