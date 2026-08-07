/**
 * ShellBootScreen.tsx - 会话未定时的整屏加载页。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * 用在"还不知道你是谁"的那段时间：门户挂载后要先问一次会话，答案回来之前
 * 既不能画已登录的外壳，也不能画登录页。
 *
 * **为什么不是骨架屏。** 骨架屏的前提是「这块内容一定会出现，只是还没到」——
 * 它承诺的是布局。而会话未定时这个前提不成立：答案可能是"未登录"，接下来
 * 整页会被换成登录跳转。此时画一屏 header + 侧栏 + 卡片的骨架，等于先许诺
 * 一个不会兑现的界面，然后当着用户的面撤掉。未登录冷启动要连着落回门户两次，
 * 于是同一屏骨架闪两遍——这就是"要闪好几次才进登录页"里肉眼看到的那部分
 * （2026-08-04 实测，admin 冷启动 9 跳 3 次绘制）。
 *
 * 所以这里刻意**只画一个居中的品牌 + 转圈**：它不承诺任何布局，被替换掉时
 * 没有落差感。
 *
 * 延迟出现（`delayMs`）是配套的：会话通常几十毫秒就回来了，立刻画转圈反而
 * 制造了一次本来不存在的闪烁。等过了这个门槛还没结果，才说明真的需要一个
 * "在加载"的交代。
 */

import { useEffect, useState } from "react";
import { Spinner, cn } from "@vxture/design-ui";

export interface ShellBootScreenProps {
  /** 品牌名；不传则只有转圈。 */
  label?: string | undefined;
  /** 转圈下方的一行说明，例如"正在确认登录状态"。 */
  description?: string | undefined;
  /**
   * 延迟多久才显示，默认 250ms。会话在这之前就返回的话，用户全程看不到本屏，
   * 也就不会有"闪一下"的观感。
   */
  delayMs?: number | undefined;
  className?: string | undefined;
}

export function ShellBootScreen({
  label,
  description,
  delayMs = 250,
  className,
}: ShellBootScreenProps) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return (
    <div
      // 无论可见与否都占满视口：**底色必须立刻铺上**，否则在转圈出现之前
      // 会露出浏览器的默认白底，暗色模式下就是一记白闪。
      className={cn(
        "flex min-h-screen w-full flex-col items-center justify-center gap-md",
        "bg-background text-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {visible ? (
        <>
          <Spinner size="lg" />
          {label ? (
            <span className="text-title-sm text-foreground">{label}</span>
          ) : null}
          {description ? (
            <span className="text-body-sm text-muted-foreground">
              {description}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
