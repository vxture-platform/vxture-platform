"use client";

/* 站内消息收件箱（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）。
 * 数据 = console-bff /api/me/inbox（收件人视角）；点开一条 = 标已读 + 去它带的链接。
 * 邮件 / 站内偏好在 /notifications（通知提醒），这里只看消息。 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Banner,
  Button,
  FormPageTemplate,
  Icon,
  StatusBadge,
  ViewHeader,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { useRouter } from "@/lib/i18n/navigation";
import {
  fetchInbox,
  markInboxAllRead,
  markInboxRead,
  type InboxMessage,
} from "@/api/console-bff";
import { formatInboxTime } from "@/lib/inbox-format";

const PAGE_SIZE = 20;

export function InboxPage() {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<InboxMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchInbox({ limit: PAGE_SIZE, before });
        setItems((cur) => (before ? [...cur, ...page.items] : page.items));
        setNextBefore(page.nextBefore);
        setUnreadCount(page.unreadCount);
      } catch {
        setError(t("loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  async function open(message: InboxMessage) {
    if (message.readAt === null) {
      try {
        await markInboxRead(message.id);
        setItems((cur) =>
          cur.map((m) =>
            m.id === message.id
              ? { ...m, readAt: new Date().toISOString() }
              : m,
          ),
        );
        setUnreadCount((n) => Math.max(0, n - 1));
      } catch {
        /* 标已读失败不拦跳转 */
      }
    }
    if (message.link) router.push(message.link);
  }

  async function markAll() {
    try {
      await markInboxAllRead();
      const now = new Date().toISOString();
      setItems((cur) => cur.map((m) => ({ ...m, readAt: m.readAt ?? now })));
      setUnreadCount(0);
    } catch {
      setError(t("loadError"));
    }
  }

  return (
    <FormPageTemplate
      header={
        <div className="flex flex-col gap-md">
          <ViewHeader
            icon="bell"
            title={t("header.title")}
            description={t("header.description")}
          />
          {error !== null ? <Banner tone="danger" title={error} /> : null}
        </div>
      }
      footer={
        <Button
          size="md"
          variant="outline"
          disabled={loading || unreadCount === 0}
          onClick={() => void markAll()}
        >
          <Icon name="check" size="xs" fallback="placeholder" />
          <span>{t("markAllRead")}</span>
        </Button>
      }
    >
      <PageSection>
        <div className="flex items-center justify-between gap-md text-body-sm text-muted-foreground">
          <span>
            {unreadCount > 0
              ? t("unread", { count: unreadCount })
              : t("allRead")}
          </span>
        </div>

        {items.length === 0 && !loading ? (
          <p className="p-lg text-center text-body-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : null}

        <ul className="flex flex-col divide-y divide-border">
          {items.map((m) => {
            const unread = m.readAt === null;
            return (
              <li key={m.id}>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-auto w-full items-start justify-start gap-md whitespace-normal py-md text-left"
                  onClick={() => void open(m)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <span className="flex items-center gap-sm">
                      <span
                        className={`min-w-0 truncate text-label-md text-foreground ${unread ? "font-semibold" : "font-normal"}`}
                      >
                        {m.title}
                      </span>
                      <StatusBadge tone={unread ? "info" : "neutral"} dot>
                        {unread ? t("unreadBadge") : t("readBadge")}
                      </StatusBadge>
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {m.body}
                    </span>
                    <span className="text-body-sm text-content-tertiary tabular-nums">
                      {formatInboxTime(m.createdAt, locale)}
                    </span>
                  </span>
                  {m.link ? (
                    <span className="inline-flex shrink-0 items-center gap-2xs text-body-sm text-muted-foreground">
                      {t("open")}
                      <Icon
                        name="chevron-right"
                        size="xs"
                        fallback="placeholder"
                      />
                    </span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>

        {nextBefore ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="md"
              disabled={loading}
              onClick={() => void load(nextBefore)}
            >
              {loading ? t("loading") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </PageSection>
    </FormPageTemplate>
  );
}
