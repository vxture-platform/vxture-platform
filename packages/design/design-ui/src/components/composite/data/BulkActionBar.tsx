/**
 * BulkActionBar.tsx - 列表多选后出现的批量操作条。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 数据驱动：调用方给 `count` 与 `actions`，不给 markup。计数文案、清除入口、危险
 * 动作配色由本件固定，各处不会长得不一样。`count` 为 0 时返回 null——它只在有选中
 * 项时存在。
 *
 * 相对原实现：删 `primaryActions`（无选中时也显示的动作属于 `FilterBar`，两件各管
 * 一段）、`selectionClassName` / `primaryClassName`；`selectedLabel` 由调用方拼
 * 文案改为 `count` + `noun`。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon, type IconName } from "../../../icons";
import { Button } from "../../base/form/Button";

export interface BulkActionBarItem {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** 危险动作，用 destructive 语义色。 */
  readonly danger?: boolean;
  readonly onSelect?: () => void;
}

export interface BulkActionBarProps {
  readonly count: number;
  readonly actions: readonly BulkActionBarItem[];
  /** 计数单位，默认"项"。 */
  readonly noun?: string;
  readonly onClear?: () => void;
  readonly className?: string;
}

function BulkActionBar({
  count,
  actions,
  noun = "项",
  onClear,
  className,
}: BulkActionBarProps) {
  if (count <= 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="批量操作"
      className={cn(
        "flex flex-wrap items-center justify-between gap-md",
        "rounded-xl bg-card px-lg py-sm shadow-raised ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-sm">
        <span className="text-label-md">
          已选择 {count} {noun}
        </span>
        {onClear ? (
          <Button variant="ghost" size="md" onClick={onClear}>
            清除
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-sm">
        {actions.map((action) => (
          <Button
            key={action.id}
            size="md"
            variant={action.danger ? "destructive" : "outline"}
            {...(action.disabled !== undefined
              ? { disabled: action.disabled }
              : {})}
            {...(action.onSelect !== undefined
              ? { onClick: action.onSelect }
              : {})}
          >
            {action.icon ? (
              <Icon name={action.icon} size={16} aria-hidden="true" />
            ) : null}
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export { BulkActionBar };
