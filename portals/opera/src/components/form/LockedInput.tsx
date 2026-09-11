"use client";

/**
 * LockedInput.tsx — 锁定字段的输入框（框内常驻锁图标）。
 * @package @vxture/opera
 * @layer Presentation
 * @category Components - Form
 *
 * owner 2026-09-11:「对锁定信息条目添加锁 icon（在输入框内，类似密码输入 icon，
 * 浅色常驻），同时标记必填信息条目」。
 *
 * ── 为什么要这个件 ──
 * 「登记后不可改」的字段此前只靠 `disabled` 表达——灰掉了，但**看不出是「不能改」
 * 还是「还没轮到你改」**。前者是规则，后者是状态，两种都灰，运营者读不出区别。
 * 框内一枚常驻的锁把规则说出来。
 *
 * ── 为什么用 InputGroup 而不是绝对定位一个图标 ──
 * `InputGroup` 是 DS 的标准件（console 成员页已在用）：它负责把图标与输入框拼成
 * 一个可聚焦整体、留出内边距、聚焦环包住两者。手写 `absolute` 会压住输入文字的
 * 末尾，且聚焦环只圈住输入框、把图标漏在外面。
 *
 * ── 图标放 end 不放 start ──
 * 与密码框的「显示/隐藏」同侧。start 侧在本系统里是「这一栏是什么」的语义位
 * （搜索框的放大镜），锁表达的是状态不是语义。
 */

import {
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@vxture/design-system";
import type { ComponentProps } from "react";

export interface LockedInputProps extends Omit<
  ComponentProps<typeof InputGroupInput>,
  "disabled" | "readOnly"
> {
  /**
   * 锁上时：`disabled` + 框内锁图标。
   * 为 false 时退化成一个普通输入框（不渲染图标），这样调用方可以按「新建 / 编辑」
   * 切换而不必换组件——`{editing ? <LockedInput/> : <Input/>}` 那种写法会让两支的
   * 属性各漂各的。
   */
  readonly locked: boolean;
  /** 锁图标的无障碍标签。默认「此项登记后不可修改」。 */
  readonly lockLabel?: string;
}

export function LockedInput({
  locked,
  lockLabel = "此项登记后不可修改",
  ...props
}: LockedInputProps) {
  return (
    <InputGroup>
      <InputGroupInput {...props} disabled={locked} />
      {locked ? (
        <InputGroupAddon align="end">
          {/* 浅色常驻：它是背景信息，不该和输入的内容抢注意力。
              `title` 与 `aria-label` 都给——鼠标悬停要看得到，读屏也要读得到。 */}
          <Icon
            name="lock"
            size="sm"
            className="text-muted-foreground/60"
            aria-label={lockLabel}
          />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
