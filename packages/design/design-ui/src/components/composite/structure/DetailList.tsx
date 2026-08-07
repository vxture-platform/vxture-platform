/**
 * DetailList.tsx - 只读字段行列表：一行一条「字段名 — 字段值 — 可选操作」。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 收录依据是产品实据而非设想：console 的账户 / 租户 / 组织 / 安全 / 认证五个
 * 页面里，同一形状出现 42 行（ProfilePage 9、TenantInfoPage 9、OrganizationPage
 * 5 处含一个 17 次调用的行helper、SecurityPage 2、VerificationSkeleton 1），
 * admin 侧同形。原实现挂 .vx-profile-row 一族遗留类名，随 T2 重写退役后无样式。
 *
 * **语义元素用 `<dl>` / `<dt>` / `<dd>`**：这就是 HTML 给「名—值对列表」准备的
 * 元素，读屏会把两者作为一对播报（06-a11y-standard）。用 div 拼同样的视觉，
 * 名与值的关联只存在于视觉里，非视觉用户读到的是两串互不相干的文本。
 * 代价是 `DetailRow` 必须长在 `DetailList` 里——`<dt>`/`<dd>` 脱离 `<dl>` 无效。
 *
 * 名字不叫 Description*：DS 里 `description` 已经稳定表示「标题下面那段说明」
 * （ViewHeader / SectionHeader / CardDescription 都是这个意思），再用它指「名值
 * 对」会让同一个词在两处不同义。取 Detail 与 `DetailPageTemplate` 同一套词汇：
 * 详情页的主列由 Section 分块，块里的字段行就是本件。
 *
 * API 由实据收窄，不留想象中的口子：
 * - **`label` 是 `string` 不是 ReactNode**。42/42 行的字段名都是一句 `t(...)`，
 *   从没有节点、没有副标题、没有提示图标。收成 string 才能保证各页的字段名
 *   长得一样；真需要富文本的那天再放宽，比反过来收容易。
 * - **值走 `children`**。值恒为单个元素，但常是「文本 + 状态标」这类就地拼的
 *   表达式，写成 children 比 `value=` 顺手（实测最多一个值配两个状态标）。
 * - **没有 `actionable` 变体**。遗留类名里有个 `--actionable`，13/42 行挂了它，
 *   但它与「这行到底有没有操作」并不对应——有操作的行没挂、挂了的行第三格
 *   放的是状态标。它是个被用歪的布局提示，这里直接由 `actions` 有无推导。
 * - **操作放在 `<dd>` 内而不是与它并列**：HTML 规定 `<dl>` 下那个包裹 div 只能
 *   装 dt 与 dd，并列第三个元素不合法。操作本就是「针对这个值的控件」，归到
 *   值这一格语义上也对。
 *
 * 分隔线挂在列表上（`[&>*+*]:border-t`）而不是行上：末行因此天然没有多余的
 * 下边框，不必让行自己判断是不是最后一个。线型走 060 语义——实线开区块、
 * 虚线分行，字段行之间界的是行，用虚线。
 *
 * 与邻件的分工：分组的标题与说明是 `Section`（h2 + p + 可选单个操作，正好是
 * 遗留 .vx-profile-group__header 的形状），值里的状态标是 `StatusBadge`
 * （遗留 .vx-profile-tag 的 base / --warning / --error 三档正好对上 tone），
 * 本件只管行本身。带交互控件的设置行（Switch / Select）不是本件——那是表单，
 * 归 `Field` 一族。
 *
 * 响应式：窄屏（<sm）字段名与值上下堆叠，宽屏并排且字段名列定宽
 * （`w-media-3xl` = 12rem），同一组内各行的值因此左对齐成一列。
 *
 * `columns`（2026-08-05 由 admin 详情页实据加入）：admin 六个详情页共 129 个字段，
 * 单页最多 28 个，既有容器是 `repeat(3, 1fr)` 的网格。单列排 28 行会拉出一条谁也
 * 读不完的长条——**多列是排布问题，不是语义问题**，`<dl>` 照旧，只是换个铺法。
 * 多列时行内改为名上值下（并排 + 12rem 定宽名列在三分之一宽的格子里放不下），
 * 行间虚线取消（网格里的横线会横穿相邻列，界不出行）。
 *
 * 列数走 context 而不是父级 arbitrary variant 覆盖：`sm:[&>*]:flex-col` 与
 * `DetailRow` 自己的 `sm:flex-row` 特异性相同，谁赢取决于 Tailwind 的输出顺序，
 * 那是碰运气。`DetailRow` 本就必须长在 `DetailList` 里（见上），context 是现成的。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

export type DetailListColumns = 1 | 2 | 3;

const BY_COLUMNS: Record<DetailListColumns, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
};

/** 列数由 DetailList 下传，DetailRow 据此选行内布局。 */
const ColumnsContext = React.createContext<DetailListColumns>(1);

export interface DetailListProps extends React.HTMLAttributes<HTMLDListElement> {
  readonly children: React.ReactNode;
  /**
   * 宽屏下铺几列。默认 1 = 单列竖排（名左值右、行间虚线），
   * 多列 = 网格（名上值下、无分隔线）。窄屏一律单列。
   */
  readonly columns?: DetailListColumns;
}

const DetailList = React.forwardRef<HTMLDListElement, DetailListProps>(
  function DetailList({ className, children, columns = 1, ...props }, ref) {
    const grid = columns > 1;
    return (
      <ColumnsContext.Provider value={columns}>
        <dl
          ref={ref}
          className={cn(
            grid
              ? cn("grid gap-x-xl gap-y-md", BY_COLUMNS[columns])
              : cn(
                  "flex flex-col",
                  "[&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10",
                  "dark:[&>*+*]:border-primary/20",
                ),
            className,
          )}
          {...props}
        >
          {children}
        </dl>
      </ColumnsContext.Provider>
    );
  },
);

export interface DetailRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** 字段名。收为 string——各页的字段名要长得一样，见文件头。 */
  readonly label: string;
  /** 字段值。常是「文本 + StatusBadge」这类就地拼的表达式。 */
  readonly children: React.ReactNode;
  /** 针对该字段的操作，通常是一到两个 `size="sm"` 的 Button。 */
  readonly actions?: React.ReactNode;
}

const DetailRow = React.forwardRef<HTMLDivElement, DetailRowProps>(
  function DetailRow({ className, label, children, actions, ...props }, ref) {
    // 多列时保持名上值下：并排 + 12rem 定宽的名列在三分之一宽的格子里放不下。
    const stacked = React.useContext(ColumnsContext) > 1;
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-2xs",
          stacked ? "py-0" : "py-sm sm:flex-row sm:items-center sm:gap-lg",
          className,
        )}
        {...props}
      >
        <dt
          className={cn(
            "text-label-md text-muted-foreground",
            !stacked && "sm:w-media-3xl sm:shrink-0",
          )}
        >
          {label}
        </dt>
        <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-md">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-xs text-body-md text-foreground">
            {children}
          </span>
          {actions ? (
            <span className="flex shrink-0 flex-wrap items-center gap-2xs">
              {actions}
            </span>
          ) : null}
        </dd>
      </div>
    );
  },
);

export { DetailList, DetailRow };
