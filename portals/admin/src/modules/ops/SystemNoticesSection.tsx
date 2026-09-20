"use client";

/**
 * SystemNoticesSection — 运营通告的读侧。
 *
 * 发布面在 opera（owner 2026-09-20：「面向内部运营的由 opera 发布」），admin 只读。
 *
 * 两个档共用本件，差别只有「列多少」与「有没有那个去处按钮」：
 *   digest（待办页 S2）  owner 定的规则：**当天已读 + 所有未读**
 *   all   （/messages）  全部，带翻页
 *
 * ── 为什么「当天已读」也要显示 ──
 * 只列未读的话，刚点过「知道了」的那条会当场消失，运营者会以为自己点错了。留到
 * 当天结束是个温和的过渡：今天看过的还在，明天自然清场。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  Button,
  EmptyState,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import { fetchOperatorNotices, markOperatorNoticeRead } from "@/api/admin-bff";
import type { OperatorNoticeItem } from "@/api/admin-bff";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { PageSize } from "@/modules/shared/PageSizePicker";
import { formatNumber } from "@/modules/tenants/tenant-utils";
import { formatDay, formatClock } from "@vxture-platform/shared";

const SEVERITY_LABEL: Record<OperatorNoticeItem["severity"], string> = {
  info: "一般",
  warning: "重要",
  critical: "紧急",
};

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `info` 走中性而不是绿——`success` 的语义是**达成了一件事**，而「一般」不是。
 * 与 opera 发布页、维护窗口页同一取舍。
 */
function severityTone(
  severity: OperatorNoticeItem["severity"],
): StatusBadgeTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

export function SystemNoticesSection({
  scope = "digest",
}: {
  readonly scope?: "digest" | "all";
}) {
  const locale = useLocale();
  const router = useRouter();
  const isAll = scope === "all";

  const [items, setItems] = useState<OperatorNoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchOperatorNotices({
        scope,
        limit: isAll ? pageSize : 10,
        offset: isAll ? (page - 1) * pageSize : 0,
      });
      setItems(result.items);
      setTotal(result.total);
      setUnread(result.unread);
    } catch (cause) {
      setItems([]);
      setTotal(0);
      setUnread(0);
      // 读失败要显影，不能画成「没有消息」——那是两件事。
      setLoadError(cause instanceof Error ? cause.message : "消息读取失败");
    } finally {
      setLoading(false);
    }
  }, [scope, isAll, page, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const markRead = async (notice: OperatorNoticeItem) => {
    // 先本地置已读再发请求：这一步没有失败代价（重标幂等），等一圈往返
    // 才变灰会让人以为没点上。失败时下次 reload 自会纠正。
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Section
      title={isAll ? "全部消息" : "系统消息"}
      icon="bell"
      level={2}
      description={
        isAll
          ? `来自 opera 与产品侧的平台通知，共 ${formatNumber(total)} 条。`
          : `来自 opera 与产品侧的平台通知：产品上线、能力新增、变更通告。${
              unread > 0 ? `${formatNumber(unread)} 条未读。` : "没有未读。"
            }`
      }
      action={
        isAll ? (
          <ActionButton
            variant="outline"
            icon="arrow-left"
            onClick={() => router.push("/ops-todos")}
          >
            回到待办
          </ActionButton>
        ) : (
          <ActionButton
            variant="outline"
            icon="arrow-right"
            onClick={() => router.push("/messages")}
          >
            查看全部
          </ActionButton>
        )
      }
    >
      {loading ? (
        <EmptyState icon="bell" title="正在读取消息" description="稍候。" />
      ) : loadError ? (
        <EmptyState
          icon="bell"
          title="消息读取失败"
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
          title={isAll ? "还没有消息" : "没有要看的消息"}
          description={
            isAll
              ? "opera 发布的产品上线、能力新增与变更通告会出现在这里。"
              : "未读的消息与今天读过的都会列在这里；更早的到「全部消息」里查。"
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
                    {formatDay(notice.publishedAt, locale)}{" "}
                    {formatClock(notice.publishedAt, locale)} ·{" "}
                    {/* system 来源没有人，写「系统」而不是「—」——后者会被当成读不到。 */}
                    {notice.source === "system"
                      ? "系统"
                      : (notice.createdByName ?? "—")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-xs">
                  {notice.link ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(notice.link as string)}
                    >
                      去看看
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

      {isAll && !loading && !loadError && total > 0 ? (
        <ListPagination
          currentPage={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
          onPageChange={setPage}
        />
      ) : null}
    </Section>
  );
}
