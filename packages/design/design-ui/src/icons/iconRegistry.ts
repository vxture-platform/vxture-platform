/**
 * iconRegistry.ts - 图标注册中心
 * @package @vxture/design-ui
 *
 * 功能：图标注册中心，唯一直接 import Phosphor 的文件
 *       业务层和其他模块不得直接引用 Phosphor，统一通过此文件访问
 *       新增图标：在此文件和 iconDictionary.ts 中同时添加
 *
 * ⚠️ 只能引 `@phosphor-icons/react/ssr`，不能引裸入口（#347）：裸入口是 CSR 构建，
 *    在模块作用域调用 createContext，而 react-server 运行时的 react 不导出它——
 *    任何在 RSC 里静态导入 /server 子集的消费方，next dev（无 DCE）会直接 500。
 *    SSR 构建是同一套图标的无 context 版本，`weight` 等仍是普通 prop（本仓未用
 *    IconContext，故无功能损失），且让 Icon 真正可在 RSC 渲染而不止于可求值。
 *
 * @copyright Vxture Team
 * @layer Infrastructure
 * @category Registry
 */

import {
  // ==========================================================================
  // 通用交互 - 导航
  // ==========================================================================
  HouseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CaretDownIcon,
  CaretDoubleUpIcon,
  CaretDoubleDownIcon,
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CaretUpDownIcon,
  ArrowsDownUpIcon,
  ArrowBendUpLeftIcon,
  ArrowBendUpRightIcon,
  SquaresFourIcon,
  ArrowSquareOutIcon,
  LinkIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  PushPinIcon,
  SidebarSimpleIcon,

  // ==========================================================================
  // 通用交互 - 操作
  // ==========================================================================
  MagnifyingGlassIcon,
  DotsNineIcon,
  DotsThreeVerticalIcon,
  GearIcon,
  BellIcon,
  PencilIcon,
  KeyIcon,
  LockIcon,
  EyeIcon,
  EyeSlashIcon,
  TrashIcon,
  PlusIcon,
  MinusIcon,
  XIcon,
  CheckIcon,
  CopyIcon,
  PlayIcon,
  StopIcon,
  TextIndentIcon,
  TextOutdentIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  ArrowsClockwiseIcon,
  ArrowCounterClockwiseIcon,
  FunnelIcon,
  ShareNetworkIcon,
  ArchiveIcon,
  ProhibitIcon,
  PauseIcon,
  DotsThreeIcon,
  DotsSixVerticalIcon,
  PrinterIcon,
  PowerIcon,
  SignInIcon,
  QrCodeIcon,
  FloppyDiskIcon,
  TextTIcon,
  ListChecksIcon,
  TargetIcon,
  PercentIcon,

  // ==========================================================================
  // 通用交互 - 状态
  // ==========================================================================
  CheckCircleIcon,
  XCircleIcon,
  WarningCircleIcon,
  InfoIcon,
  CircleNotchIcon,
  CircleDashedIcon,
  FlagIcon,
  SealCheckIcon,

  // ==========================================================================
  // 云服务/智能体 - 平台
  // ==========================================================================
  RobotIcon,
  TimerIcon,
  FlowArrowIcon,
  PlayCircleIcon,
  DatabaseIcon,
  CloudIcon,
  PlugIcon,
  EraserIcon,
  CubeIcon,
  BuildingIcon,
  BankIcon,
  CpuIcon,
  HardDrivesIcon,
  RocketLaunchIcon,
  TerminalWindowIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  BrainIcon,
  MagicWandIcon,
  LightningIcon,
  FadersIcon,
  PackageIcon,

  // ==========================================================================
  // 云服务/智能体 - 数据
  // ==========================================================================
  ChartBarIcon,
  TableIcon,
  CodeIcon,
  PiIcon,
  GitForkIcon, // graph：有向图/节点图，语义更准确
  LightbulbIcon,
  SparkleIcon,
  ShieldCheckIcon,
  ChartLineUpIcon,
  ChartPieSliceIcon,
  TreeStructureIcon,
  GitBranchIcon,
  StackIcon,
  KanbanIcon,

  // ==========================================================================
  // 文件与文档
  // ==========================================================================
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  ClipboardTextIcon,
  BookOpenIcon,
  NewspaperIcon,
  GraduationCapIcon,

  // ==========================================================================
  // 商业与账务
  // ==========================================================================
  CreditCardIcon,
  ReceiptIcon,
  WalletIcon,
  CoinsIcon,
  CurrencyCnyIcon,
  TicketIcon,
  GiftIcon,
  ScalesIcon,
  GaugeIcon,
  TrendUpIcon,
  TrendDownIcon,
  ChartLineIcon,
  ChartPieIcon,

  // ==========================================================================
  // 安全与凭证
  // ==========================================================================
  ShieldIcon,
  ShieldWarningIcon,
  FingerprintIcon,
  CertificateIcon,
  LockOpenIcon,

  // ==========================================================================
  // 用户/组织
  // ==========================================================================
  UserIcon,
  UserSwitchIcon,
  BuildingsIcon,
  UsersIcon,
  MedalIcon,
  StarIcon,
  UserPlusIcon,
  UserCircleIcon,

  // ==========================================================================
  // 通讯/联系
  // ==========================================================================
  EnvelopeIcon,
  PhoneIcon,
  WechatLogoIcon,
  GithubLogoIcon,
  LinkedinLogoIcon,
  ChatCircleIcon,
  PaperPlaneTiltIcon,
  MegaphoneIcon,
  HeadsetIcon,
  VideoCameraIcon,
  MicrophoneIcon,
  PaperclipIcon,
  ImageIcon,
  ChatCircleDotsIcon,
  WaveformIcon,
  TranslateIcon,

  // ==========================================================================
  // 时间/日历
  // ==========================================================================
  CalendarIcon,
  ClockIcon,
  ClockCounterClockwiseIcon,

  // ==========================================================================
  // 地图/位置
  // ==========================================================================
  MapPinIcon,

  // ==========================================================================
  // 主题/显示
  // ==========================================================================
  SunIcon,
  MoonIcon,
  GlobeIcon,
  ArrowsOutSimpleIcon, // maximize：原生全屏展开
  ArrowsInSimpleIcon, // minimize：原生全屏收起
  CornersOutIcon, // corners-out：伪全屏展开
  CornersInIcon, // corners-in：伪全屏收起
  ListIcon,
  RowsIcon,
  SignOutIcon,
  DeviceMobileIcon,
  DesktopIcon,

  // ==========================================================================
  // 反馈与互动
  // ==========================================================================
  ThumbsUpIcon,
  ThumbsDownIcon,

  // ==========================================================================
  // 其他
  // ==========================================================================
  CaretLeftIcon as CaretLeftBoldIcon,
  CaretRightIcon as CaretRightBoldIcon,

  // ==========================================================================
  // 系统保留（勿删）
  // ==========================================================================
  QuestionIcon,
} from "@phosphor-icons/react/ssr";

// 类型从裸入口取：`import type` 在编译期被完全擦除，不进运行时模块图，因此
// 不会把 CSR 构建的 createContext 带回 server 图（值导入必须走 /ssr，见上）。
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import type { IconName } from "./iconDictionary";

// ============================================================================
// 图标注册表
// ============================================================================

/**
 * Phosphor 图标组件映射
 *
 * 这是设计系统中唯一直接依赖 Phosphor Icons 的地方。
 * 每个语义 key 对应唯一的图标组件，无同义重复 key。
 */
export const iconRegistry: Record<IconName, PhosphorIcon> = {
  // ==========================================================================
  // 通用交互 - 导航
  // ==========================================================================
  home: HouseIcon,
  "arrow-left": ArrowLeftIcon,
  "arrow-right": ArrowRightIcon,
  "arrow-left-right": ArrowsLeftRightIcon,
  "arrow-up": ArrowUpIcon,
  "arrow-down": ArrowDownIcon,
  "arrow-long-right": ArrowRightIcon,
  "chevron-left": CaretLeftIcon,
  "chevron-right": CaretRightIcon,
  "chevron-up": CaretUpIcon,
  "chevron-down": CaretDownIcon,
  "caret-double-up": CaretDoubleUpIcon,
  "caret-double-down": CaretDoubleDownIcon,
  "caret-double-left": CaretDoubleLeftIcon,
  "caret-double-right": CaretDoubleRightIcon,
  "caret-up-down": CaretUpDownIcon,
  "arrows-down-up": ArrowsDownUpIcon,
  "arrow-bend-up-left": ArrowBendUpLeftIcon,
  "arrow-bend-up-right": ArrowBendUpRightIcon,
  "squares-four": SquaresFourIcon,
  "external-link": ArrowSquareOutIcon,
  link: LinkIcon,
  "sort-ascending": SortAscendingIcon,
  "sort-descending": SortDescendingIcon,
  "push-pin": PushPinIcon,
  sidebar: SidebarSimpleIcon,

  // ==========================================================================
  // 通用交互 - 操作
  // ==========================================================================
  search: MagnifyingGlassIcon,
  "app-grid": DotsNineIcon,
  settings: GearIcon,
  help: QuestionIcon,
  bell: BellIcon,
  "more-vertical": DotsThreeVerticalIcon,
  edit: PencilIcon,
  key: KeyIcon,
  lock: LockIcon,
  eye: EyeIcon,
  "eye-slash": EyeSlashIcon,
  trash: TrashIcon,
  plus: PlusIcon,
  minus: MinusIcon,
  x: XIcon,
  check: CheckIcon,
  copy: CopyIcon,
  play: PlayIcon,
  stop: StopIcon,
  "text-indent": TextIndentIcon,
  "text-outdent": TextOutdentIcon,
  download: DownloadSimpleIcon,
  upload: UploadSimpleIcon,
  refresh: ArrowsClockwiseIcon,
  undo: ArrowCounterClockwiseIcon,
  filter: FunnelIcon,
  share: ShareNetworkIcon,
  archive: ArchiveIcon,
  prohibit: ProhibitIcon,
  pause: PauseIcon,
  "dots-three": DotsThreeIcon,
  drag: DotsSixVerticalIcon,
  printer: PrinterIcon,
  power: PowerIcon,
  "sign-in": SignInIcon,
  "qr-code": QrCodeIcon,
  save: FloppyDiskIcon,
  "text-t": TextTIcon,
  "list-checks": ListChecksIcon,
  target: TargetIcon,
  timer: TimerIcon,
  percent: PercentIcon,

  // ==========================================================================
  // 通用交互 - 状态
  // ==========================================================================
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: WarningCircleIcon,
  info: InfoIcon,
  spinner: CircleNotchIcon,
  "circle-dashed": CircleDashedIcon,
  flag: FlagIcon,
  "seal-check": SealCheckIcon,

  // ==========================================================================
  // 云服务/智能体 - 平台
  // ==========================================================================
  agent: RobotIcon,
  // 曾与 timer 三语义共挂 TimerIcon（遗留错配），2026-08-02 各归其形。
  workflow: FlowArrowIcon,
  // 触发＝启动一段流程；与 play（媒体播放）分形。
  trigger: PlayCircleIcon,
  database: DatabaseIcon,
  cloud: CloudIcon,
  plug: PlugIcon,
  server: EraserIcon,
  cube: CubeIcon,
  // 柱廊建筑＝馆藏/机构，与 building（单体楼宇）分形。
  "building-library": BankIcon,
  cpu: CpuIcon,
  "hard-drive": HardDrivesIcon,
  rocket: RocketLaunchIcon,
  terminal: TerminalWindowIcon,
  "plugs-connected": PlugsConnectedIcon,
  puzzle: PuzzlePieceIcon,
  brain: BrainIcon,
  "magic-wand": MagicWandIcon,
  lightning: LightningIcon,
  faders: FadersIcon,
  package: PackageIcon,

  // ==========================================================================
  // 云服务/智能体 - 数据
  // ==========================================================================
  "chart-bar": ChartBarIcon,
  table: TableIcon,
  code: CodeIcon,
  api: PiIcon,
  graph: GitForkIcon,
  lightbulb: LightbulbIcon,
  sparkles: SparkleIcon,
  "shield-check": ShieldCheckIcon,
  "chart-line-up": ChartLineUpIcon,
  "chart-pie-slice": ChartPieSliceIcon,
  "tree-structure": TreeStructureIcon,
  "git-branch": GitBranchIcon,
  stack: StackIcon,
  kanban: KanbanIcon,

  // ==========================================================================
  // 文件与文档
  // ==========================================================================
  file: FileIcon,
  "file-text": FileTextIcon,
  folder: FolderIcon,
  "folder-open": FolderOpenIcon,
  clipboard: ClipboardTextIcon,
  "book-open": BookOpenIcon,
  newspaper: NewspaperIcon,
  "graduation-cap": GraduationCapIcon,

  // ==========================================================================
  // 商业与账务
  // ==========================================================================
  "credit-card": CreditCardIcon,
  receipt: ReceiptIcon,
  wallet: WalletIcon,
  coins: CoinsIcon,
  "currency-cny": CurrencyCnyIcon,
  ticket: TicketIcon,
  gift: GiftIcon,
  scales: ScalesIcon,
  gauge: GaugeIcon,
  "trend-up": TrendUpIcon,
  "trend-down": TrendDownIcon,
  "chart-line": ChartLineIcon,
  "chart-pie": ChartPieIcon,

  // ==========================================================================
  // 安全与凭证
  // ==========================================================================
  shield: ShieldIcon,
  "shield-warning": ShieldWarningIcon,
  fingerprint: FingerprintIcon,
  certificate: CertificateIcon,
  "lock-open": LockOpenIcon,

  // ==========================================================================
  // 用户/组织
  // ==========================================================================
  user: UserIcon,
  role: UsersIcon,
  "user-switch": UserSwitchIcon,
  buildings: BuildingsIcon,
  users: UsersIcon,
  medal: MedalIcon,
  star: StarIcon,
  "user-plus": UserPlusIcon,
  "user-circle": UserCircleIcon,
  building: BuildingIcon,

  // ==========================================================================
  // 通讯/联系
  // ==========================================================================
  mail: EnvelopeIcon,
  phone: PhoneIcon,
  wechat: WechatLogoIcon,
  github: GithubLogoIcon,
  linkedin: LinkedinLogoIcon,
  "chat-circle": ChatCircleIcon,
  "paperplane-tilt": PaperPlaneTiltIcon,
  megaphone: MegaphoneIcon,
  headset: HeadsetIcon,
  "video-camera": VideoCameraIcon,
  microphone: MicrophoneIcon,
  paperclip: PaperclipIcon,
  image: ImageIcon,
  "chat-dots": ChatCircleDotsIcon,
  waveform: WaveformIcon,
  translate: TranslateIcon,

  // ==========================================================================
  // 时间/日历
  // ==========================================================================
  calendar: CalendarIcon,
  clock: ClockIcon,
  "clock-counter-clockwise": ClockCounterClockwiseIcon,

  // ==========================================================================
  // 地图/位置
  // ==========================================================================
  "map-pin": MapPinIcon,

  // ==========================================================================
  // 主题/显示
  // ==========================================================================
  sun: SunIcon,
  moon: MoonIcon,
  globe: GlobeIcon,
  maximize: ArrowsOutSimpleIcon,
  minimize: ArrowsInSimpleIcon,
  "corners-out": CornersOutIcon,
  "corners-in": CornersInIcon,
  list: ListIcon,
  rows: RowsIcon,
  "sign-out": SignOutIcon,
  "device-mobile": DeviceMobileIcon,
  desktop: DesktopIcon,

  // ==========================================================================
  // 反馈与互动
  // ==========================================================================
  "thumbs-up": ThumbsUpIcon,
  "thumbs-down": ThumbsDownIcon,

  // ==========================================================================
  // 其他
  // ==========================================================================
  "caret-left-bold": CaretLeftBoldIcon,
  "caret-right-bold": CaretRightBoldIcon,

  // ==========================================================================
  // 系统保留（勿删）
  // ==========================================================================
  placeholder: QuestionIcon,
};
