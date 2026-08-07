/**
 * MetricListCard.tsx - 带卡内指标的列表卡（列表页"卡片视图"的一行）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 与 `ListCard` 的分工：`ListCard` 是"标题 + 描述 + 若干补充事实"，本件多出
 * **一排读数**——它承载的是同一实体的几个可比数字（订阅数 / 成员数 / 用量），
 * 需要等宽对齐才读得出来，塞进 `ListCard` 的 `meta` 里会退化成一串逗号分隔的
 * 文字，一眼看不出哪个是哪个。
 *
 * 没有做成 `ListCard` 的可选槽，是 owner 拍板（2026-08-05）：ListCard 的 props
 * 已经有六个，再挂两个只在半数场景出现的槽，会让"这张卡到底长什么样"必须逐个
 * prop 去推。两件各自形态固定，选哪件即决定长相。
 *
 * 结构照 admin 列表页既有的卡片语法提炼（`vx-tenant-directory-card` 一族，跨 4
 * 个业务域 17 处）：
 *   header  图标 · 标题/副标题 · 行操作
 *   badges  一排状态徽章（可选）
 *   note    整宽的一段说明（可选）
 *   metrics 等宽读数（2–4 列）
 *   footer  补充事实（可选）
 *
 * 零业务语义：它不知道读数是订阅还是用量，`tone` 也只是语气档而非业务状态——
 * 业务状态到语气的映射归产品侧（admin 的 pill 映射表）。
 */

import * as React from "react";
import { cardVeil } from "../../../styles/recipes";
import { cn } from "../../../utils/cn";
import { Icon, type IconName } from "../../../icons";
import type { StatusBadgeTone } from "../../base/display/StatusBadge";

export interface MetricListCardMetric {
  readonly key: string;
  /** 读数本身。给成品字符串——千分位、单位、精度都由调用方决定。 */
  readonly value: React.ReactNode;
  readonly label: React.ReactNode;
}

export interface MetricListCardProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: IconName;
  /** 行操作，通常是 ActionMenu；靠标题行右端。 */
  readonly actions?: React.ReactNode;
  /** 一排状态徽章。由调用方给成品 Badge——它们的语气来自业务状态，不归本件。 */
  readonly badges?: React.ReactNode;
  /**
   * 徽章与读数之间那段整宽说明。
   *
   * 与 `description` 分工：`description` 是标题的副标题（跟着标题截断成一行），
   * `note` 是卡片主体里独立的一段（订单卡的"业务方案 · 服务套餐"、账单卡的关联
   * 账单、方案卡的方案描述 + 一排能力标）。admin 十六个列表卡里九个有这一段，
   * 塞进 `description` 会让副标题变成两件事拼起来的长句。
   */
  readonly note?: React.ReactNode;
  /** 等宽读数。2–4 个之间；超过 4 个一行读不过来，该换成详情页。 */
  readonly metrics?: readonly MetricListCardMetric[];
  readonly footer?: React.ReactNode;
  /**
   * 顶缘色条的语气。**只染顶缘，不染底**：一屏十几张卡，染底会让整页变成色块，
   * 而顶缘一条既能分辨归属又不与卡内读数抢注意力。与 MetricCard 同一判断。
   */
  readonly tone?: StatusBadgeTone;
  /** 整卡可点时给。给了才有 hover 反馈与键盘可达性。 */
  readonly onClick?: () => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

/** 顶缘色条。tone 未给则不出色条（而不是画一条中性灰——那看起来像没渲染完）。 */
const TONE_ACCENT: Record<StatusBadgeTone, string> = {
  brand: "border-t-primary",
  success: "border-t-success",
  warning: "border-t-warning",
  danger: "border-t-destructive",
  info: "border-t-info",
  neutral: "border-t-border",
};

const MetricListCard = React.forwardRef<HTMLElement, MetricListCardProps>(
  function MetricListCard(
    {
      title,
      description,
      icon,
      actions,
      badges,
      note,
      metrics,
      footer,
      tone,
      onClick,
      className,
      style,
    },
    ref,
  ) {
    const interactive = Boolean(onClick);
    return (
      <article
        ref={ref}
        // 底纹与其余卡片同一份配方，见 recipes 的 cardVeil。
        style={{ ...cardVeil("soft"), ...style }}
        className={cn(
          "flex min-w-0 flex-col gap-sm rounded-lg p-md",
          "border border-border",
          // 顶缘加粗承载语气色；未给 tone 时与其余三边同宽，看不出差别。
          tone ? cn("border-t-2", TONE_ACCENT[tone]) : null,
          interactive &&
            "cursor-pointer transition-colors duration-fast hover:bg-accent",
          className,
        )}
        {...(interactive
          ? {
              role: "button",
              tabIndex: 0,
              onClick,
              // 整卡可点必须键盘可达——Enter 与 Space 都要响应，只接 Enter 的
              // 「按钮」在读屏用户那里是半个按钮。
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick?.();
              },
            }
          : {})}
      >
        <header className="flex min-w-0 items-start gap-sm">
          {icon ? (
            <Icon
              name={icon}
              size="lg"
              fallback="placeholder"
              className="shrink-0 text-muted-foreground"
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <span className="truncate text-label-lg text-foreground">
              {title}
            </span>
            {description ? (
              <span className="truncate text-body-sm text-muted-foreground">
                {description}
              </span>
            ) : null}
          </div>
          {/* 操作区不冒泡到整卡点击——点"更多"是要开菜单，不是进详情。 */}
          {actions ? (
            <div
              className="shrink-0"
              onClick={(event) => event.stopPropagation()}
            >
              {actions}
            </div>
          ) : null}
        </header>

        {badges ? (
          <div className="flex flex-wrap items-center gap-2xs">{badges}</div>
        ) : null}

        {note ? (
          <div className="min-w-0 text-body-sm text-muted-foreground">
            {note}
          </div>
        ) : null}

        {metrics && metrics.length > 0 ? (
          <div
            className="grid gap-sm"
            // 等宽列数跟着读数个数走：写死 3 列时给 2 个读数会留一个空格子，
            // 看起来像少渲染了一项。
            style={{
              gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
            }}
          >
            {metrics.map((m) => (
              <span key={m.key} className="flex min-w-0 flex-col gap-none">
                <b className="truncate text-title-sm font-semibold text-foreground tabular-nums">
                  {m.value}
                </b>
                <small className="truncate text-body-sm text-muted-foreground">
                  {m.label}
                </small>
              </span>
            ))}
          </div>
        ) : null}

        {footer ? (
          <footer className="flex min-w-0 items-center justify-between gap-sm text-body-sm text-muted-foreground">
            {footer}
          </footer>
        ) : null}
      </article>
    );
  },
);

MetricListCard.displayName = "MetricListCard";

export { MetricListCard };
