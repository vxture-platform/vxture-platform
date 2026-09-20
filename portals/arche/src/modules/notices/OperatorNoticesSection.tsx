"use client";

/**
 * OperatorNoticesSection — 运营通告的读侧（治理平面）。
 *
 * 发布面在 opera（owner 2026-09-20：「面向内部运营的由 opera 发布」），arche 与
 * admin 一样只读。可见性谓词在 `@vxture/service-notice`，三个平面共用一份。
 *
 * ── 为什么是首页一块，不是一个二级页 ──
 * admin 那边通告有 `/messages` 二级页，因为 admin 的运营者天天面对一屏消息。
 * arche 是治理平面：人少、通告量小，而给它一个独立页面要在权限树里新注册一个
 * `arche.menu.*` 页面码——那要动 seed 与迁移，而三平面 cutover（#121）留下的
 * 规矩是 seed 不动。
 *
 * 所以两档做成**同一块里的切换**而不是两条路由：摘要档与全部档共用这一件，按钮
 * 在两者之间翻。功能不缺，权限树不动。真到了要独立页面那天，加码再拆。
 *
 * ── 摘要档为什么留着当天已读 ──
 * owner 那条规则：**当天已读 + 所有未读**。只列未读的话，刚点过「知道了」的那条
 * 会当场消失，人会以为自己点错了。留到当天结束是个温和的过渡。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  ActionButton,
  Button,
  EmptyState,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import {
  fetchOperatorNotices,
  markOperatorNoticeRead,
  type OperatorNoticeItem,
} from "@/api/arche-bff";
import { formatDateTime, formatNumber } from "@/lib/format";

const SEVERITY_LABEL: Record<OperatorNoticeItem["severity"], string> = {
  info: "一般",
  warning: "重要",
  critical: "紧急",
};

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `info` 走中性而不是绿——`success` 的语义是**达成了一件事**，而「一般」不是。
 * 与 opera 发布页、admin 读侧同一取舍。
 */
function severityTone(
  severity: OperatorNoticeItem["severity"],
): StatusBadgeTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

/**
 * 全部档一次取多少。
 *
 * 不做分页：治理平面的通告是「产品上线、能力新增」这类低频事件，50 条已经覆盖
 * 很长一段时间。真撑满了再加翻页——现在加，等于为一个还没出现的规模写代码。
 */
const ALL_LIMIT = 50;

export function OperatorNoticesSection() {
  const locale = useLocale();
  const [scope, setScope] = useState<"digest" | "all">("digest");
  const [items, setItems] = useState<OperatorNoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchOperatorNotices({
        scope,
        limit: scope === "all" ? ALL_LIMIT : 10,
      });
      setItems(result.items);
      setTotal(result.total);
      setUnread(result.unread);
    } catch (cause) {
      setItems([]);
      setTotal(0);
      setUnread(0);
      // 读失败要显影，不能画成「没有消息」——那是两件事，后者还是个令人安心的
      // 回答，把前者画成它等于报一个假的平安。
      setLoadError(cause instanceof Error ? cause.message : "消息读取失败");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const markRead = async (notice: OperatorNoticeItem) => {
    // 先本地置已读再发请求：这一步没有失败代价（重标幂等），等一圈往返才变灰
    // 会让人以为没点上。失败时下次 reload 自会纠正。
    setItems((prev) =>
      prev.map((item) =>
        item.id === notice.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnread((prev) => Math.max(0, prev - 1));
    try {
      await markOperatorNoticeRead(notice.id);
    } catch {
      await reload();
    }
  };

  const isAll = scope === "all";

  return (
    <Section
      level={2}
      icon="bell"
      title={isAll ? "全部通告" : "运营通告"}
      description={
        isAll
          ? `来自 opera 的平台通知，共 ${formatNumber(total)} 条。`
          : `来自 opera 的平台通知：产品上线、能力新增、变更通告。${
              unread > 0 ? `${formatNumber(unread)} 条未读。` : "没有未读。"
            }`
      }
      action={
        <ActionButton
          variant="outline"
          icon={isAll ? "arrow-left" : "arrow-right"}
          onClick={() => setScope(isAll ? "digest" : "all")}
        >
          {isAll ? "只看近期" : "查看全部"}
        </ActionButton>
      }
    >
      {loading ? (
        <EmptyState icon="bell" title="正在读取通告" description="稍候。" />
      ) : loadError ? (
        <EmptyState
          icon="bell"
          title="通告读取失败"
          description={loadError}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              重试
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          title={isAll ? "还没有通告" : "没有要看的通告"}
          description={
            isAll
              ? "opera 发布的产品上线、能力新增与变更通告会出现在这里。"
              : "未读的与今天读过的都会列在这里；更早的到「查看全部」里找。"
          }
        />
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((notice) => {
            const isUnread = notice.readAt === null;
            return (
              <li
                key={notice.id}
                className="flex items-start gap-md rounded-md border p-md"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <span className="flex flex-wrap items-center gap-xs">
                    <StatusBadge tone={severityTone(notice.severity)}>
                      {SEVERITY_LABEL[notice.severity]}
                    </StatusBadge>
                    {/* 未读用一个明确的字，不靠加粗——加粗在一屏都是新消息时
                        反而看不出哪条是新的。 */}
                    {isUnread ? (
                      <StatusBadge tone="info">未读</StatusBadge>
                    ) : null}
                    <span className="font-medium">{notice.title}</span>
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {notice.body}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {formatDateTime(notice.publishedAt, locale)} ·{" "}
                    {/* system 来源没有人，写「系统」而不是「—」——后者会被当成读不到。 */}
                    {notice.source === "system"
                      ? "系统"
                      : (notice.createdByName ?? "—")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-xs">
                  {notice.link ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={notice.link}>去看看</a>
                    </Button>
                  ) : null}
                  {isUnread ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void markRead(notice)}
                    >
                      知道了
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
