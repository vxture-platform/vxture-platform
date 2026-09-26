/**
 * hubCards.logic.ts - 订阅总览卡「给不给这个入口」的判据
 * @package @vxture/console
 * @layer Presentation
 * @category Logic
 *
 * 从 `hubCards.tsx` 抽出来的三个布尔。抽的理由不是复用（只有一个调用方），是**可测**：
 * 这三条判据各自都会错而且不报错，而渲染整张卡再去数按钮，测的是布局不是判据。
 *
 * 冻结中（2026-09-26 走查补）三个入口都关：
 *   · 升级 / 续费 —— 会走到下单，而下单端有守卫、库里有唯一索引兜底。客户只是多走一步
 *     再吃闭门羹，控件不该把人带到死路。
 *   · 自动续费开关 —— 更隐蔽：客户在暂停期间打开它，恢复时平台会用 `auto_renew_before`
 *     把它**悄悄改回**暂停前的值。让人按一个注定被覆盖的开关，比不给还糟。
 * 退订不在这里关：客户随时有权离开，退订也不会造出第二条订阅。
 */

export interface HubCardEntryInput {
  status: string;
  tier: string | null;
  /** null = 永久订阅，没有周期可续。 */
  endAt: string | null;
  nearExpiry: boolean;
}

export interface HubCardEntries {
  showUpgrade: boolean;
  showRenew: boolean;
  renewToggleable: boolean;
}

export function hubCardEntries(input: HubCardEntryInput): HubCardEntries {
  const expired = input.status === "expired";
  const suspended = input.status === "suspended";
  return {
    showUpgrade:
      !expired &&
      !suspended &&
      (input.tier === "free" || input.tier === "starter"),
    showRenew: !suspended && (expired || input.nearExpiry),
    /* 续费开关适用面：有界周期、未终态、未冻结。free 档与普通订阅一样按周期到期、可开
       可关（owner 2026-09-03 决策 5）。 */
    renewToggleable: !expired && !suspended && input.endAt !== null,
  };
}
