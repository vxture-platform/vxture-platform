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
 *
 * ── 第三态：锁着，但能解开 ──
 * owner 2026-09-11:「给所有锁定条目，增加修改按钮激活修改，防止误操作。」
 *
 * 有些字段**规则上可改、实际上不该随手改**——产品码在草稿态就是这样。做成普通
 * 输入框，光标一落就能改掉一个决定了域名、容器前缀与库名的值，而页面上十几个框
 * 长得都一样；做成纯锁定又等于不给改。
 *
 * 所以锁仍然是默认态，旁边给一个「修改」。**多这一下不是形式**：它把「我正要改
 * 这一栏」变成一个明确动作，误触改不动它。
 */

import {
  Button,
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
  /**
   * 给了就把常驻锁换成一枚「修改」——这一栏是**锁着但能解开**的。
   *
   * 解不解锁由调用方持有：本件不自己记状态，否则同一个字段的锁态会有两个来源
   * （调用方的 `locked` 与件内部的）而它们迟早对不上。
   *
   * **不给就是彻底锁死**——按钮根本不渲染。owner 2026-09-11:「在已发布产品，该
   * 按钮隐藏，直接锁定无法修改。」渲染一个按下去会被拒的按钮，等于把规则写成
   * 一次失败的尝试。
   */
  readonly onUnlock?: () => void;
  /** 解锁按钮上的字。默认「修改」。 */
  readonly unlockLabel?: string;
}

export function LockedInput({
  locked,
  lockLabel = "此项登记后不可修改",
  onUnlock,
  unlockLabel = "修改",
  ...props
}: LockedInputProps) {
  return (
    <InputGroup>
      <InputGroupInput {...props} disabled={locked} />
      {locked ? (
        <InputGroupAddon align="end">
          {onUnlock ? (
            /* `type="button"`：这件常常长在 `<form>` 里，不写就是 submit，
               点「修改」会把整张表单提交掉。 */
            <Button type="button" variant="ghost" size="sm" onClick={onUnlock}>
              <Icon name="edit" size="sm" aria-hidden="true" />
              {unlockLabel}
            </Button>
          ) : (
            /* 浅色常驻：它是背景信息，不该和输入的内容抢注意力。
               `title` 与 `aria-label` 都给——鼠标悬停要看得到，读屏也要读得到。 */
            <Icon
              name="lock"
              size="sm"
              className="text-muted-foreground/60"
              aria-label={lockLabel}
            />
          )}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
