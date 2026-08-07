/**
 * ActionButton.tsx - 图标 + 文字的操作按钮。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 只做一件事：把"前置图标 + 文字"这个组合固定下来。它不是 Button 的替代，是
 * Button 的一种**排布**——变体、尺寸、禁用、无障碍全部透传给 Button，本件不
 * 拥有任何自己的取值。
 *
 * 为什么值得成件而不是让调用方自己写 `<Button><Icon/>文字</Button>`：
 * 那样写有四个可以各自跑偏的地方——图标尺寸、fallback、图标在文字前还是后、
 * 收紧内边距用的 `data-icon` 标记。少写一个 `data-icon="inline-start"`，按钮
 * 左右内边距就不对称，且这个偏差小到评审时看不出来（`iconInset` 靠它生效）。
 * 一屏十几个这样的按钮，只要有两处漏了就能看出参差。固定成一件之后，这四项
 * 不再是调用方的选择。
 *
 * 与既有的 `ActionMenu` 分工：本件是**一个**动作的直接入口，`ActionMenu` 是
 * 一组动作收进菜单。两者都不认识业务，动作是什么由调用方给。
 *
 * ⚠ 图标尺寸刻意不开放：Button 基类的 `inlineIcon` 会让未标尺寸的 svg 跟随
 * 控件档（icon-sm）。给一个 `iconSize` 口子等于把"图标随控件走"这条规则变回
 * 可选项——本件存在的理由正是让它不可选。真需要另一个尺寸的，那就是别的东西，
 * 直接用 Button 组合。
 */

import * as React from "react";
import { Icon } from "../../../../icons";
import type { IconName } from "../../../../icons";
import { Button } from "./Button";
import type { ButtonProps } from "./Button";

export interface ActionButtonProps extends Omit<ButtonProps, "children"> {
  /** 按钮文字。图标不带文字的场景用 Button 的 `icon-*` 档，不用本件。 */
  readonly children: React.ReactNode;
  readonly icon: IconName;
  /** 图标名在注册表里查不到时的替身，默认 `placeholder`（不留空洞）。 */
  readonly iconFallback?: IconName;
}

const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    { children, icon, iconFallback = "placeholder", ...props },
    ref,
  ) {
    return (
      <Button ref={ref} {...props}>
        <Icon
          name={icon}
          fallback={iconFallback}
          // Button 的 `iconInset` 靠这个标记收紧图标那一侧的内边距。
          data-icon="inline-start"
        />
        <span>{children}</span>
      </Button>
    );
  },
);

ActionButton.displayName = "ActionButton";

export { ActionButton };
