"use client";

/**
 * registry.tsx - 组件清单与出处标注。
 * @package @vxture/design-preview
 *
 * 每件恰好两枚标签，组合起来分三类：
 *
 *   {shadcn}{origin}            纯上游——照上游结构，只把取值换成 T2，未改 API。
 *   {shadcn}{vxture}            部分定制——占上游的位置，但 prop、变体或整套 API 有我们的改动。
 *   {vxture}{component|patterns} 完全自建——上游没有这个件；第二枚说明它落在哪一层。
 *
 * 两枚一起看才说得清来历。Button 是纯上游；Toast 占的是上游的通知位，但 API
 * 整套是我们的（上游现行方案是 sonner，换过去要动产品侧 16 处）；ViewHeader
 * 则上游根本没有，是从产品重复里提炼出来的图案。
 *
 * 这份清单同时是统计卡的数据源——数字不手写，从这里算。
 */

import * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionMenu,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AspectRatio,
  Avatar,
  buttonVariants,
  Calendar,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Combobox,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Slider,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  TOGGLE_SIZES,
  TOGGLE_VARIANTS,
  ToggleGroup,
  ToggleGroupItem,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Container,
  FullscreenProvider,
  Grid,
  Stack,
  AvatarFallback,
  Badge,
  BADGE_VARIANTS,
  Banner,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Drawer,
  BulkActionBar,
  DashboardTemplate,
  DataTable,
  DetailPageTemplate,
  DialogForm,
  FieldTier,
  FormPageTemplate,
  ListPageTemplate,
  ResultPageTemplate,
  EmptyState,
  EntryCard,
  FilterBar,
  ListCard,
  ListCardGrid,
  MetricGrid,
  type MetricGridItem,
  TableTitleCell,
  NativeSelect,
  DetailList,
  DetailRow,
  Section,
  SectionHeader,
  SectionNav,
  SegmentedControl,
  SplitViewLayout,
  ViewLayout,
  ViewHeader,
  StatusBadge,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Input,
  Label,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  TONES,
  Tooltip,
  TOOLTIP_VARIANTS,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from "@vxture/design-system";
import {
  ShellBrand,
  ShellDock,
  ShellFullscreenToggle,
  ShellIconButton,
  ShellLegalFooter,
  ShellLocaleSwitcher,
  ShellPreferencePanel,
  ShellThemeToggle,
  ShellUserMenu,
} from "@vxture/design-system";
import {
  BUTTON_GROUP_ORIENTATIONS,
  ButtonGroup,
  ButtonGroupText,
  Field,
  FIELD_ORIENTATIONS,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  INPUT_GROUP_ALIGNS,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Kbd,
  KbdGroup,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Spinner,
  SPINNER_SIZES,
} from "@vxture/design-system";
/* 批 R 补登记：这一批件在 admin → DS 的收敛里建起来，一直没进预览面。 */
import {
  ActionButton,
  FactList,
  LabeledValue,
  LevelMarker,
  MetricListCard,
  PanelCard,
  PanelItem,
  PanelList,
  ShellBootScreen,
  ShellHeader,
  ShellLauncher,
  ShellPageContainer,
  ShellPanelControlRow,
  ShellPanelHeader,
  ShellPanelMeterRow,
  ShellPanelRow,
  ShellPanelSection,
  ShellPanelSectionTitle,
  ShellSearchBox,
  ShellSidebarFrame,
  ShellSidebarNav,
  ShellViewport,
  ViewModeSwitch,
} from "@vxture/design-system";
import { Row } from "./kit";

export type Provenance =
  | "shadcn"
  | "origin"
  | "vxture"
  | "component"
  | "patterns"
  /** 尚未重写、且去向是删除或迁出的件。渲染无样式是预期结果。 */
  | "pending";

/**
 * 粒度，决定进哪个大类页面。**显式标注，不从出处标签推**——标签说的是"谁做的"
 * （上游 / 我们改的 / 我们建的），跟"它是不是原子件"是两回事：`NativeSelect` 是我们
 * 建的，但它就是一个控件；`Card` 来自上游，却是一组部件。
 *
 * 判据：`atom` = 一个控件、一个交互单元、没有子件 API；`pattern` = 由多个部件或多个
 * 控件拼成（含所有 `X.Part` 形态的件）；`pending` = 尚未重写。
 */
export type Layer = "atom" | "pattern" | "pending";

export interface Entry {
  readonly name: string;
  readonly group: string;
  readonly layer: Layer;
  /** 恰好两枚，见文件头的三类。 */
  readonly tags: readonly [Provenance, Provenance];
  /** 定制了什么。只有 vxture 类需要写。 */
  readonly deviation?: string;
  /** 待删 / 待迁出，不计入统计卡的"已完成"。 */
  readonly pending?: boolean;
  /**
   * 变体轴：轴名 → 全部取值。用于在页面上标出"这件到底有几个变体"，
   * 以及统计卡里的合计——不写就没法验证摆出来的样例是不是全的。
   *
   * 能从组件导出的运行时数组取就取（如 Button 的 BUTTON_VARIANTS），
   * 那样加一个变体不必回来改这里。
   */
  readonly axes?: readonly {
    readonly name: string;
    readonly values: readonly string[];
  }[];
  /**
   * 本条同时展示了哪些别的组件。
   *
   * 一族东西（ViewLayout / Section / SectionHeader）拆成三条各摆一次，读者反而
   * 看不出它们的层级关系——族就该一起看。但件数不能因此少算，也不能让覆盖检查
   * 以为它们没露过面，故在此声明。
   */
  readonly covers?: readonly string[];
  readonly render: () => React.ReactNode;
}

/**
 * 组件页内部的分组顺序。大类见 `./sections`——那一层决定进哪个页面，这一层只决定
 * 在页面里的先后。
 */
export const GROUPS = [
  "表单",
  "展示",
  "导航",
  "浮层",
  "反馈",
  "图案",
  "模板",
] as const;

export const ENTRIES: readonly Entry[] = [
  /* ── 表单 ───────────────────────────────────────────────── */
  {
    name: "Button",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    axes: [
      { name: "variant", values: [...BUTTON_VARIANTS] },
      { name: "size", values: [...BUTTON_SIZES] },
    ],
    render: () => (
      <>
        {BUTTON_VARIANTS.map((v) => (
          <Row key={v} label={v}>
            {/* 档位由数组驱动：声明了几档就摆几个，样例数不会再和轴对不上。 */}
            {BUTTON_SIZES.map((size) =>
              size.startsWith("icon") ? (
                <Button
                  key={size}
                  variant={v}
                  size={size}
                  aria-label={size}
                  title={size}
                >
                  <Icon name="plus" />
                </Button>
              ) : (
                <Button key={size} variant={v} size={size} title={size}>
                  {size}
                </Button>
              ),
            )}
            <Button variant={v} disabled title="disabled">
              禁用
            </Button>
          </Row>
        ))}
      </>
    ),
  },
  {
    name: "Input",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-md">
        <Input placeholder="默认" />
        <Input defaultValue="有值" />
        <Input aria-invalid defaultValue="失效态（aria-invalid 驱动）" />
        <Input disabled defaultValue="禁用" />
        <Input type="file" />
      </div>
    ),
  },
  {
    name: "Textarea",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-md">
        <Textarea placeholder="默认（field-sizing 随内容增高）" />
        <Textarea aria-invalid defaultValue="失效态" />
        <Textarea disabled defaultValue="禁用" />
      </div>
    ),
  },
  {
    name: "Label",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <Label htmlFor="r-label">字段名</Label>
        <Input
          id="r-label"
          className="max-w-media-2xl"
          placeholder="关联控件"
        />
      </Row>
    ),
  },
  {
    name: "Checkbox",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <span className="flex items-center gap-xs">
          <Checkbox id="r-cb1" defaultChecked />
          <Label htmlFor="r-cb1">已选中</Label>
        </span>
        <span className="flex items-center gap-xs">
          <Checkbox id="r-cb2" />
          <Label htmlFor="r-cb2">未选中</Label>
        </span>
        <span className="flex items-center gap-xs">
          <Checkbox id="r-cb4" checked="indeterminate" />
          <Label htmlFor="r-cb4">半选</Label>
        </span>
        <span className="flex items-center gap-xs">
          <Checkbox id="r-cb3" disabled defaultChecked />
          <Label htmlFor="r-cb3">禁用</Label>
        </span>
      </Row>
    ),
  },
  {
    name: "Switch",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <span className="flex items-center gap-xs">
          <Switch id="r-sw1" defaultChecked />
          <Label htmlFor="r-sw1">开</Label>
        </span>
        <span className="flex items-center gap-xs">
          <Switch id="r-sw2" />
          <Label htmlFor="r-sw2">关</Label>
        </span>
        <span className="flex items-center gap-xs">
          <Switch id="r-sw3" disabled defaultChecked />
          <Label htmlFor="r-sw3">禁用</Label>
        </span>
      </Row>
    ),
  },
  {
    name: "Select",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <Select>
          <SelectTrigger className="w-media-2xl">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">选项 A</SelectItem>
            <SelectItem value="b">选项 B</SelectItem>
            <SelectItem value="c">选项 C</SelectItem>
          </SelectContent>
        </Select>
        <Select disabled>
          <SelectTrigger className="w-media-2xl">
            <SelectValue placeholder="禁用" />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </Row>
    ),
  },

  {
    name: "NativeSelect",
    layer: "atom",
    group: "表单",
    tags: ["vxture", "component"],
    deviation:
      "与 Radix 的 Select 并存：那件把列表渲染进 portal，拿不到移动端系统选择器与表单原生提交。尺度与焦点表现对齐 Input，箭头自绘（原生箭头不跟随主题）",
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-md">
        <NativeSelect defaultValue="b">
          <option value="a">选项 A</option>
          <option value="b">选项 B</option>
          <option value="c">选项 C</option>
        </NativeSelect>
        <NativeSelect aria-invalid defaultValue="a">
          <option value="a">失效态</option>
        </NativeSelect>
        <NativeSelect disabled defaultValue="a">
          <option value="a">禁用</option>
        </NativeSelect>
      </div>
    ),
  },
  {
    name: "SegmentedControl",
    layer: "atom",
    group: "表单",
    tags: ["vxture", "patterns"],
    deviation:
      "取代 PageSizePicker 与 ViewModeSwitch——两者形状相同，只是一个装数字一个装图标。语义用 radiogroup；选中态由本件画，不再靠调用方挂 .is-active",
    axes: [{ name: "size", values: ["sm", "md"] }],
    render: () => <SegmentedControlDemo />,
  },
  {
    name: "RadioGroup",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    deviation:
      "指示点用 rounded-full 的 span 而非上游的 Circle 图标——本仓图标字典没有 circle，纯色圆点也不值得为此扩字典",
    render: () => (
      <RadioGroup defaultValue="b" className="w-full max-w-content-base-xl">
        <span className="flex items-center gap-xs">
          <RadioGroupItem value="a" id="r-rg1" />
          <Label htmlFor="r-rg1">按量计费</Label>
        </span>
        <span className="flex items-center gap-xs">
          <RadioGroupItem value="b" id="r-rg2" />
          <Label htmlFor="r-rg2">包月订阅（默认选中）</Label>
        </span>
        <span className="flex items-center gap-xs">
          <RadioGroupItem value="c" id="r-rg3" disabled />
          <Label htmlFor="r-rg3">企业专属（禁用）</Label>
        </span>
      </RadioGroup>
    ),
  },
  {
    name: "Slider",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-lg">
        <Row label="单值" stack>
          <Slider defaultValue={[40]} max={100} step={1} />
        </Row>
        <Row label="禁用" stack>
          <Slider defaultValue={[65]} max={100} step={1} disabled />
        </Row>
      </div>
    ),
  },
  {
    name: "Toggle",
    layer: "atom",
    group: "表单",
    tags: ["shadcn", "origin"],
    axes: [
      { name: "variant", values: [...TOGGLE_VARIANTS] },
      { name: "size", values: [...TOGGLE_SIZES] },
    ],
    render: () => (
      <>
        {TOGGLE_VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {TOGGLE_SIZES.map((size) => (
              <Toggle
                key={size}
                variant={variant}
                size={size}
                defaultPressed={size === "md"}
                title={size}
              >
                <Icon name="star" />
                {size}
              </Toggle>
            ))}
            <Toggle variant={variant} disabled title="disabled">
              禁用
            </Toggle>
          </Row>
        ))}
      </>
    ),
  },
  {
    name: "ToggleGroup",
    layer: "pattern",
    group: "表单",
    tags: ["shadcn", "origin"],
    axes: [
      { name: "variant", values: [...TOGGLE_VARIANTS] },
      { name: "size", values: [...TOGGLE_SIZES] },
    ],
    render: () => (
      <>
        <Row label="multiple · variant=default">
          <ToggleGroup type="multiple" defaultValue={["bold"]}>
            <ToggleGroupItem value="bold" aria-label="加粗">
              加粗
            </ToggleGroupItem>
            <ToggleGroupItem value="italic" aria-label="斜体">
              斜体
            </ToggleGroupItem>
            <ToggleGroupItem value="underline" aria-label="下划线" disabled>
              下划线
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="single · variant=outline（variant / size 定在 Root，经 context 下发）">
          <ToggleGroup type="single" variant="outline" defaultValue="week">
            <ToggleGroupItem value="day">日</ToggleGroupItem>
            <ToggleGroupItem value="week">周</ToggleGroupItem>
            <ToggleGroupItem value="month">月</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="size 三档（同样定在 Root）">
          {TOGGLE_SIZES.map((size) => (
            <ToggleGroup
              key={size}
              type="single"
              variant="outline"
              size={size}
              defaultValue="a"
            >
              <ToggleGroupItem value="a">{size}</ToggleGroupItem>
              <ToggleGroupItem value="b">对照</ToggleGroupItem>
            </ToggleGroup>
          ))}
        </Row>
      </>
    ),
  },
  {
    name: "Combobox",
    layer: "pattern",
    group: "表单",
    tags: ["vxture", "patterns"],
    deviation:
      "上游只给组合示例（Button + Popover + Command），这里落成 pattern：items 零业务（value/label/disabled），value/onValueChange 受控，浮层宽度经 --radix-popover-trigger-width 跟触发器对齐",
    render: () => <ComboboxDemo />,
  },
  {
    name: "DatePicker",
    layer: "pattern",
    group: "表单",
    tags: ["vxture", "patterns"],
    deviation:
      '上游只给组合示例（Button + Popover + Calendar），这里落成 pattern。展示格式用 Intl.DateTimeFormat("zh-CN")，不引 date-fns；再点选中日 = 清空（onValueChange 收 undefined）',
    render: () => <DatePickerDemo />,
  },

  /* ── 展示 ───────────────────────────────────────────────── */
  {
    name: "Badge",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "vxture"],
    deviation:
      "增 asChild（可渲染为 <a>）；保留 forwardRef，上游面向 React 19 已去掉",
    axes: [{ name: "variant", values: [...BADGE_VARIANTS] }],
    render: () => (
      <Row>
        {BADGE_VARIANTS.map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
        <Badge asChild>
          <a href="#badge">asChild 链接</a>
        </Badge>
      </Row>
    ),
  },
  {
    name: "Card",
    layer: "pattern",
    group: "展示",
    tags: ["shadcn", "origin"],
    deviation:
      "透明模式：veil 叠层三档（surface prop）取代实色底与阴影，footer 虚线分隔",
    axes: [{ name: "surface", values: ["soft", "base", "strong"] }],
    render: () => (
      <div className="flex w-full flex-col gap-md">
        <Card className="w-full max-w-content-base-xl">
          <CardHeader>
            <CardTitle>卡片标题（surface=base 68%）</CardTitle>
            <CardDescription>
              描述文字，用 body-sm 与弱化前景色。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-sm text-muted-foreground">
              透明模式：卡片是叠在页面唯一实色底上的半透明表面，层次由发丝线
              描边与透明度表达，无阴影。
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline">取消</Button>
            <Button>确定</Button>
          </CardFooter>
        </Card>
        <div className="grid w-full gap-md sm:grid-cols-2">
          <Card surface="soft">
            <CardHeader>
              <CardTitle>surface=soft（58%）</CardTitle>
              <CardDescription>大面积实体卡、列表卡。</CardDescription>
            </CardHeader>
          </Card>
          <Card surface="strong">
            <CardHeader>
              <CardTitle>surface=strong（72%）</CardTitle>
              <CardDescription>入口卡、重点卡。</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    ),
  },
  {
    name: "Avatar",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "vxture"],
    deviation: "增 AvatarSilhouette 与 UserAvatar 两件（平台头像的兜底形态）",
    render: () => (
      <Row>
        <Avatar>
          <AvatarFallback>VX</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>运维</AvatarFallback>
        </Avatar>
      </Row>
    ),
  },
  {
    name: "Separator",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "origin"],
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-md">
        <Separator />
        <div className="flex h-media-xs items-center gap-md">
          <span className="text-body-sm">左</span>
          <Separator orientation="vertical" />
          <span className="text-body-sm">右</span>
        </div>
      </div>
    ),
  },
  {
    name: "Skeleton",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "vxture"],
    deviation:
      "增 variant（line / rect / circle）与 lines——多行文本占位是列表页最常见形态",
    axes: [{ name: "variant", values: ["line", "rect", "circle"] }],
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-md">
        <Row label="variant=line（lines=3）" stack>
          <Skeleton lines={3} />
        </Row>
        <Row label="variant=rect" stack>
          <Skeleton variant="rect" height={80} />
        </Row>
        <Row label="variant=circle" stack>
          <Skeleton variant="circle" />
        </Row>
      </div>
    ),
  },
  {
    name: "Accordion",
    layer: "pattern",
    group: "展示",
    tags: ["shadcn", "origin"],
    deviation:
      "条目分隔走虚线发丝线（分行语义）；上游的展开高度动画依赖本仓未注册的 accordion keyframes，刻意省略，箭头旋转保留",
    render: () => (
      <Accordion
        type="single"
        collapsible
        defaultValue="a"
        className="w-full max-w-content-base-xl"
      >
        <AccordionItem value="a">
          <AccordionTrigger>配额是怎么计算的？</AccordionTrigger>
          <AccordionContent>
            按订阅档位内含量 + 弹性池叠加计算，月底出账。
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>可以中途升级套餐吗？</AccordionTrigger>
          <AccordionContent>可以，差价按剩余天数折算。</AccordionContent>
        </AccordionItem>
        <AccordionItem value="c">
          <AccordionTrigger>发票何时开具？</AccordionTrigger>
          <AccordionContent>出账后三个工作日内开具并送达。</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
  },
  {
    name: "Collapsible",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "origin"],
    render: () => <CollapsibleDemo />,
  },
  {
    name: "ScrollArea",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "origin"],
    deviation:
      "Viewport 不挂上游的 rounded-[inherit]（任意值语法被禁），圆角裁切由 Root 的 overflow-hidden 承担",
    render: () => (
      <ScrollArea className="h-media-2xl w-media-3xl rounded-md border border-border">
        <div className="flex flex-col gap-xs p-sm">
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} className="text-body-sm text-muted-foreground">
              审计记录 #{String(i + 1).padStart(2, "0")}
            </span>
          ))}
        </div>
      </ScrollArea>
    ),
  },
  {
    name: "AspectRatio",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "origin"],
    render: () => (
      <div className="w-full max-w-content-base-xl">
        <AspectRatio
          ratio={16 / 9}
          className="flex items-center justify-center rounded-md bg-accent"
        >
          <span className="text-body-sm text-muted-foreground">16 : 9</span>
        </AspectRatio>
      </div>
    ),
  },
  {
    name: "Table",
    layer: "pattern",
    group: "展示",
    tags: ["shadcn", "origin"],
    covers: [
      "TableHeader",
      "TableBody",
      "TableFooter",
      "TableHead",
      "TableRow",
      "TableCell",
      "TableCaption",
    ],
    deviation:
      "视觉语法对齐 DataTable 的透明模式：无容器卡、表头下实线、行间虚线、首末列内边距归零；footer 用虚线上边框替换上游的 bg-muted/50。与 DataTable 分工：那件管三态/排序/选择，本族只管 markup",
    render: () => (
      <Table className="max-w-content-base-xl">
        <TableCaption>近期发票（data-state=selected 行为选中态）</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>发票号</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">金额</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>INV-0301</TableCell>
            <TableCell>已支付</TableCell>
            <TableCell className="text-right">¥ 2,500</TableCell>
          </TableRow>
          <TableRow data-state="selected">
            <TableCell>INV-0302</TableCell>
            <TableCell>已支付</TableCell>
            <TableCell className="text-right">¥ 1,800</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>INV-0303</TableCell>
            <TableCell>待支付</TableCell>
            <TableCell className="text-right">¥ 950</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>合计</TableCell>
            <TableCell className="text-right">¥ 5,250</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    ),
  },
  {
    name: "Calendar",
    layer: "pattern",
    group: "展示",
    tags: ["shadcn", "origin"],
    axes: [{ name: "mode", values: ["single", "range"] }],
    deviation:
      "classNames key 逐个对过 react-day-picker v10 枚举；选中态不走 selected/range_* 的 classNames（同格双 key 会赌 CSS 顺序），改自定义 DayButton 读 modifiers 按条件拼类；箭头换本仓 Icon",
    render: () => <CalendarDemo />,
  },

  /* ── 导航 ───────────────────────────────────────────────── */
  {
    name: "Tabs",
    layer: "pattern",
    group: "导航",
    tags: ["shadcn", "origin"],
    render: () => (
      <Tabs defaultValue="a" className="w-full max-w-content-base-xl">
        <TabsList>
          <TabsTrigger value="a">概览</TabsTrigger>
          <TabsTrigger value="b">配额</TabsTrigger>
          <TabsTrigger value="c" disabled>
            禁用
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">
          <p className="text-body-sm text-muted-foreground">概览内容。</p>
        </TabsContent>
        <TabsContent value="b">
          <p className="text-body-sm text-muted-foreground">配额内容。</p>
        </TabsContent>
      </Tabs>
    ),
  },
  {
    name: "Breadcrumb",
    layer: "pattern",
    group: "导航",
    tags: ["shadcn", "origin"],
    render: () => (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#">控制台</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="#">能力模块</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>模型接入</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    ),
  },
  {
    name: "Pagination",
    layer: "pattern",
    group: "导航",
    tags: ["shadcn", "vxture"],
    deviation:
      "整套 API 自有：上游是 <a href> 组合件（URL 驱动），工作台全是受控回调",
    render: () => <PaginationDemo />,
  },

  /* ── 浮层 ───────────────────────────────────────────────── */
  {
    name: "Dialog",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">打开 Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认操作</DialogTitle>
              <DialogDescription>
                这个动作会影响所有已挂载的能力模块。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">取消</Button>
              <Button variant="destructive">确认</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
    ),
  },
  {
    name: "Drawer",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "vxture"],
    deviation:
      "对应上游 Sheet（非其 vaul 版 Drawer）；受控便捷式 API 而非组合式——页眉页脚结构固定",
    axes: [{ name: "side", values: ["right", "left"] }],
    render: () => <DrawerDemo />,
  },
  {
    name: "DropdownMenu",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">下拉菜单</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>操作</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>编辑</DropdownMenuItem>
            <DropdownMenuItem>复制</DropdownMenuItem>
            <DropdownMenuItem disabled>禁用项</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    ),
  },
  {
    name: "Popover",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="text-body-sm text-foreground">
              定位与碰撞处理由 Radix 承担。
            </p>
          </PopoverContent>
        </Popover>
      </Row>
    ),
  },
  {
    name: "Tooltip",
    layer: "atom",
    group: "浮层",
    tags: ["shadcn", "origin"],
    axes: [{ name: "variant", values: [...TOOLTIP_VARIANTS] }],
    render: () => (
      <Row>
        {TOOLTIP_VARIANTS.map((v) => (
          <Tooltip key={v}>
            <TooltipTrigger asChild>
              <Button variant="outline">悬停看提示（{v}）</Button>
            </TooltipTrigger>
            <TooltipContent variant={v}>variant={v} 的提示文本</TooltipContent>
          </Tooltip>
        ))}
      </Row>
    ),
  },
  {
    name: "AlertDialog",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">删除工作空间</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定要删除吗？</AlertDialogTitle>
              <AlertDialogDescription>
                工作空间及其全部成员授权将立即失效，且不可恢复。没有 X
                关闭钮：必须在两个按钮之间表态。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              {/* 不可撤销的落锤动作换到实心红档，样式函数与 Button 共用。 */}
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive-strong" })}
              >
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Row>
    ),
  },
  {
    name: "HoverCard",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <Row>
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">@vxture</Button>
          </HoverCardTrigger>
          <HoverCardContent>
            <div className="flex flex-col gap-2xs">
              <span className="text-label-md">Vxture 平台</span>
              <span className="text-body-sm text-muted-foreground">
                悬停出预览面。只对指针设备生效，关键信息不能只放这里。
              </span>
            </div>
          </HoverCardContent>
        </HoverCard>
      </Row>
    ),
  },
  {
    name: "ContextMenu",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    render: () => (
      <ContextMenu>
        <ContextMenuTrigger className="flex h-media-lg w-full max-w-content-base-xl items-center justify-center rounded-md border border-dashed border-border text-body-sm text-muted-foreground">
          在这块区域里右键
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>操作</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem>
            重命名
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled>移动（禁用）</ContextMenuItem>
          <ContextMenuCheckboxItem checked>显示已归档</ContextMenuCheckboxItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>排序方式</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup value="name">
                <ContextMenuRadioItem value="name">按名称</ContextMenuRadioItem>
                <ContextMenuRadioItem value="time">按时间</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive-muted-foreground">
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    ),
  },
  {
    name: "Command",
    layer: "pattern",
    group: "浮层",
    tags: ["shadcn", "origin"],
    covers: ["CommandDialog"],
    deviation:
      "CommandDialog 复用本仓 Dialog（遮罩/动效/Esc 不重写）；条目状态属性是 cmdk 的 data-selected/data-disabled 带值形态，非 Radix 的 data-state",
    render: () => <CommandDemo />,
  },

  /* ── 反馈 ───────────────────────────────────────────────── */
  {
    name: "Toast",
    layer: "pattern",
    group: "反馈",
    tags: ["shadcn", "vxture"],
    deviation:
      "整套 API 自有：上游现行方案是 sonner，迁移要动产品侧 16 处 useToast，需单独立项。tone 已收敛到共用六档（error→danger，ai 档移除，AI 语气由 AI 组件族自身承载）",
    axes: [{ name: "tone", values: [...TONES] }],
    render: () => <ToastDemo />,
  },

  {
    name: "Banner",
    layer: "pattern",
    group: "反馈",
    tags: ["vxture", "patterns"],
    deviation:
      "与 Toast 分工：Toast 说刚才那一下成了没有，说完就走；Banner 说这个页面现在处于什么状态，状态还在就一直在。tone 改用共用的六档语气（原为含 ai 的自有五值），图标由语气决定",
    axes: [{ name: "tone", values: [...TONES] }],
    render: () => <BannerDemo />,
  },
  {
    name: "Progress",
    layer: "atom",
    group: "反馈",
    tags: ["shadcn", "origin"],
    deviation:
      "轨道语法对齐 TokenCounter（bg-accent 轨道 + rounded-4xl），不用上游的 bg-primary/20——同一形状在 DS 内只有一套画法",
    render: () => (
      <div className="flex w-full max-w-content-base-xl flex-col gap-lg">
        {[13, 66, 88].map((value) => (
          <Row key={value} label={`value=${value}`} stack>
            <Progress value={value} />
          </Row>
        ))}
      </div>
    ),
  },

  /* ── 图案（完全自建）─────────────────────────────────────── */
  {
    name: "EntryCard",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "提炼自 admin 入口卡。与 MetricCard 分工：MetricCard 报数、EntryCard 引路；唯一图标带色块底的卡（门牌比路标醒目）",
    axes: [{ name: "meta", values: ["with", "without"] }],
    render: () => (
      <div className="grid w-full gap-md sm:grid-cols-2">
        <EntryCard
          href="#entry-card-demo"
          icon="database"
          title="模型接入"
          meta="12 个供给方"
          description="管理供给方、配额与调用审计。"
        />
        <EntryCard
          href="#entry-card-demo"
          icon="users"
          title="成员与权限"
          description="邀请成员、分配角色、审计授权变更。"
        />
      </div>
    ),
  },
  {
    name: "ListCard",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "清单页 cards 视图的行卡：与 DataTable 行同一份信息的卡片形态，语法固定为两行主列 + 右上状态/操作 + 底部 meta 行。与 EntryCard 分工：EntryCard 引路，ListCard 是数据行本身；ListCardGrid 统一断点，各页不自定义列数",
    render: () => (
      <ListCardGrid className="w-full">
        <ListCard
          icon="database"
          title="通道甲"
          description="ch-001 · 模型组"
          onTitleClick={() => undefined}
          status={
            <StatusBadge tone="success" dot>
              运行中
            </StatusBadge>
          }
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-md" aria-label="操作">
                  <Icon name="more-vertical" size="sm" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>编辑</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
          meta={<span>调用 1,284,930 · P95 412ms</span>}
        />
        <ListCard
          icon="users"
          title="通道乙"
          description="ch-002 · 检索组"
          status={
            <StatusBadge tone="warning" dot>
              降级
            </StatusBadge>
          }
          meta={<span>调用 88,120 · P95 940ms</span>}
        />
      </ListCardGrid>
    ),
  },
  {
    name: "ViewHeader",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    covers: ["ViewLayout", "SplitViewLayout", "Section", "SectionHeader"],
    deviation:
      "产品扫描出现频次第一（72 处文件）。删了 5 个 *ClassName 逃生口与 actions 别名——逃生口会把页头内部 DOM 变成公开契约",
    render: () => (
      <ViewHeader
        className="w-full"
        icon="squares-four"
        title="模型接入"
        description="管理供给方、配额与调用审计。"
        secondary={<StatusBadge tone="success">运行中</StatusBadge>}
        action={
          <>
            <Button variant="outline">导出</Button>
            <Button>新建</Button>
          </>
        }
      />
    ),
  },
  {
    name: "DetailList",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    covers: ["DetailRow"],
    deviation:
      "详情页的只读字段行（console 五个页面 42 行同形，admin 同形）。语义走 <dl>/<dt>/<dd>，读屏按名值对播报；label 收为 string（42/42 实据都是一句 t(...)），值走 children 以便就地拼状态标；不设 actionable 变体——遗留类名那个修饰符与是否真有操作并不对应，布局由 actions 有无推导。分隔线挂列表不挂行，末行天然无边框",
    axes: [{ name: "actions", values: ["with", "without"] }],
    render: () => (
      <DetailList className="w-full">
        <DetailRow label="显示名称">Zhang San</DetailRow>
        <DetailRow
          label="手机号"
          actions={
            <Button variant="ghost" size="md">
              更换
            </Button>
          }
        >
          +86 138 0000 0000
          <StatusBadge tone="success">已验证</StatusBadge>
        </DetailRow>
        <DetailRow
          label="邮箱"
          actions={
            <>
              <Button variant="ghost" size="md">
                验证
              </Button>
              <Button variant="ghost" size="md">
                更换
              </Button>
            </>
          }
        >
          zhangsan@example.com
          <StatusBadge tone="warning">未验证</StatusBadge>
        </DetailRow>
        <DetailRow label="注册时间">2026-08-04 01:33</DetailRow>
      </DetailList>
    ),
  },
  {
    name: "StatusBadge",
    layer: "atom",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "在 Badge 之上加语气与圆点。tone 只表达严重度，没有 overdue / suspended 这类业务值",
    axes: [{ name: "tone", values: [...TONES] }],
    render: () => (
      <>
        <Row label="六种语气">
          {TONES.map((t) => (
            <StatusBadge key={t} tone={t}>
              {t}
            </StatusBadge>
          ))}
        </Row>
        <Row label="带圆点（密集列表里不靠颜色也能分辨）">
          {TONES.map((t) => (
            <StatusBadge key={t} tone={t} dot>
              {t}
            </StatusBadge>
          ))}
        </Row>
      </>
    ),
  },
  {
    name: "EmptyState",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "只加了 icon——空态图标是固定构成，不给就等于让每个产品在外面套一层自己的 div",
    render: () => (
      <>
        <EmptyState
          className="w-full"
          icon="list"
          title="还没有任何记录"
          description="创建第一条记录后，这里会显示它的状态与最近变更。"
          action={<Button>新建</Button>}
        />
        <EmptyState className="w-full" title="无图标形态" />
      </>
    ),
  },
  {
    name: "结构件族",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "ViewHeader / SectionHeader(level 1–4) / Section / ViewLayout / SplitViewLayout 是一族，层级与间距节奏一次定齐；字级对齐 admin 密度（20/16/14），level 2 默认带虚线下边框",
    axes: [
      { name: "level", values: ["1", "2", "3", "4"] },
      { name: "divider", values: ["default(level2)", "off"] },
      { name: "tone", values: ["default", "raised"] },
    ],
    render: () => (
      <ViewLayout className="w-full rounded-lg border border-dashed border-border p-lg">
        <SectionHeader
          level={1}
          icon="squares-four"
          title="大板块标题（h1 · title-lg 18px · icon 32）"
          description="页头之下的一级板块，icon 与字级自页头逐级递减。"
        />
        <SectionHeader
          level={2}
          icon="database"
          title="二级标题（h2 · title-md 16px · 虚线下边框）"
          description="板块标题区，可带板块级动作。"
          action={<Button variant="outline">板块动作</Button>}
        />
        <SectionHeader
          level={2}
          divider={false}
          title="二级标题（divider=false）"
        />
        <Section
          title="Section · default"
          description="不托起，靠留白与标题分层。绝大多数板块用这个。"
        >
          <p className="text-body-sm text-muted-foreground">板块内容。</p>
        </Section>
        <Section
          tone="raised"
          level={3}
          title="Section · raised（h3 · title-sm）"
          description="描边 + 卡片底色，用于需要与周围明确切开的块。"
          action={<Button variant="destructive">危险操作</Button>}
        >
          <p className="text-body-sm text-muted-foreground">
            raised 对应视觉高度阶梯那一档，不叫
            muted——后者在色彩语义里已表示弱化。
          </p>
        </Section>
        <SectionHeader level={4} title="四级标题（h4 · label-md）" />
      </ViewLayout>
    ),
  },
  {
    name: "SplitViewLayout",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "原名 SettingsSplitPage。Settings 是场景，这件表达的是形状；窄屏塌成单列",
    render: () => (
      <SplitViewLayout
        className="w-full rounded-lg border border-dashed border-border p-lg"
        navigation={
          <div className="flex flex-col gap-2xs rounded-md border border-border p-sm">
            <span className="text-label-sm text-foreground">导航项一</span>
            <span className="text-body-sm text-muted-foreground">导航项二</span>
            <span className="text-body-sm text-muted-foreground">导航项三</span>
          </div>
        }
        content={
          <Section
            title="右侧内容"
            description="min-w-0 flex-1，不被导航挤压。"
          >
            <p className="text-body-sm text-muted-foreground">内容区。</p>
          </Section>
        }
      />
    ),
  },
  {
    name: "SectionNav",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "SplitViewLayout 的左栏。条目是左对齐两行块，不复用 Button——后者是单行居中控件，套上去要一串 className 把布局全覆盖掉",
    render: () => <SectionNavDemo />,
  },
  {
    name: "FilterBar",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "只管筛选控件与右侧动作。删了 title / description——板块标题只由 SectionHeader 一处产出",
    render: () => (
      <FilterBar
        className="w-full"
        actions={
          <>
            <Button variant="outline">导出</Button>
            <Button>新建</Button>
          </>
        }
      >
        <Input className="w-56" placeholder="搜索名称…" />
        <Select defaultValue="all">
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">运行中</SelectItem>
            <SelectItem value="paused">已暂停</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
    ),
  },
  {
    name: "ActionMenu",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "数据驱动，只收 items。icon 收为 IconName 而非 ReactNode——传 node 等于把图标尺寸与颜色的决定权交回调用方",
    render: () => (
      <Row label="触发器形态、危险项配色、分隔位置都由本件固定">
        <ActionMenu
          items={[
            { id: "edit", label: "编辑", icon: "edit" },
            { id: "copy", label: "复制", icon: "copy" },
            { id: "lock", label: "已锁定", icon: "key", disabled: true },
            {
              id: "delete",
              label: "删除",
              icon: "trash",
              danger: true,
              separatorBefore: true,
            },
          ]}
        />
      </Row>
    ),
  },
  {
    name: "BulkActionBar",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "count 为 0 时返回 null——它只在有选中项时存在。删了 primaryActions：无选中时也显示的动作属于 FilterBar",
    render: () => <BulkActionBarDemo />,
  },
  {
    name: "DataTable",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    covers: ["TableTitleCell"],
    deviation:
      "三态一次定齐：加载出骨架行（撑住高度不让页面跳）、空态出 EmptyState、有数据出行。选择态受控于 selectedKeys，与 BulkActionBar 对接；表头半选走 indeterminate。透明模式：无容器卡，顶边实线/表头实线/行间虚线，首末列内边距归零与上下文对齐；footer 槽位承分页。列语法（admin 列表惯例）：选择框-序号(indexStart)-两行主列(TableTitleCell)-信息列-锁定操作列(rowActions，横向滚动钉右)",
    render: () => <DataTableDemo />,
  },
  {
    name: "MetricGrid",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    covers: ["MetricCard"],
    axes: [
      { name: "columns", values: ["2", "3", "4", "5", "6"] },
      // MetricCard 的 tone——六张示例卡各占一档，columns=6 那排一次看全。
      { name: "tone", values: [...TONES] },
    ],
    deviation:
      "卡片按语气染顶缘色条不染底：一排卡片靠色条分组，整块染色会盖过读数本身。趋势徽章挨着数字，它修饰的是数字不是卡片",
    render: () => <MetricGridDemo />,
  },
  {
    name: "DialogForm",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "页脚由 props 描述而非 markup 槽，danger 一个开关覆盖常规/危险两种提交。字段区仍是 children——表单字段是业务形状",
    axes: [{ name: "size", values: ["sm", "md", "lg"] }],
    render: () => <DialogFormDemo />,
  },
  {
    name: "FieldTier",
    layer: "pattern",
    group: "图案",
    tags: ["vxture", "patterns"],
    deviation:
      "档位是三值枚举不是开放字符串——档一多就退化成随手分组，跨页面对不上。advanced 默认折叠：它的存在本身就是「这里你多半不用碰」的信号",
    axes: [{ name: "tier", values: ["identity", "details", "advanced"] }],
    render: () => <FieldTierDemo />,
  },

  /* ── 模板（页面级骨架，只定结构与区块占位）───────────────── */
  {
    name: "ListPageTemplate",
    layer: "pattern",
    group: "模板",
    tags: ["vxture", "patterns"],
    deviation:
      "只定结构：页头 / 筛选行 / 批量条 / 表格四槽自上而下，页头与列表区 gap-xl、列表区三段 gap-sm；样例数据为演示填充",
    render: () => (
      <ListPageTemplate
        className="w-full rounded-lg border border-dashed border-border p-lg"
        header={
          <ViewHeader
            icon="list"
            title="对象列表"
            description="header 槽放 ViewHeader，filters / bulkBar / table 各占一槽。"
            action={<Button>新建</Button>}
          />
        }
        filters={
          <FilterBar actions={<Button variant="outline">导出</Button>}>
            <Input className="w-56" placeholder="搜索记录…" />
            <Select defaultValue="all">
              <SelectTrigger className="w-40" aria-label="类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="a">类型甲</SelectItem>
                <SelectItem value="b">类型乙</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={2}
            onClear={() => undefined}
            actions={[
              { id: "export", label: "导出", icon: "arrow-down" },
              { id: "delete", label: "删除", icon: "trash", danger: true },
            ]}
          />
        }
        table={<TemplateTableDemo />}
      />
    ),
  },
  {
    name: "DetailPageTemplate",
    layer: "pattern",
    group: "模板",
    tags: ["vxture", "patterns"],
    deviation:
      "只定结构：页头 + 主列（Section 阶梯自组）+ 可选右栏摘要（max-w-panel-sm）；窄屏 aside 塌到主列之下——摘要是主体字段的快照，塌上会把主体挤出首屏；样例数据为演示填充",
    render: () => (
      <DetailPageTemplate
        className="w-full rounded-lg border border-dashed border-border p-lg"
        header={
          <ViewHeader
            icon="cube"
            title="对象详情"
            secondary={<StatusBadge tone="success">正常</StatusBadge>}
            description="header 槽 + children（板块阶梯）+ aside 槽。"
            action={<Button variant="outline">编辑</Button>}
          />
        }
        aside={
          <Section tone="raised" level={3} title="摘要">
            <div className="flex flex-col gap-xs text-body-sm">
              <div className="flex justify-between gap-sm">
                <span className="text-muted-foreground">编号</span>
                <span className="text-foreground">A-0001</span>
              </div>
              <div className="flex justify-between gap-sm">
                <span className="text-muted-foreground">创建时间</span>
                <span className="text-foreground">2026-08-01</span>
              </div>
              <div className="flex justify-between gap-sm">
                <span className="text-muted-foreground">负责人</span>
                <span className="text-foreground">示例成员</span>
              </div>
            </div>
          </Section>
        }
      >
        <Section title="基本信息" description="主列由 Section 阶梯自组。">
          <p className="text-body-sm text-muted-foreground">
            这里是对象的基本属性区。
          </p>
        </Section>
        <Section title="变更历史">
          <p className="text-body-sm text-muted-foreground">
            这里是对象的历史记录区。
          </p>
        </Section>
      </DetailPageTemplate>
    ),
  },
  {
    name: "FormPageTemplate",
    layer: "pattern",
    group: "模板",
    tags: ["vxture", "patterns"],
    deviation:
      "只定结构：表单区限宽 max-w-content-narrow-lg 保证行长可读，动作条虚线上边框（hairline.field），sticky 打开时粘底并垫回页面底色；样例数据为演示填充",
    render: () => (
      <FormPageTemplate
        className="w-full rounded-lg border border-dashed border-border p-lg"
        header={
          <ViewHeader
            icon="edit"
            title="编辑对象"
            description="header 槽 + 表单区 children（建议每组 Section）+ footer 动作条。"
          />
        }
        footer={
          <>
            <Button variant="outline">取消</Button>
            <Button>保存</Button>
          </>
        }
      >
        <Section title="基本信息">
          <div className="flex flex-col gap-2xs">
            <Label htmlFor="tpl-form-name">名称</Label>
            <Input id="tpl-form-name" placeholder="示例名称" />
          </div>
          <div className="flex flex-col gap-2xs">
            <Label htmlFor="tpl-form-note">备注</Label>
            <Textarea id="tpl-form-note" rows={3} />
          </div>
        </Section>
      </FormPageTemplate>
    ),
  },
  {
    name: "DashboardTemplate",
    layer: "pattern",
    group: "模板",
    tags: ["vxture", "patterns"],
    deviation:
      "只定结构与阅读顺序：指标区 → 入口区 → 其余板块；指标降列由 MetricGrid 自带，入口栅格由调用方声明；样例数据为演示填充",
    render: () => (
      <DashboardTemplate
        className="w-full rounded-lg border border-dashed border-border p-lg"
        header={
          <ViewHeader
            icon="squares-four"
            title="工作台"
            description="metrics 槽放 MetricGrid，entries 槽放入口卡栅格，其余板块走 children。"
          />
        }
        metrics={
          <MetricGrid
            columns={3}
            items={[
              { id: "total", label: "对象总数", value: "1,284" },
              {
                id: "active",
                label: "活跃记录",
                value: "312",
                tone: "success",
              },
              {
                id: "pending",
                label: "待处理",
                value: "6",
                tone: "warning",
              },
            ]}
          />
        }
        entries={
          <div className="grid gap-md sm:grid-cols-2">
            <EntryCard
              href="#dashboard-template-demo"
              icon="cube"
              title="对象管理"
              meta="1,284 条记录"
              description="查看与维护全部对象。"
            />
            <EntryCard
              href="#dashboard-template-demo"
              icon="users"
              title="成员管理"
              description="邀请成员、分配角色。"
            />
          </div>
        }
      >
        <Section title="最近动态">
          <p className="text-body-sm text-muted-foreground">
            其余板块经 children 排在入口区之后。
          </p>
        </Section>
      </DashboardTemplate>
    ),
  },
  {
    name: "ResultPageTemplate",
    layer: "pattern",
    group: "模板",
    tags: ["vxture", "patterns"],
    axes: [{ name: "tone", values: [...TONES] }],
    deviation:
      "只定结构：EmptyState 的整页形态，直接组合不重写；tone 走 tone.ts 六档，语义色只走顶缘色条；样例数据为演示填充",
    render: () => (
      <div className="grid w-full gap-md lg:grid-cols-2">
        {TONES.map((tone) => (
          <div
            key={tone}
            className="rounded-lg border border-dashed border-border"
          >
            <ResultPageTemplate
              tone={tone}
              title={`${tone} 语气的结果页`}
              description="图标缺省随语气，动作区放返回 / 重试一类按钮。"
              actions={
                <>
                  <Button variant="outline">返回</Button>
                  <Button>继续</Button>
                </>
              }
            />
          </div>
        ))}
      </div>
    ),
  },

  {
    name: "Stack",
    layer: "atom",
    group: "布局",
    tags: ["vxture", "component"],
    covers: ["Grid", "Container"],
    axes: [
      { name: "gap", values: ["xs", "sm", "md", "lg"] },
      { name: "align", values: ["start", "center", "end", "stretch"] },
      // Grid 的 columns 是自由数值（columns?: number，1–12 类表 + 缺省回落 3），
      // 不是枚举变体，不登记为轴；样例仍摆 2/3/4 三档示意。
      { name: "size", values: ["sm", "md", "lg", "xl", "full"] },
    ],
    deviation:
      "间距与宽度已迁到 T2（gap-xs…xl / max-w-page-*），取值逐档不变但从此跟随密度轴。Container 原先读的是断点值，断点是'从这宽度换布局'不是'内容该多宽'，同值纯属巧合",
    render: () => (
      <div className="flex w-full flex-col gap-lg">
        {(["xs", "sm", "md", "lg"] as const).map((gap) => (
          <Row key={gap} label={`Stack gap=${gap}`}>
            <Stack gap={gap} className="w-full">
              <div className="rounded-md bg-accent p-sm text-body-md">一</div>
              <div className="rounded-md bg-accent p-sm text-body-md">二</div>
            </Stack>
          </Row>
        ))}
        {(["start", "center", "end", "stretch"] as const).map((align) => (
          <Row key={align} label={`Stack align=${align}`}>
            <Stack
              align={align}
              gap="sm"
              className="h-media-sm w-full rounded-md border border-dashed border-border p-sm"
            >
              <div className="rounded-md bg-accent px-sm py-2xs text-body-md">
                {align}
              </div>
            </Stack>
          </Row>
        ))}
        {([2, 3, 4] as const).map((columns) => (
          <Row key={columns} label={`Grid columns=${columns}`}>
            <Grid columns={columns} gap="sm" className="w-full">
              {Array.from({ length: columns }, (_, i) => (
                <div key={i} className="rounded-md bg-accent p-sm text-body-md">
                  {i + 1}
                </div>
              ))}
            </Grid>
          </Row>
        ))}
        {(["sm", "md", "lg", "xl", "full"] as const).map((size) => (
          <Row key={size} label={`Container size=${size}`}>
            <Container
              size={size}
              className="w-full rounded-md border border-dashed border-border p-sm text-body-md"
            >
              {size}
            </Container>
          </Row>
        ))}
      </div>
    ),
  },
  {
    // 原条目摆的是 design-ui 的 FullscreenToggle——那件已随全屏死零件退役
    // （2026-08-18 owner 批，全仓零消费）。全屏系统的存活开关是伞包的
    // ShellFullscreenToggle（website 头部在用），条目随之改摆它。
    name: "ShellFullscreenToggle",
    layer: "atom",
    group: "布局",
    tags: ["vxture", "component"],
    axes: [{ name: "mode", values: ["pseudo", "native"] }],
    deviation:
      "全屏开关。必须包在 FullscreenProvider 里才有上下文，故此处连同 provider 一起摆",
    render: () => (
      <FullscreenProvider>
        <Row label="mode=pseudo（工作区全屏）">
          <div
            id="preview-fullscreen-target"
            className="flex w-full items-center justify-between rounded-md border border-dashed border-border p-sm"
          >
            <span className="text-body-md text-muted-foreground">
              可全屏区域
            </span>
            <ShellFullscreenToggle
              targetId="preview-fullscreen-target"
              mode="pseudo"
              getTargetElement={() =>
                document.getElementById("preview-fullscreen-target")
              }
            />
          </div>
        </Row>
        <Row label="mode=native（显示器全屏，Esc 退出）">
          <div
            id="preview-fullscreen-native-target"
            className="flex w-full items-center justify-between rounded-md border border-dashed border-border p-sm"
          >
            <span className="text-body-md text-muted-foreground">
              可全屏区域
            </span>
            <ShellFullscreenToggle
              targetId="preview-fullscreen-native-target"
              mode="native"
              getTargetElement={() =>
                document.getElementById("preview-fullscreen-native-target")
              }
            />
          </div>
        </Row>
      </FullscreenProvider>
    ),
  },
  /* AI 族 5 件（ModelBadge/TokenCounter/AIAssistantBubble/GenerationStream/PromptInput）
     已迁出 DS 归 agent-studio/varda（2026-08-18，owner 判：DS 只收通用、无业务含义
     的件——那五件说的是模型部署 / AI 会话 / token 用量）。预览面只陈列 DS 自己的东西。 */
  /* ── 外壳与登录（伞包自持的两个组合族）───────────────────── */
  {
    name: "ShellChrome",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "批 O 重写：图标按钮复用 Button（ghost/icon-sm，焦点环与 aria-expanded 高亮在配方层），语言面板与用户菜单改走 Popover（外点/Escape/动效由 Radix 提供，替代手写监听），偏好面板的下拉与互斥选项复用 NativeSelect / SegmentedControl，认证标与徽章复用 StatusBadge；品牌标识走 §7 的 .vx-brand-* 基线，默认 label 为中性占位 Brand（真名不入仓）",
    render: () => <ShellChromeDemo />,
  },
  {
    // 批 D（2026-08-18）自 shell-template 的 .assistant 收编：外壳右缘停靠列
    // （console/admin 的 Varda 停靠今日共用，opera 可复用）。full 档是全屏
    // 接管（z-modal），预览页只摆 narrow / wide 两档，full 用文字注明。
    name: "ShellDock",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    axes: [{ name: "mode", values: ["narrow", "wide", "full"] }],
    deviation:
      "narrow 固定列 420px / wide clamp(480,46vw,760) / full 全屏接管（本页不演示，会盖住预览器）。取值自 shell-template 逐字收编，零漂移",
    render: () => (
      <Row label="mode=narrow（外壳右缘停靠列，此处限高演示）" stack>
        <div className="flex h-media-3xl w-full overflow-hidden rounded-lg border border-border">
          <div className="flex flex-1 items-center justify-center text-body-sm text-muted-foreground">
            内容区（被停靠列挤压）
          </div>
          <ShellDock mode="narrow" className="h-full">
            <div className="flex flex-1 items-center justify-center text-body-sm text-muted-foreground">
              停靠内容（如 VardaChat inline）
            </div>
          </ShellDock>
        </div>
      </Row>
    ),
  },
  /* AuthLogin 条目已撤（2026-08-18）：认证族迁出 DS 归 accounts——DS 只收
     通用、无业务含义的件，预览面只陈列 DS 自己的东西。 */
  /* ── 批 S：上游目录补齐 ─────────────────────────────────── */
  {
    name: "Spinner",
    layer: "atom",
    group: "反馈",
    tags: ["shadcn", "vxture"],
    deviation:
      "与 Skeleton 分工：Skeleton 占位、Spinner 等待。图标取本仓单一来源 Phosphor 的 spinner（CircleNotch），不引上游的 lucide Loader2；尺寸档与图标刻度逐档同值",
    axes: [{ name: "size", values: SPINNER_SIZES }],
    render: () => (
      <div className="flex flex-col gap-md">
        <Row label="全部尺寸档">
          {SPINNER_SIZES.map((size) => (
            <Spinner key={size} size={size} />
          ))}
        </Row>
        <Row label="带播报文案（sr-only）">
          <Spinner size="sm" label="正在提交" />
          <span className="text-body-sm text-muted-foreground">
            role=status，读屏播报“正在提交”
          </span>
        </Row>
      </div>
    ),
  },
  {
    name: "Kbd",
    layer: "atom",
    group: "展示",
    tags: ["shadcn", "vxture"],
    covers: ["KbdGroup"],
    deviation:
      "上游的 text-[0.7rem] / px-1.5 裸数值不跟随，改绑 T2（text-code-sm / px-2xs），走 code 族等宽字体",
    render: () => (
      <div className="flex flex-col gap-md">
        <Row label="单键">
          <Kbd>Esc</Kbd>
          <Kbd>Enter</Kbd>
          <Kbd>Tab</Kbd>
        </Row>
        <Row label="组合键（KbdGroup）">
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <span className="text-body-sm text-muted-foreground">+</span>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Row>
      </div>
    ),
  },
  {
    name: "ButtonGroup",
    layer: "pattern",
    group: "表单",
    tags: ["shadcn", "vxture"],
    covers: ["ButtonGroupText"],
    deviation:
      "与 SegmentedControl 分工：SegmentedControl 是单选语义，ButtonGroup 是动作并排。接缝清圆角 + -ml-px 叠边 + 聚焦 z-10 抬起承上游",
    axes: [{ name: "orientation", values: BUTTON_GROUP_ORIENTATIONS }],
    render: () => (
      <div className="flex flex-col gap-md">
        <Row label="horizontal（分裂按钮）">
          <ButtonGroup>
            <Button variant="outline">保存</Button>
            <Button variant="outline" size="icon-md">
              <Icon name="chevron-down" size="sm" />
            </Button>
          </ButtonGroup>
        </Row>
        <Row label="带非按钮成员（ButtonGroupText）">
          <ButtonGroup>
            <ButtonGroupText>共 128 条</ButtonGroupText>
            <Button variant="outline">上一页</Button>
            <Button variant="outline">下一页</Button>
          </ButtonGroup>
        </Row>
        <Row label="vertical">
          <ButtonGroup orientation="vertical">
            <Button variant="outline">置顶</Button>
            <Button variant="outline">上移</Button>
            <Button variant="outline">下移</Button>
          </ButtonGroup>
        </Row>
      </div>
    ),
  },
  {
    name: "InputGroup",
    layer: "pattern",
    group: "表单",
    tags: ["shadcn", "vxture"],
    covers: ["InputGroupAddon", "InputGroupInput"],
    deviation:
      "框身（描边/圆角/焦点环/失效态）整体上移到容器，经 has-[] 从内部控件上浮，焦点环包住整组；与 ButtonGroup 分工：一个输入带附属物 vs 多个动作并排",
    axes: [{ name: "align", values: INPUT_GROUP_ALIGNS }],
    render: () => (
      <div className="flex w-full max-w-panel-md flex-col gap-md">
        <Row label="前缀图标" stack>
          <InputGroup>
            <InputGroupAddon>
              <Icon name="search" size="sm" />
            </InputGroupAddon>
            <InputGroupInput placeholder="搜索…" />
          </InputGroup>
        </Row>
        <Row label="前后缀（单位）" stack>
          <InputGroup>
            <InputGroupAddon>￥</InputGroupAddon>
            <InputGroupInput placeholder="0.00" />
            <InputGroupAddon align="end">CNY</InputGroupAddon>
          </InputGroup>
        </Row>
        <Row label="失效态（aria-invalid 上浮到框身）" stack>
          <InputGroup>
            <InputGroupAddon>
              <Icon name="mail" size="sm" />
            </InputGroupAddon>
            <InputGroupInput aria-invalid defaultValue="not-an-email" />
          </InputGroup>
        </Row>
      </div>
    ),
  },
  {
    name: "Field",
    layer: "pattern",
    group: "表单",
    tags: ["shadcn", "vxture"],
    covers: ["FieldGroup", "FieldLabel", "FieldDescription", "FieldError"],
    deviation:
      "取上游核心子集（Set/Legend/responsive 等无实据未收）；刻意不引 react-hook-form——UI 层零表单框架绑定，错误经 FieldError 或 aria-invalid 进来",
    axes: [{ name: "orientation", values: FIELD_ORIENTATIONS }],
    render: () => (
      <FieldGroup className="max-w-panel-md">
        <Field>
          <FieldLabel htmlFor="fld-name">显示名</FieldLabel>
          <Input id="fld-name" placeholder="输入显示名" />
          <FieldDescription>对外展示的名称，可随时修改。</FieldDescription>
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor="fld-email">邮箱</FieldLabel>
          <Input id="fld-email" aria-invalid defaultValue="not-an-email" />
          <FieldError>邮箱格式不正确</FieldError>
        </Field>
        <Field orientation="horizontal">
          <Switch id="fld-notify" />
          <FieldLabel htmlFor="fld-notify">接收通知</FieldLabel>
        </Field>
      </FieldGroup>
    ),
  },
  {
    name: "InputOTP",
    layer: "pattern",
    group: "表单",
    tags: ["shadcn", "vxture"],
    covers: ["InputOTPGroup", "InputOTPSlot", "InputOTPSeparator"],
    deviation:
      "槽位绑控件刻度（h-control-md/w-control-md）随密度三档；假光标用 animate-pulse——不为单组件开全局 keyframes；激活槽高亮与 interactive 同款 ring",
    render: () => (
      <div className="flex flex-col gap-md">
        <Row label="6 位，3+3 分组" stack>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </Row>
      </div>
    ),
  },
  {
    name: "Resizable",
    layer: "pattern",
    group: "展示",
    tags: ["shadcn", "vxture"],
    covers: ["ResizablePanelGroup", "ResizablePanel", "ResizableHandle"],
    deviation:
      "底层 react-resizable-panels v4（Group/Panel/Separator，与 shadcn 文档的 v2 不同代，类名按 v4 钩子重写）；分隔线走发丝线语义；与 SplitViewLayout 分工：定宽双栏归 layout，可拖分栏是控件",
    render: () => (
      <div className="h-row-4xl w-full max-w-content-narrow-lg">
        <ResizablePanelGroup>
          <ResizablePanel defaultSize="40%" minSize="20%">
            <div className="flex h-full items-center justify-center text-body-sm text-muted-foreground">
              导航栏
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel>
            <div className="flex h-full items-center justify-center text-body-sm text-muted-foreground">
              内容区
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    ),
  },
  /* ── 批 R 补登记 ─────────────────────────────────────────────
   * 以下各件在 admin → DS 的收敛过程里建起来，当时只顾着让产品页面跑通，
   * 没回来登记，于是"改了也没人看得见"。这一批一次补齐。 */
  {
    name: "ActionButton",
    layer: "atom",
    group: "表单",
    tags: ["vxture", "component"],
    deviation:
      "Button 的固定形状之一：图标 + 文字。单独成件是因为表格行动作区几十处都在重复同一串 <Icon/> + 文案，抄漏一次就少个图标；iconFallback 兜住图标名拼错的情况，不至于渲染出一个空格",
    render: () => <ActionButtonDemo />,
  },
  {
    name: "LevelMarker",
    layer: "atom",
    group: "展示",
    tags: ["vxture", "component"],
    deviation:
      "等级是 1–5 的定序刻度，不是状态，所以不复用 StatusBadge 的色调族——五档各有自己的深浅，靠色阶读出高低。方形而非胶囊：与同排的 StatusBadge 形状区分，一眼分得清哪个是等级哪个是状态",
    render: () => <LevelMarkerDemo />,
  },
  {
    name: "FactList",
    layer: "pattern",
    group: "展示",
    tags: ["vxture", "patterns"],
    covers: ["LabeledValue"],
    deviation:
      "LabeledValue 是一条「标签 + 值」，FactList 是若干条排成一列。值可带色调，但色调取自 StatusBadgeTone 这一套语义色，不另开一份——同一个「危险」在徽章和事实行里必须是同一个红",
    render: () => <FactListDemo />,
  },
  {
    name: "MetricListCard",
    layer: "pattern",
    group: "展示",
    tags: ["vxture", "patterns"],
    deviation:
      "从 admin 四处重复的「标题 + 若干指标 + 底部动作」卡片里提炼。metrics 是数组不是固定三格，卡与卡之间指标数不同也能对齐；note 槽单独留出来，避免调用方把说明文字塞进 description 后与标题挤在一行",
    render: () => <MetricListCardDemo />,
  },
  {
    name: "PanelCard",
    layer: "pattern",
    group: "展示",
    tags: ["vxture", "patterns"],
    covers: ["PanelItem", "PanelList"],
    deviation:
      "三件一族，拆开看不出层级：PanelCard 是带标题的容器，PanelList 是里面的列，PanelItem 是列中一行（lead / main / trail 三槽）。PanelList 自带 empty 槽——列为空时该显示什么是列的事，不该由每个调用方在外面写三元",
    render: () => <PanelCardDemo />,
  },
  {
    name: "ViewModeSwitch",
    layer: "atom",
    group: "导航",
    tags: ["vxture", "component"],
    deviation:
      "列表/卡片切换。cardsDisabledReason 传了就把卡片档禁用并给出理由——卡片视图退役期间入口要保留可见（否则用户以为功能没了），但点不动且说得出为什么",
    render: () => <ViewModeSwitchDemo />,
  },
  {
    name: "ShellLayout",
    layer: "pattern",
    group: "布局",
    tags: ["vxture", "patterns"],
    deviation:
      "外壳的四件骨架：ShellViewport（整体三分）、ShellHeader（三槽定高）、ShellSidebarFrame（宽度状态机，hidden 是真卸载不是宽度归零）、ShellPageContainer（内容区封顶行宽 + clamp 留白）。单独成件是因为迁移前 console 与 opera 各写各的内容区宽度，两个门户对不上",
    render: () => <ShellLayoutDemo />,
  },
  {
    name: "ShellBootScreen",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "会话未定时的过渡屏。delayMs 默认 250ms 延迟出现——会话在这之前返回的话用户全程看不到本屏，也就没有「闪一下」。预览面里把延迟调到 0 才看得见",
    render: () => <ShellBootScreenDemo />,
  },
  {
    name: "ShellLauncher",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "header 最左的九宫格：业务域切换面板。items 是数据，组件不知道有哪些域——多一个域就是数组里多一项，不改组件",
    render: () => <ShellLauncherDemo />,
  },
  {
    name: "ShellPanel",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "header 各类浮层面板的公共骨架：Content（定宽/留白/打开时不抢焦点）+ Header + Section + 四种行（信息行 / 控件行 / 计量行 / 可进入行）。四种行共用同一套列与行高，所以图标严格同列——这件事由组件保证，不靠调用方拼 flex 时自觉对齐",
    render: () => <ShellPanelDemo />,
  },
  {
    name: "ShellSearchBox",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "header 中槽的全局搜索。受控 query + 分组结果，过滤与检索全在调用方——DS 不知道搜的是什么。快捷键标示在 effect 里判平台，不在首帧读 navigator（服务端与客户端会渲染出不同键位，触发 hydration 不匹配）",
    render: () => <ShellSearchBoxDemo />,
  },
  {
    name: "ShellSidebarNav",
    layer: "pattern",
    group: "外壳与登录",
    tags: ["vxture", "patterns"],
    deviation:
      "分组可折叠的侧栏导航，收起态只剩图标轨。linkComponent 让组件不依赖任何路由实现（opera 传 next/link，console 传 next-intl 的 locale 感知 Link）；分组展开状态按 storageKeyPrefix 各自持久化，两个门户互不覆盖",
    render: () => <ShellSidebarNavDemo />,
  },
];

/* 需要局部状态的几件单独成组件——registry 本身保持成数据。 */

function CollapsibleDemo() {
  const [open, setOpen] = React.useState(true);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex w-full max-w-content-base-xl flex-col gap-xs"
    >
      <div className="flex items-center justify-between">
        <span className="text-label-md">已挂载能力（3）</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-md" aria-label="展开或收起">
            <Icon name={open ? "chevron-up" : "chevron-down"} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="flex flex-col gap-xs">
        {["模型接入", "调用审计", "配额管理"].map((item) => (
          <span
            key={item}
            className="rounded-md border border-border px-sm py-xs text-body-sm"
          >
            {item}
          </span>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CommandDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <Row label="⌘K 式命令面板；输入过滤、键盘巡航由 cmdk 承担">
      <Button variant="outline" onClick={() => setOpen(true)}>
        打开命令面板
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="输入命令或搜索…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="导航">
            <CommandItem onSelect={() => setOpen(false)}>
              <Icon name="home" />
              回到工作台
              <CommandShortcut>G H</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => setOpen(false)}>
              <Icon name="database" />
              模型接入
            </CommandItem>
            <CommandItem disabled>
              <Icon name="settings" />
              系统设置（禁用）
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="操作">
            <CommandItem onSelect={() => setOpen(false)}>
              <Icon name="plus" />
              新建通道
              <CommandShortcut>⌘ N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </Row>
  );
}

function ComboboxDemo() {
  const [value, setValue] = React.useState("beta");
  return (
    <Row label="可搜索单选；触发器宽度由调用方给">
      <Combobox
        className="w-media-3xl"
        value={value}
        onValueChange={setValue}
        placeholder="选择发布通道"
        searchPlaceholder="搜索通道…"
        items={[
          { value: "stable", label: "稳定通道" },
          { value: "beta", label: "灰度通道" },
          { value: "canary", label: "金丝雀通道" },
          { value: "legacy", label: "遗留通道", disabled: true },
        ]}
      />
    </Row>
  );
}

function CalendarDemo() {
  const [date, setDate] = React.useState<Date | undefined>(
    new Date(2026, 7, 12),
  );
  const [range, setRange] = React.useState<
    { from: Date | undefined; to?: Date | undefined } | undefined
  >({
    from: new Date(2026, 7, 5),
    to: new Date(2026, 7, 14),
  });
  return (
    <div className="flex w-full flex-wrap items-start gap-lg">
      <Row label="mode=single" stack>
        <div className="rounded-md border border-border">
          <Calendar
            mode="single"
            defaultMonth={new Date(2026, 7, 1)}
            {...(date !== undefined ? { selected: date } : {})}
            onSelect={setDate}
          />
        </div>
      </Row>
      <Row label="mode=range" stack>
        <div className="rounded-md border border-border">
          <Calendar
            mode="range"
            defaultMonth={new Date(2026, 7, 1)}
            {...(range !== undefined ? { selected: range } : {})}
            onSelect={setRange}
          />
        </div>
      </Row>
    </div>
  );
}

function DatePickerDemo() {
  const [date, setDate] = React.useState<Date | undefined>(
    new Date(2026, 7, 12),
  );
  return (
    <Row label="再点选中日即清空">
      <DatePicker
        className="w-media-3xl"
        {...(date !== undefined ? { value: date } : {})}
        onValueChange={setDate}
        placeholder="选择生效日期"
      />
    </Row>
  );
}

function ShellChromeDemo() {
  const [locale, setLocale] = React.useState<"zh-CN" | "en-US">("zh-CN");
  const [theme, setTheme] = React.useState<"light" | "dark" | "system">(
    "light",
  );
  return (
    <div className="flex w-full flex-col gap-md">
      <Row label="ShellBrand">
        <ShellBrand label="Vxture" />
      </Row>
      <Row label="ShellIconButton（默认 / 激活 / 禁用）">
        <ShellIconButton icon="bell" label="通知" />
        <ShellIconButton icon="search" label="搜索" active />
        <ShellIconButton icon="settings" label="设置" disabled />
      </Row>
      <Row label="ShellThemeToggle / ShellLocaleSwitcher">
        <ShellThemeToggle
          currentTheme={theme === "dark" ? "dark" : "light"}
          onThemeChange={(next) => setTheme(next)}
        />
        <ShellLocaleSwitcher
          currentLocale={locale}
          onLocaleChange={(next) => setLocale(next as "zh-CN" | "en-US")}
        />
      </Row>
      <Row label="ShellUserMenu" stack>
        <ShellUserMenu
          user={{
            displayName: "郭衍浩",
            uniqueLine: "@yanhao",
            avatarFallback: "郭",
            statusTag: { label: "已认证", verified: true },
            badges: [{ key: "lv", label: "Lv.4" }],
          }}
          links={[{ key: "profile", label: "个人信息", href: "#profile" }]}
          actions={[
            {
              key: "switch",
              label: "切换用户",
              icon: "user-switch",
              onClick: () => {},
            },
            // danger 语气（2026-08-18 批 D 补齐）：红字 + hover 淡红底，四端登出同款。
            {
              key: "logout",
              label: "退出登录",
              icon: "sign-out",
              danger: true,
              onClick: () => {},
            },
          ]}
        />
      </Row>
      <Row label="ShellPreferencePanel" stack>
        <ShellPreferencePanel
          locale={locale}
          theme={theme}
          density="default"
          fontSize="default"
          onLocaleChange={(next) => setLocale(next as "zh-CN" | "en-US")}
          onThemeChange={(next) => setTheme(next)}
        />
      </Row>
      <Row label="ShellLegalFooter" stack>
        <ShellLegalFooter
          copyright="© 2026 Vxture"
          links={[
            { href: "#terms", label: "服务条款" },
            { href: "#privacy", label: "隐私政策" },
          ]}
        />
      </Row>
    </div>
  );
}

function BannerDemo() {
  const [dismissed, setDismissed] = React.useState(false);
  return (
    <div className="flex w-full flex-col gap-sm">
      {TONES.map((tone) => (
        <Banner
          key={tone}
          tone={tone}
          title={`${tone} 语气的常驻提示`}
          description="图标由语气决定，调用方不传——同一语气在各处配不同的图就散了。"
        />
      ))}
      <Banner
        tone="warning"
        title="带动作与关闭"
        description="onDismiss 给了才出现关闭按钮：不是所有状态都允许用户自行消掉。"
        action={<Button variant="outline">去处理</Button>}
        {...(dismissed ? {} : { onDismiss: () => setDismissed(true) })}
      />
      {dismissed ? (
        <Button variant="ghost" size="md" onClick={() => setDismissed(false)}>
          恢复关闭按钮
        </Button>
      ) : null}
    </div>
  );
}

interface DemoRow {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly calls: number;
  readonly tone: (typeof TONES)[number];
  readonly status: string;
}

const DEMO_ROWS: readonly DemoRow[] = [
  {
    id: "r1",
    name: "主力推理通道",
    owner: "平台运维",
    calls: 128493,
    tone: "success",
    status: "运行中",
  },
  {
    id: "r2",
    name: "批处理通道",
    owner: "数据组",
    calls: 20418,
    tone: "warning",
    status: "配额将满",
  },
  {
    id: "r3",
    name: "灰度通道",
    owner: "模型组",
    calls: 912,
    tone: "neutral",
    status: "已暂停",
  },
];

function DataTableDemo() {
  const [sort, setSort] = React.useState({
    columnId: "calls",
    direction: "desc" as "asc" | "desc",
  });
  const [selected, setSelected] = React.useState<readonly string[]>(["r1"]);
  const [state, setState] = React.useState<"data" | "loading" | "empty">(
    "data",
  );

  const rows =
    state === "data"
      ? [...DEMO_ROWS].sort((a, b) =>
          sort.direction === "asc" ? a.calls - b.calls : b.calls - a.calls,
        )
      : [];

  return (
    <div className="flex w-full flex-col gap-sm">
      <SegmentedControl
        size="sm"
        ariaLabel="表格状态"
        value={state}
        onChange={setState}
        items={[
          { value: "data", label: "有数据" },
          { value: "loading", label: "加载中" },
          { value: "empty", label: "空态" },
        ]}
      />
      <BulkActionBar
        count={selected.length}
        onClear={() => setSelected([])}
        actions={[
          { id: "export", label: "导出", icon: "arrow-down" },
          { id: "delete", label: "删除", icon: "trash", danger: true },
        ]}
      />
      <DataTable<DemoRow>
        rows={rows}
        rowKey={(row) => row.id}
        loading={state === "loading"}
        empty={
          <EmptyState
            title="还没有任何通道"
            description="创建第一条通道后，这里会显示它的调用量与状态。"
            action={<Button>新建通道</Button>}
          />
        }
        sort={sort}
        onSortChange={setSort}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        indexStart={1}
        rowActions={() => (
          <ActionMenu
            items={[
              { id: "edit", label: "编辑", icon: "edit" },
              {
                id: "delete",
                label: "删除",
                icon: "trash",
                danger: true,
                separatorBefore: true,
              },
            ]}
          />
        )}
        footer={
          <Pagination
            className="w-full"
            page={1}
            pageCount={3}
            total={rows.length * 3}
            filteredTotal={rows.length}
            pageSize={10}
            onPageSizeChange={() => undefined}
            onPageChange={() => undefined}
          />
        }
        columns={[
          {
            id: "name",
            header: "名称",
            cell: (row) => (
              <TableTitleCell
                icon="stack"
                title={row.name}
                description={`ch-${row.id} · ${row.owner}`}
                onTitleClick={() => undefined}
              />
            ),
          },
          {
            id: "calls",
            header: "调用量",
            align: "right",
            sortable: true,
            cell: (row) => row.calls.toLocaleString("zh-CN"),
          },
          {
            id: "status",
            header: "状态",
            cell: (row) => (
              <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
            ),
          },
        ]}
      />
    </div>
  );
}

/** 模板样例里的表格：中性假数据，只为把 table 槽填上。 */
interface TemplateRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly updated: string;
  readonly tone: (typeof TONES)[number];
  readonly status: string;
}

const TEMPLATE_ROWS: readonly TemplateRow[] = [
  {
    id: "t1",
    name: "对象甲",
    kind: "类型甲",
    updated: "2026-08-01",
    tone: "success",
    status: "正常",
  },
  {
    id: "t2",
    name: "对象乙",
    kind: "类型乙",
    updated: "2026-07-28",
    tone: "warning",
    status: "待处理",
  },
  {
    id: "t3",
    name: "对象丙",
    kind: "类型甲",
    updated: "2026-07-12",
    tone: "neutral",
    status: "已归档",
  },
];

function TemplateTableDemo() {
  return (
    <DataTable<TemplateRow>
      rows={TEMPLATE_ROWS}
      rowKey={(row) => row.id}
      columns={[
        { id: "name", header: "名称", cell: (row) => row.name },
        { id: "kind", header: "类型", cell: (row) => row.kind },
        {
          id: "updated",
          header: "更新时间",
          align: "right",
          cell: (row) => row.updated,
        },
        {
          id: "status",
          header: "状态",
          cell: (row) => (
            <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
          ),
        },
      ]}
    />
  );
}

function SegmentedControlDemo() {
  const [size, setSize] = React.useState(20);
  const [mode, setMode] = React.useState<"list" | "cards">("list");
  const [view, setView] = React.useState<"list" | "cards" | "table">("cards");
  return (
    <>
      <Row label="size=sm · 每页条数（原 PageSizePicker）">
        <SegmentedControl
          size="sm"
          ariaLabel="每页条数"
          value={size}
          onChange={setSize}
          items={[10, 20, 50, 100].map((n) => ({
            value: n,
            label: String(n),
            ariaLabel: `每页 ${n} 条`,
          }))}
        />
      </Row>
      <Row label="size=md（默认）· 展示方式（原 ViewModeSwitch）——只有图标时必须给 ariaLabel">
        <SegmentedControl
          ariaLabel="展示方式"
          value={mode}
          onChange={setMode}
          items={[
            { value: "list", icon: "list", ariaLabel: "列表" },
            { value: "cards", icon: "squares-four", ariaLabel: "卡片" },
          ]}
        />
      </Row>
      <Row label="图标 + 文字，含禁用项">
        <SegmentedControl
          value={view}
          onChange={setView}
          items={[
            { value: "list", icon: "list", label: "列表" },
            { value: "cards", icon: "squares-four", label: "卡片" },
            { value: "table", icon: "table", label: "表格", disabled: true },
          ]}
        />
      </Row>
    </>
  );
}

function SectionNavDemo() {
  const [active, setActive] = React.useState("profile");
  return (
    <SectionNav
      className="w-full max-w-content-narrow-lg"
      activeKey={active}
      onSelect={setActive}
      items={[
        {
          key: "profile",
          label: "基本信息",
          description: "名称、头像与联系方式",
        },
        {
          key: "security",
          label: "安全",
          description: "登录方式与二次验证",
          meta: <StatusBadge tone="warning">待完善</StatusBadge>,
        },
        { key: "billing", label: "账单", meta: <Badge>3</Badge> },
        { key: "audit", label: "审计日志", disabled: true },
      ]}
    />
  );
}

function BulkActionBarDemo() {
  const [count, setCount] = React.useState(3);
  return (
    <div className="flex w-full flex-col gap-sm">
      <Row label="count 归零后整条消失">
        <Button variant="outline" size="md" onClick={() => setCount(3)}>
          选中 3 项
        </Button>
        <Button variant="outline" size="md" onClick={() => setCount(0)}>
          清空选中
        </Button>
      </Row>
      <BulkActionBar
        count={count}
        onClear={() => setCount(0)}
        actions={[
          { id: "export", label: "导出", icon: "arrow-down" },
          { id: "disable", label: "停用", icon: "stop" },
          { id: "delete", label: "删除", icon: "trash", danger: true },
        ]}
      />
    </div>
  );
}

function FieldTierDemo() {
  return (
    <Row label="三档并排：identity / details 默认展开，advanced 默认折叠">
      <div className="flex w-full max-w-xl flex-col gap-md">
        <FieldTier tier="identity" hint="决定这条记录是什么，创建后多半改不了">
          <div className="flex flex-col gap-2xs">
            <Label htmlFor="preview-ft-code">接入代号</Label>
            <Input id="preview-ft-code" placeholder="例如：openai-main" />
          </div>
        </FieldTier>
        <FieldTier tier="details" hint="影响展示与运营，改了不动身份">
          <div className="flex flex-col gap-2xs">
            <Label htmlFor="preview-ft-note">备注</Label>
            <Textarea id="preview-ft-note" rows={2} />
          </div>
        </FieldTier>
        <FieldTier tier="advanced" hint="少用、易错、或有副作用">
          <div className="flex flex-col gap-2xs">
            <Label htmlFor="preview-ft-timeout">超时（毫秒）</Label>
            <Input id="preview-ft-timeout" placeholder="30000" />
          </div>
        </FieldTier>
      </div>
    </Row>
  );
}

function DialogFormDemo() {
  const [open, setOpen] = React.useState(false);
  const [danger, setDanger] = React.useState(false);
  const [size, setSize] = React.useState<"sm" | "md" | "lg">("md");
  const openWith = (nextSize: "sm" | "md" | "lg", nextDanger: boolean) => {
    setSize(nextSize);
    setDanger(nextDanger);
    setOpen(true);
  };
  return (
    <Row label="三档宽度 × 两种提交语气；提交中两侧按钮同时禁用">
      {(["sm", "md", "lg"] as const).map((s) => (
        <Button key={s} variant="outline" onClick={() => openWith(s, false)}>
          size={s}
        </Button>
      ))}
      <Button variant="outline" onClick={() => openWith("md", true)}>
        危险提交
      </Button>
      <DialogForm
        open={open}
        onOpenChange={setOpen}
        danger={danger}
        size={size}
        title={danger ? "删除模型接入" : "新建模型接入"}
        description={
          danger
            ? "删除后调用凭据立即失效，且不可恢复。"
            : "填写供给方与配额，保存后立即生效。"
        }
        submitLabel={danger ? "确认删除" : "保存"}
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="flex flex-col gap-2xs">
          <Label htmlFor="preview-df-name">名称</Label>
          <Input id="preview-df-name" placeholder="例如：主力推理通道" />
        </div>
        <div className="flex flex-col gap-2xs">
          <Label htmlFor="preview-df-note">备注</Label>
          <Textarea id="preview-df-note" rows={3} />
        </div>
      </DialogForm>
    </Row>
  );
}

function PaginationDemo() {
  const [page, setPage] = React.useState(3);
  return (
    <Pagination
      className="w-full max-w-content-base-xl"
      page={page}
      pageCount={9}
      total={168}
      pageSize={20}
      onPageChange={setPage}
    />
  );
}

function DrawerDemo() {
  const [side, setSide] = React.useState<"right" | "left" | null>(null);
  const open = side !== null;
  const setOpen = (next: boolean) => {
    if (!next) setSide(null);
  };
  return (
    <Row>
      {(["right", "left"] as const).map((s) => (
        <Button key={s} variant="outline" onClick={() => setSide(s)}>
          打开 Drawer（side={s}）
        </Button>
      ))}
      <Drawer
        open={open}
        side={side ?? "right"}
        onClose={() => setOpen(false)}
        title="模型详情"
        description={`${side === "left" ? "左" : "右"}侧滑出，Esc 或点击遮罩关闭。`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setOpen(false)}>保存</Button>
          </>
        }
      >
        <p className="text-body-sm text-muted-foreground">
          页眉页脚结构固定，内容区由 children 承担。
        </p>
      </Drawer>
    </Row>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <Row label="六档语气；danger 用 assertive 播报，其余 polite">
      {TONES.map((tone) => (
        <Button
          key={tone}
          variant="outline"
          onClick={() =>
            toast({ tone, title: `${tone} 通知`, description: "示例通知。" })
          }
        >
          {tone}
        </Button>
      ))}
    </Row>
  );
}

/** 五档列数各摆一次：轴上写了几档，页面就得能数出几档。 */
function MetricGridDemo() {
  const items: MetricGridItem[] = [
    {
      id: "calls",
      label: "调用总数",
      value: "1,284,930",
      icon: "graph" as const,
      trend: "+12.4%",
      trendTone: "success" as const,
      tone: "info" as const,
    },
    {
      id: "tokens",
      label: "消耗 token",
      value: "8.42 亿",
      icon: "database" as const,
      trend: "+3.1%",
      trendTone: "neutral" as const,
      tone: "brand" as const,
    },
    {
      id: "latency",
      label: "P95 时延",
      value: "412 ms",
      icon: "clock" as const,
      trend: "+86 ms",
      trendTone: "warning" as const,
      tone: "warning" as const,
    },
    {
      id: "errors",
      label: "错误率",
      value: "0.42%",
      icon: "warning" as const,
      trend: "-0.1%",
      trendTone: "success" as const,
      tone: "success" as const,
    },
    {
      id: "cost",
      label: "本月费用",
      value: "¥12,480",
      icon: "chart-bar" as const,
      tone: "neutral" as const,
    },
    {
      id: "quota",
      label: "配额余量",
      value: "63%",
      icon: "chart-bar" as const,
      tone: "danger" as const,
    },
  ];
  return (
    <div className="flex w-full flex-col gap-lg">
      {/* 无图标：不传 icon 即可，不再是一个 variant 档位。 */}
      <Row label="无图标 columns=6" stack>
        <MetricGrid
          className="w-full"
          columns={6}
          items={items.map(({ icon: _icon, ...rest }) => rest)}
        />
      </Row>
      {([2, 3, 4, 5, 6] as const).map((columns) => (
        <Row key={columns} label={`columns=${columns}`} stack>
          <MetricGrid
            className="w-full"
            columns={columns}
            items={items.slice(0, columns)}
          />
        </Row>
      ))}
    </div>
  );
}

/* ── 批 R 补登记的样例 ───────────────────────────────────────── */

function ActionButtonDemo() {
  return (
    <div className="flex flex-col gap-md">
      <Row label="ghost / outline / 危险">
        <ActionButton icon="edit" variant="ghost" size="sm">
          编辑
        </ActionButton>
        <ActionButton icon="download" variant="outline" size="sm">
          导出
        </ActionButton>
        <ActionButton icon="trash" variant="destructive" size="sm">
          删除
        </ActionButton>
      </Row>
      <Row label="禁用">
        <ActionButton icon="edit" variant="ghost" size="sm" disabled>
          编辑
        </ActionButton>
      </Row>
    </div>
  );
}

function LevelMarkerDemo() {
  return (
    <div className="flex flex-col gap-md">
      <Row label="五档（md）">
        {([1, 2, 3, 4, 5] as const).map((level) => (
          <LevelMarker key={level} level={level} />
        ))}
      </Row>
      <Row label="sm 档 / 自带内容">
        {([1, 3, 5] as const).map((level) => (
          <LevelMarker key={level} level={level} size="sm" />
        ))}
        <LevelMarker level={4} aria-label="第 4 级">
          IV
        </LevelMarker>
      </Row>
    </div>
  );
}

function FactListDemo() {
  return (
    <div className="flex flex-col gap-md">
      <Row label="FactList（若干条，值可带色调）" stack>
        <div className="w-overlay-lg">
          <FactList
            facts={[
              { label: "订阅套餐", value: "专业版" },
              { label: "本期用量", value: "82%", tone: "warning" },
              { label: "欠费金额", value: "¥1,240.00", tone: "danger" },
              { label: "下次续费", value: "2026-09-01" },
            ]}
          />
        </div>
      </Row>
      <Row label="LabeledValue（单条）" stack>
        <LabeledValue label="工作区" value="平台运维" />
        <LabeledValue
          label="合规状态"
          value="已通过"
          tone="success"
          valueTag="2026-07"
        />
      </Row>
    </div>
  );
}

function MetricListCardDemo() {
  return (
    <div className="grid gap-md sm:grid-cols-2">
      <MetricListCard
        title="服务可用性"
        description="过去 30 天，按分钟采样"
        icon="waveform"
        tone="success"
        metrics={[
          { key: "uptime", value: "99.98%", label: "可用率" },
          { key: "incidents", value: "2", label: "事件" },
          { key: "mttr", value: "18m", label: "平均恢复" },
        ]}
        footer={
          <Button variant="ghost" size="sm">
            查看明细
          </Button>
        }
      />
      <MetricListCard
        title="计量与结算"
        icon="receipt"
        tone="warning"
        note="本期有 1 张发票逾期未付，续费前需结清。"
        metrics={[
          { key: "usage", value: "1.2M", label: "调用次数" },
          { key: "amount", value: "¥8,430", label: "本期应付" },
        ]}
      />
    </div>
  );
}

function PanelCardDemo() {
  return (
    <div className="grid gap-md sm:grid-cols-2">
      <PanelCard
        title="最近变更"
        description="仅显示影响生产的条目"
        icon="clock-counter-clockwise"
        action={
          <Button variant="ghost" size="sm">
            全部
          </Button>
        }
      >
        <PanelList>
          <PanelItem
            lead={<LevelMarker level={2} size="sm" />}
            main="调整网关限流阈值"
            trail={
              <span className="text-body-sm text-muted-foreground">08-05</span>
            }
          />
          <PanelItem
            lead={<LevelMarker level={4} size="sm" />}
            main="主库只读演练"
            trail={
              <span className="text-body-sm text-muted-foreground">08-03</span>
            }
          />
        </PanelList>
      </PanelCard>
      <PanelCard title="待处理" icon="warning" tone="warning">
        <PanelList empty="没有待处理事项。">{null}</PanelList>
      </PanelCard>
    </div>
  );
}

function ViewModeSwitchDemo() {
  const [mode, setMode] = React.useState<"list" | "cards">("list");
  return (
    <div className="flex flex-col gap-md">
      <Row label={"可切换（当前 " + mode + "）"}>
        <ViewModeSwitch value={mode} onChange={setMode} />
      </Row>
      <Row label="卡片档禁用并说明原因">
        <ViewModeSwitch
          value="list"
          onChange={() => {}}
          cardsDisabledReason="卡片视图正在退役，仅保留入口"
        />
      </Row>
    </div>
  );
}

function ShellLayoutDemo() {
  return (
    <div className="h-96 overflow-hidden rounded-md border border-border">
      <ShellViewport
        sidebarMode="expanded"
        header={
          <ShellHeader
            height="xl"
            leading={<span className="text-label-md">标识区</span>}
            center={
              <span className="text-body-sm text-muted-foreground">中槽</span>
            }
            trailing={<span className="text-label-md">工具区</span>}
          />
        }
        sidebar={
          <ShellSidebarFrame mode="expanded">
            <div className="p-md text-body-sm text-muted-foreground">侧栏</div>
          </ShellSidebarFrame>
        }
      >
        <ShellPageContainer width="wide-2xl">
          <div className="rounded-md border border-dashed border-border p-lg text-body-sm text-muted-foreground">
            内容区：封顶行宽 + clamp 留白
          </div>
        </ShellPageContainer>
      </ShellViewport>
    </div>
  );
}

function ShellBootScreenDemo() {
  return (
    <div className="relative h-64 overflow-hidden rounded-md border border-border">
      {/* 延迟调到 0，否则预览面里看不到这一屏（真实默认 250ms）。 */}
      <ShellBootScreen
        label="Brand"
        description="正在确认登录状态"
        delayMs={0}
      />
    </div>
  );
}

function ShellLauncherDemo() {
  const [current, setCurrent] = React.useState("ops");
  return (
    <Row label={"点开切换业务域（当前 " + current + "）"}>
      <ShellLauncher
        items={[
          {
            key: "ops",
            icon: "squares-four",
            label: "运营业务域",
            description: "租户、订阅、工单",
            active: current === "ops",
          },
          {
            key: "platform",
            icon: "cpu",
            label: "平台自治域",
            description: "服务监控、作业、维护窗口",
            active: current === "platform",
          },
        ]}
        onSelect={setCurrent}
      />
    </Row>
  );
}

function ShellPanelDemo() {
  return (
    <div className="w-fit rounded-md border border-border bg-popover">
      <div className="flex w-80 flex-col gap-md p-md">
        <ShellPanelHeader
          icon="user"
          title="示例用户"
          titleAside={<StatusBadge tone="success">已认证</StatusBadge>}
          metaRows={[
            { key: "org", icon: "buildings", content: "平台运维" },
            { key: "mail", icon: "mail", content: "ops@example.test" },
          ]}
        />
        <ShellPanelSection divided={false}>
          <ShellPanelRow icon="gauge" label="配额" value="82%" />
          <ShellPanelMeterRow
            icon="database"
            label="存储"
            valueLabel="41.2 GB / 50 GB"
            percent={82}
          />
        </ShellPanelSection>
        <ShellPanelSection title="偏好">
          <ShellPanelControlRow icon="translate" label="语言">
            <NativeSelect defaultValue="zh-CN" aria-label="语言">
              <option value="zh-CN">简体中文</option>
            </NativeSelect>
          </ShellPanelControlRow>
        </ShellPanelSection>
        <ShellPanelSection>
          <ShellPanelSectionTitle>入口</ShellPanelSectionTitle>
          <ShellPanelRow icon="settings" label="设置" onClick={() => {}} />
          <ShellPanelRow icon="lock" label="安全中心" disabled />
        </ShellPanelSection>
      </div>
    </div>
  );
}

function ShellSearchBoxDemo() {
  const [query, setQuery] = React.useState("");
  return (
    <Row label="输入任意字符展开结果面板（⌘/Ctrl + K 聚焦）" stack>
      <div className="w-overlay-xl">
        <ShellSearchBox
          query={query}
          onQueryChange={setQuery}
          groups={[
            {
              key: "tenants",
              heading: "租户",
              items: [
                {
                  key: "t1",
                  label: "示例科技",
                  description: "TEN-000123",
                  icon: "buildings",
                  onSelect: () => {},
                },
              ],
            },
            {
              key: "orders",
              heading: "订单",
              items: [
                {
                  key: "o1",
                  label: "专业版年付",
                  description: "ORD-000481",
                  meta: "¥12,000",
                  onSelect: () => {},
                },
              ],
            },
          ]}
        />
      </div>
    </Row>
  );
}

function ShellSidebarNavDemo() {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div className="h-96 overflow-hidden rounded-md border border-border">
      <ShellSidebarFrame mode={collapsed ? "collapsed" : "expanded"}>
        <ShellSidebarNav
          domainName="平台自治域"
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          isActive={(href) => href === "/service-monitor"}
          storageKeyPrefix="preview"
          sections={[
            {
              title: "运行保障",
              items: [
                {
                  href: "/service-monitor",
                  label: "服务监控",
                  icon: "waveform",
                },
                { href: "/platform-jobs", label: "平台作业", icon: "stack" },
                {
                  href: "/maintenance-windows",
                  label: "维护窗口",
                  icon: "timer",
                },
              ],
            },
            {
              title: "能力模块",
              items: [{ href: "/atlas", label: "模型平台", icon: "cpu" }],
            },
          ]}
        />
      </ShellSidebarFrame>
    </div>
  );
}
