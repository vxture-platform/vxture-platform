"use client";

/**
 * NoticeBell — 外壳头部的通告角标。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 2026-08-30 这个位置刻意留空，注释写着「opera 没有任何通知源（无告警表、无订阅、
 * 无推送），一个点了什么都不发生的铃铛只会让人以为告警会到这里来。有通知源的那天
 * 再加」。2026-09-28 前三批把通知源做出来了：维护窗口逾期、产品生命周期、作业心跳、
 * webhook 死信都会往 `admin.operator_notices` 写投放到本平面的系统通告。所以按那条
 * 注释自己定下的条件，这一天到了。
 *
 * 形态与 admin 的铃铛同构（同一个 `ShellIconButton` + 同一套角标类名），但点开的不是
 * 抽屉而是 `/ops/notices`：opera 的那一页本来就是通告的落点（发布面 + 收件面都在那儿），
 * 再做一个抽屉等于同一份内容两处维护，而其中一处永远落后。
 *
 * ── 数从哪来 ──
 * `/api/operator-notices/inbox` 的 `unread`，也就是 `@vxture/service-notice` 算的那一份。
 * 页面上的「全部标记已读」清掉的是同一个集合——两处各算一份的话，按完角标不归零，而
 * 没人能从界面上看出剩下那几条凭什么还在。
 *
 * ── 不显示的三种情形 ──
 *   · 会话没就绪：还没有「谁」，未读数无从谈起。
 *   · 没有 `ops:notice.*` 能力：接口对他恒 403，角标恒 0。一个永远不会亮的铃铛是个
 *     死控件，不摆。
 *   · 读失败：**不画角标**，但铃铛留着（还能点进去看那一页的错误说明）。拿不到数就
 *     不报数——画 0 会被读成「没有未读」。
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShellIconButton } from "@vxture/design-system";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { subscribeNoticesChanged } from "@/lib/notice-unread";
import { useOperatorSession } from "@/features/session/SessionProvider";

/** 与 BFF 能力门同名的两个码：能读或能发的人都看得见角标。 */
const READ = "ops:notice.read";
const MANAGE = "ops:notice.manage";

/** 一分钟一次，与 admin 的铃铛同频。手动动作走订阅点，不靠这个钟。 */
const POLL_MS = 60_000;

/** 只要 `unread`，所以只拉一条：limit=1 已经够，`unread` 不随分页变。 */
const UNREAD_PATH = "/api/operator-notices/inbox?unread=true&limit=1";

export function NoticeBell() {
  const t = useTranslations("noticeBell");
  const router = useRouter();
  const { status, can } = useOperatorSession();
  const entitled = can(READ) || can(MANAGE);

  /** null = 还没拿到（或拿不到）。与 0 分开：0 是「没有未读」，null 是「不知道」。 */
  const [unread, setUnread] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ unread: number }>(UNREAD_PATH);
      setUnread(result.unread);
    } catch {
      // 读失败就退回「不知道」：上一次的数字留在屏幕上会一直说一个已经不成立的事。
      setUnread(null);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready" || !entitled) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, entitled, load]);

  // 页面上标记已读之后当场重取——那一下的效果只有这个角标看得见。
  useEffect(() => {
    if (status !== "ready" || !entitled) return;
    return subscribeNoticesChanged(() => void load());
  }, [status, entitled, load]);

  if (status !== "ready" || !entitled) return null;

  const count = unread ?? 0;
  return (
    <span className="relative inline-flex">
      <ShellIconButton
        icon="bell"
        label={count > 0 ? t("labelWithCount", { count }) : t("label")}
        onClick={() => router.push("/ops/notices")}
      />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-2xs -top-2xs inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-2xs text-label-sm leading-4 text-danger-foreground tabular-nums"
        >
          {/* 三位数以上收成 99+：角标再宽就会盖住旁边那个按钮。读屏念的是
              label 里的真数，不是这里。 */}
          {count > 99 ? t("overflow") : count}
        </span>
      ) : null}
    </span>
  );
}
