/**
 * components/composite/index.ts - 组合组件层导出入口。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Index
 *
 * 本目录放**零业务的组合件**：由 base 单件拼装、直接给 props 可用（"可被产品侧
 * 二次封装"是允许项不是门槛）。收录门槛是产品实据，不是设想：一个件要进来，
 * 得先在 console / admin / opera 里被各自重写过（扫描结论见
 * `workplans/design-system-t1-t4-refactor.md` C2）。
 *
 * 两条硬边界：
 * 1. **零业务**。组合件只认形状不认业务含义——`DataTable` 有列定义，没有
 *    "租户列表"。带业务归属的面板（UserPanel / TenantPanel 一类）不进本包，
 *    归 `@vxture/domain-ui`。
 * 2. **不带产品专名**（D16）。没有 console-* / admin-* / platform-* 前缀。
 */

export * from "./data/ActionMenu";
export * from "./data/BulkActionBar";
export * from "./form/Combobox";
export * from "./data/DataTable";
export * from "./form/DatePicker";
export * from "./form/DialogForm";
export * from "./form/FieldTier";
export * from "./data/FilterBar";
export * from "./data/ViewModeSwitch";
export * from "./data/EntryCard";
export * from "./data/MetricCard";
export * from "./data/MetricListCard";
export * from "./data/MetricGrid";
export * from "./data/TableTitleCell";
export * from "./data/ListCard";
export * from "./data/LabeledValue";
export * from "./data/FactList";
export * from "./structure/DetailList";
export * from "./structure/PanelCard";
export * from "./structure/PanelList";
export * from "./structure/PanelItem";
export * from "./structure/Section";
export * from "./structure/SectionHeader";
export * from "./structure/SectionNav";
export * from "./structure/ViewHeader";
