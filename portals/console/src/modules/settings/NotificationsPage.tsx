"use client";

import { useEffect, useState } from "react";
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
import { PlannedBadge, PlannedNotice } from "@/components/planned";
import { useTranslations } from "next-intl";

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

const STORAGE_KEY = "vxture.console.notificationPreferences.v3";

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

function readStoredState(): NotificationState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_NOTIFICATION_STATE;
    }

    const parsed = JSON.parse(stored) as Partial<NotificationState>;
    const storedTopics = Array.isArray(parsed.topics) ? parsed.topics : [];

    return {
      topics: DEFAULT_NOTIFICATION_STATE.topics.map((topic) => {
        const storedTopic = storedTopics.find(
          (item) => item?.key === topic.key,
        );
        const storedChannels =
          storedTopic &&
          typeof storedTopic.channels === "object" &&
          storedTopic.channels !== null
            ? storedTopic.channels
            : {};

        return {
          ...topic,
          channels: {
            ...topic.channels,
            ...storedChannels,
          },
        };
      }),
    };
  } catch {
    return DEFAULT_NOTIFICATION_STATE;
  }
}

export function NotificationsPage() {
  const t = useTranslations("notificationsPage");
  const [state, setState] = useState<NotificationState>(
    DEFAULT_NOTIFICATION_STATE,
  );
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const totalTopics = state.topics.length;
  const enabledTopics = state.topics.filter((topic) =>
    CHANNELS.some((channel) => topic.channels[channel.key]),
  ).length;
  const emailTopics = state.topics.filter(
    (topic) => topic.channels.email,
  ).length;
  const smsTopics = state.topics.filter((topic) => topic.channels.sms).length;

  function markSaved() {
    setMessageKey("feedback.saved");
  }

  function resetDefaults() {
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
              disabled
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
            secondary={<PlannedBadge />}
          />
          <PlannedNotice variant="controls" />
        </div>
      }
      footer={
        <>
          <Button size="md" variant="outline" disabled onClick={resetDefaults}>
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("actions.reset")}</span>
          </Button>
          <Button size="md" disabled onClick={markSaved}>
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
