"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Checkbox,
  DataTable,
  FormPageTemplate,
  Icon,
  StatusBadge,
  ViewHeader,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import { PageSection, SummaryStrip } from "@/layout/shell";
import { useTranslations } from "next-intl";
import {
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/api/console-bff";

type ChannelKey = "inbox" | "email" | "sms";
type TopicKey =
  | "account"
  | "security"
  | "subscription"
  | "billing"
  | "usage"
  | "product";
type TopicGroupKey = "identity" | "commerce" | "system";

type ChannelMeta = {
  key: ChannelKey;
  icon: IconName;
};

type TopicPreference = {
  key: TopicKey;
  group: TopicGroupKey;
  icon: IconName;
  channels: Record<ChannelKey, boolean>;
  lockedChannels?: ChannelKey[];
};

type NotificationState = {
  topics: TopicPreference[];
};

const CHANNELS: ChannelMeta[] = [
  { key: "inbox", icon: "bell" },
  { key: "email", icon: "mail" },
  { key: "sms", icon: "phone" },
];

const TOPIC_GROUPS: Array<{ key: TopicGroupKey; icon: IconName }> = [
  { key: "identity", icon: "user" },
  { key: "commerce", icon: "chart-bar" },
  { key: "system", icon: "server" },
];

const DEFAULT_NOTIFICATION_STATE: NotificationState = {
  topics: [
    {
      key: "account",
      group: "identity",
      icon: "user",
      channels: { inbox: true, email: false, sms: false },
    },
    {
      key: "security",
      group: "identity",
      icon: "shield-check",
      channels: { inbox: true, email: false, sms: false },
      lockedChannels: ["inbox"],
    },
    {
      key: "subscription",
      group: "commerce",
      icon: "chart-bar",
      channels: { inbox: true, email: false, sms: false },
    },
    {
      key: "billing",
      group: "commerce",
      icon: "calendar",
      channels: { inbox: true, email: false, sms: false },
    },
    {
      key: "usage",
      group: "commerce",
      icon: "database",
      channels: { inbox: true, email: false, sms: false },
    },
    {
      key: "product",
      group: "system",
      icon: "sparkles",
      channels: { inbox: true, email: false, sms: false },
    },
  ],
};

export function NotificationsPage() {
  const t = useTranslations("notificationsPage");
  const [state, setState] = useState<NotificationState>(
    DEFAULT_NOTIFICATION_STATE,
  );
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 服务端矩阵 → 页面结构。分组/图标是纯呈现,留在前端;开关值一律以服务端为准。 */
  const applyPreferences = useCallback((prefs: NotificationPreferences) => {
    setState({
      topics: DEFAULT_NOTIFICATION_STATE.topics.map((topic) => ({
        ...topic,
        channels: {
          inbox: prefs[topic.key]?.inbox ?? topic.channels.inbox,
          email: prefs[topic.key]?.email ?? topic.channels.email,
          sms: prefs[topic.key]?.sms ?? topic.channels.sms,
        },
      })),
    });
  }, []);

  useEffect(() => {
    let alive = true;
    fetchNotificationPreferences()
      .then((prefs) => {
        if (alive) applyPreferences(prefs);
      })
      .catch(() => {
        if (alive) setError(t("feedback.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applyPreferences, t]);

  /** 提交后按**服务端返回值**回填,而不是沿用本地状态:锁定通道会被服务端
   *  强制打开,不回填的话界面会显示一个与库里不一致的关态。 */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessageKey(null);
    try {
      const payload = Object.fromEntries(
        state.topics.map((topic) => [topic.key, { ...topic.channels }]),
      );
      applyPreferences(await saveNotificationPreferences(payload));
      setMessageKey("feedback.saved");
    } catch {
      setError(t("feedback.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [applyPreferences, state.topics, t]);

  const totalTopics = state.topics.length;
  const enabledTopics = state.topics.filter((topic) =>
    CHANNELS.some((channel) => topic.channels[channel.key]),
  ).length;
  const emailTopics = state.topics.filter(
    (topic) => topic.channels.email,
  ).length;
  const smsTopics = state.topics.filter((topic) => topic.channels.sms).length;

  function resetDefaults() {
    // 只回到默认值,不落库——保存仍是显式动作,避免误点即生效。
    setState(DEFAULT_NOTIFICATION_STATE);
    setMessageKey("feedback.reset");
  }

  function toggleTopicChannel(
    topicKey: TopicKey,
    channelKey: ChannelKey,
    enabled: boolean,
  ) {
    setState((current) => ({
      topics: current.topics.map((topic) => {
        if (
          topic.key !== topicKey ||
          topic.lockedChannels?.includes(channelKey)
        ) {
          return topic;
        }

        return {
          ...topic,
          channels: {
            ...topic.channels,
            [channelKey]: enabled,
          },
        };
      }),
    }));
    setMessageKey(null);
  }

  /* A topic × channel matrix. Every column header already exists as an i18n
   * key (topics.columns.* / channels.short.*), so this is a real table rather
   * than a headerless list. */
  const topicColumns: DataTableColumn<TopicPreference>[] = [
    {
      id: "topic",
      header: t("topics.columns.topic"),
      cell: (topic) => (
        <span className="flex min-w-0 items-center gap-sm">
          <Icon
            name={topic.icon}
            size="sm"
            fallback="placeholder"
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
          <strong className="min-w-0 truncate text-label-md text-foreground">
            {t(`topics.items.${topic.key}.title`)}
          </strong>
          {topic.lockedChannels?.length ? (
            <StatusBadge tone="neutral">{t("topics.policyLocked")}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    ...CHANNELS.map<DataTableColumn<TopicPreference>>((channel) => ({
      id: channel.key,
      align: "center",
      header: (
        <span className="inline-flex items-center gap-2xs">
          <Icon name={channel.icon} size="xs" fallback="placeholder" />
          {t(`channels.short.${channel.key}`)}
        </span>
      ),
      cell: (topic) => {
        const channelLocked =
          topic.lockedChannels?.includes(channel.key) ?? false;
        return (
          <span
            title={
              channelLocked
                ? t("topics.policyLockedDescription")
                : t(`channels.short.${channel.key}`)
            }
          >
            <Checkbox
              checked={topic.channels[channel.key]}
              disabled={channelLocked || loading || saving}
              aria-label={t("topics.toggleLabel", {
                topic: t(`topics.items.${topic.key}.title`),
                channel: t(`channels.items.${channel.key}.title`),
              })}
              onCheckedChange={(value) =>
                toggleTopicChannel(topic.key, channel.key, value === true)
              }
            />
          </span>
        );
      },
    })),
    {
      id: "status",
      header: t("topics.columns.status"),
      align: "right",
      cell: (topic) => {
        const enabled = CHANNELS.some((channel) => topic.channels[channel.key]);
        return (
          <StatusBadge tone={enabled ? "success" : "neutral"} dot>
            {enabled ? t("topics.subscribed") : t("topics.unsubscribed")}
          </StatusBadge>
        );
      },
    },
  ];

  return (
    <FormPageTemplate
      header={
        <div className="flex flex-col gap-md">
          <ViewHeader
            icon="mail"
            title={t("header.title")}
            description={t("header.description")}
          />
          {error !== null ? <Banner tone="danger" title={error} /> : null}
        </div>
      }
      footer={
        <>
          <Button
            size="md"
            variant="outline"
            disabled={loading || saving}
            onClick={resetDefaults}
          >
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("actions.reset")}</span>
          </Button>
          <Button
            size="md"
            disabled={loading || saving}
            onClick={() => void handleSave()}
          >
            <Icon name="check" size="xs" fallback="placeholder" />
            <span>{t("actions.save")}</span>
          </Button>
        </>
      }
    >
      {messageKey ? <Banner tone="success" title={t(messageKey)} /> : null}

      <PageSection>
        <SummaryStrip
          items={[
            {
              label: t("preference.label"),
              value: t("preference.enabled"),
              aside: <Icon name="bell" size="sm" fallback="placeholder" />,
            },
            {
              label: t("summary.topics"),
              value: t("summary.topicsValue", {
                enabled: enabledTopics,
                total: totalTopics,
              }),
            },
          ]}
        />
        {/* Channel coverage sentences — prose, not label/value pairs, so they
         * stay a chip row rather than being forced into SummaryStrip. */}
        <div
          className="flex flex-wrap items-center gap-lg text-body-sm text-muted-foreground"
          aria-label={t("summary.title")}
        >
          <span className="flex items-center gap-2xs">
            <Icon name="bell" size="xs" fallback="placeholder" />
            {t("summary.inboxDefault")}
          </span>
          <span className="flex items-center gap-2xs">
            <Icon name="mail" size="xs" fallback="placeholder" />
            {t("summary.emailValue", { count: emailTopics })}
          </span>
          <span className="flex items-center gap-2xs">
            <Icon name="phone" size="xs" fallback="placeholder" />
            {t("summary.smsValue", { count: smsTopics })}
          </span>
        </div>
      </PageSection>

      <PageSection
        icon="megaphone"
        level={2}
        title={t("topics.title")}
        description={t("topics.count", { count: totalTopics })}
      >
        {TOPIC_GROUPS.map((group) => {
          const groupTopics = state.topics.filter(
            (topic) => topic.group === group.key,
          );

          return (
            <PageSection
              key={group.key}
              level={3}
              icon={group.icon}
              title={t(`groups.${group.key}`)}
              description={t("topics.groupCount", {
                count: groupTopics.length,
              })}
            >
              <DataTable
                columns={topicColumns}
                rows={groupTopics}
                rowKey={(topic) => topic.key}
              />
            </PageSection>
          );
        })}
      </PageSection>
    </FormPageTemplate>
  );
}
