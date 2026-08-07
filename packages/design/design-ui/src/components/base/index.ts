/**
 * components/base/index.ts - 基础组件层（单件）导出入口。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Index
 *
 * 判据一句话：**单件进 base，组合进 composite，零视觉纯排布进 layout，页面骨架进
 * templates**。"单件"看消费不看构造——StatusBadge / SegmentedControl 构造上是派生，
 * 消费上是一个控件，归这里。shadcn 上游有对应件的：结构照上游，取值绑 T2 语义层，
 * 需要定制的就地定制并在文件头注明偏离及理由。带业务属性的一律不进本包
 * （见 `packages/design/design-system/docs/03-patterns-guide.md` §8）。
 *
 * Drawer 对应上游的 **Sheet**；上游那个基于 vaul 的 Drawer 本仓无对应场景。
 */

export * from "./display/Accordion";
export * from "./overlay/AlertDialog";
export * from "./display/AspectRatio";
export * from "./display/Avatar";
export * from "./display/Badge";
export * from "./feedback/Banner";
export * from "./navigation/Breadcrumb";
export * from "./form/Button";
export * from "./form/ButtonGroup";
export * from "./display/Calendar";
export * from "./display/Card";
export * from "./form/Checkbox";
export * from "./display/Collapsible";
export * from "./overlay/Command";
export * from "./overlay/ContextMenu";
export * from "./overlay/Dialog";
export * from "./display/EmptyState";
export * from "./overlay/Drawer";
export * from "./overlay/DropdownMenu";
export * from "./form/Field";
export * from "./overlay/HoverCard";
export * from "./form/Input";
export * from "./form/InputGroup";
export * from "./form/InputOTP";
export * from "./display/Kbd";
export * from "./form/Label";
export * from "./form/NativeSelect";
export * from "./navigation/Pagination";
export * from "./overlay/Popover";
export * from "./feedback/Progress";
export * from "./form/RadioGroup";
export * from "./display/Resizable";
export * from "./display/ScrollArea";
export * from "./form/SegmentedControl";
export * from "./form/Select";
export * from "./display/Separator";
export * from "./display/Skeleton";
export * from "./form/Slider";
export * from "./feedback/Spinner";
export * from "./display/StatusBadge";
export * from "./display/LevelMarker";
export * from "./form/Switch";
export * from "./display/Table";
export * from "./navigation/Tabs";
export * from "./form/Textarea";
export * from "./feedback/Toast";
export * from "./form/Toggle";
export * from "./form/ToggleGroup";
export * from "./overlay/Tooltip";
