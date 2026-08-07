/**
 * ViewModeSwitch.tsx - 列表 / 卡片 视图切换。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 只有两个目的地、图标固定、语义固定的开关。做成一件而不是让每个列表页自己
 * 摆一组 ToggleGroup，是因为"自己摆"要同时摆对四件事：图标选哪两个、用不用
 * 正方档、组的无障碍名、以及**空值处理**——Radix 的单选组允许取消选中，会回
 * 空串，而视图必须始终有一个。少写最后那一句，用户点两下当前项就会把列表切
 * 成"没有视图"。
 *
 * 质感取 header 三元图标组那套：常态无背景、hover 才上底、当前项用 accent
 * 标出。刻意**不**用 SegmentedControl（"槽 + 滑块"，常态就有一整条描边凹槽）
 * ——放在工具行左端会像一个填了色的控件块，比它右边的搜索框还重。
 *
 * 图标必须走 `icon-*` 正方档：只装图标的开关用带横向内距的档会被压成
 * "宽 28 高 20"的扁片（2026-08-04 实测）。
 *
 * 零业务语义：它不知道列表里装的是租户还是订单，只知道"两种排布"。
 */

import { Icon } from "../../../icons";
import { ToggleGroup, ToggleGroupItem } from "../../base/form/ToggleGroup";

export type ViewModeSwitchValue = "list" | "cards";

/* 选中态用品牌淡底而非实底：实底会压过同行的搜索框与主按钮（owner 2026-08-06）。 */
const ITEM = [
  "text-muted-foreground",
  "data-[state=on]:bg-primary-muted",
  "data-[state=on]:text-primary-muted-foreground",
  "data-[state=on]:hover:bg-primary-muted-hover",
].join(" ");

export interface ViewModeSwitchProps {
  readonly value: ViewModeSwitchValue;
  readonly onChange: (value: ViewModeSwitchValue) => void;
  /** 整组的无障碍名，例如"账单展示方式"。 */
  readonly ariaLabel?: string;
  /** 两个选项各自的无障碍名。默认中文，做 i18n 的消费方传入。 */
  readonly labels?: { list?: string; cards?: string };
  /**
   * 停用卡片档，并说明原因。
   *
   * 入口保留、但不假装它还会响应——**一个永远按不动又不说为什么的按钮，比没有
   * 这个按钮更糟**。原因会挂在 `title` 与 `aria-description` 上，鼠标停留和读屏
   * 器都拿得到（owner 2026-08-07 判：卡片视图退役，切换按钮保留禁用）。
   */
  readonly cardsDisabledReason?: string;
  readonly className?: string;
}

export function ViewModeSwitch({
  value,
  onChange,
  ariaLabel = "展示方式",
  labels,
  cardsDisabledReason,
  className,
}: ViewModeSwitchProps) {
  return (
    <ToggleGroup
      type="single"
      size="icon-md"
      aria-label={ariaLabel}
      value={value}
      // Radix 的单选组允许"取消选中"，会回空串；视图必须始终有一个，空值
      // 直接忽略而不是把 value 设成 undefined。
      onValueChange={(next) => {
        if (next) onChange(next as ViewModeSwitchValue);
      }}
      {...(className ? { className } : {})}
    >
      <ToggleGroupItem
        value="list"
        aria-label={labels?.list ?? "列表视图"}
        className={ITEM}
      >
        <Icon name="list" size="lg" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="cards"
        aria-label={labels?.cards ?? "卡片视图"}
        className={ITEM}
        {...(cardsDisabledReason
          ? {
              disabled: true,
              title: cardsDisabledReason,
              "aria-description": cardsDisabledReason,
            }
          : {})}
      >
        <Icon name="squares-four" size="lg" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
