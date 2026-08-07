/**
 * ActionMenu.tsx - 行操作菜单（表格行尾的"⋮"）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 数据驱动：调用方给 `items`，不给 markup。触发器形态、危险项配色、分隔位置都由
 * 本件固定，各处不会长得不一样。
 *
 * 相对原实现：`icon` 从 `ReactNode` 收为 `IconName`——传 node 等于把图标尺寸和
 * 颜色的决定权交回调用方，行内菜单最容易在这里长歪；删 `triggerClassName` /
 * `contentClassName` / `triggerProps` 三个逃生口。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon, type IconName } from "../../../icons";
import { Button } from "../../base/form/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../base/overlay/DropdownMenu";

export interface ActionMenuItem {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /**
   * 悬停说明，落到原生 `title`。主要用途是**讲清楚这一项为什么灰着**——
   * 禁用项不说理由，用户只能猜，而这一层信息在菜单里没有别的地方可放。
   */
  readonly hint?: string | undefined;
  /** 危险动作，用 destructive 语义色。 */
  readonly danger?: boolean;
  /** 在本项之前插一条分隔线，用于把危险动作与常规动作分开。 */
  readonly separatorBefore?: boolean;
  readonly onSelect?: () => void;
}

export interface ActionMenuProps {
  readonly items: readonly ActionMenuItem[];
  readonly label?: string;
  readonly align?: "start" | "center" | "end";
  /**
   * 整个菜单不可用（提交进行中、无权操作）。这跟"逐项 disabled"不是一回事：
   * 逐项禁用仍然可以打开菜单看见有哪些动作，整体禁用连打开都不给。前者用于
   * "这一项现在做不了"，后者用于"现在什么都别做"。
   */
  readonly disabled?: boolean;
}

function ActionMenu({
  items,
  label = "打开操作菜单",
  align = "end",
  disabled = false,
}: ActionMenuProps) {
  /**
   * 关闭时残留焦点环的修法：Radix 关菜单会把焦点还给触发器（无障碍要求，
   * 不能删）——但鼠标点击触发器把它关掉时，浏览器仍会判它为"需要显示焦点环"
   * 的一次 focus，环就一直挂在按钮外面，直到用户点别处失焦（2026-08-03
   * owner 实测抓到：鼠标点开、鼠标点别处关掉不会这样，只有点同一个按钮
   * 关掉才会）。键盘用户合上菜单后确实需要看见焦点在哪，不能全局关掉这次
   * 焦点找回；只在"这次开关是鼠标发起的"时跳过它，键盘发起的仍走默认。
   */
  const lastInputRef = React.useRef<"pointer" | "keyboard">("pointer");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label={label}
          disabled={disabled}
          onPointerDown={() => {
            lastInputRef.current = "pointer";
          }}
          onKeyDown={() => {
            lastInputRef.current = "keyboard";
          }}
        >
          <Icon name="more-vertical" size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        onKeyDown={() => {
          lastInputRef.current = "keyboard";
        }}
        onCloseAutoFocus={(event) => {
          if (lastInputRef.current === "pointer") event.preventDefault();
        }}
      >
        {items.map((item) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              {...(item.disabled !== undefined
                ? { disabled: item.disabled }
                : {})}
              {...(item.onSelect !== undefined
                ? { onSelect: item.onSelect }
                : {})}
              {...(item.hint !== undefined ? { title: item.hint } : {})}
              className={cn(
                "gap-xs",
                // 悬停时给一层淡底而不是把整条变实心红——菜单里危险项常和常规项
                // 挨着，实心底会让整个菜单看起来在报警。与 Button / Badge 同一判断。
                item.danger &&
                  "text-destructive-text focus:bg-destructive-muted focus:text-destructive-muted-foreground",
              )}
            >
              {item.icon ? (
                <Icon name={item.icon} size={16} aria-hidden="true" />
              ) : null}
              <span className="min-w-0 truncate">{item.label}</span>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ActionMenu };
