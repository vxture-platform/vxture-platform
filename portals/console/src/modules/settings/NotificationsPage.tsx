"use client";

import { RowActionsPlaceholder } from "@/components/table/RowActionsPlaceholder";
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
  TableTitleCell,
} from "@vxture/design-system";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/api/console-bff";

type ChannelKey = "inbox" | "email" | "sms";
type TopicKey =
  | "subscription_expiry"
  | "provision_result"
  | "payment_due"
  | "refund_progress"
  | "announcement"
  | "order_status"
  | "tenant_change"
  | "security"
  | "invoice_progress"
  | "verification_result"
  | "member_invitation"
  | "quota_alert"
  | "ticket_activity";

type ChannelMeta = {
  key: ChannelKey;
  icon: IconName;
};

type TopicPreference = {
  key: TopicKey;
  icon: IconName;
  channels: Record<ChannelKey, boolean>;
  lockedChannels?: ChannelKey[];
  /** 事件源已存在但通知模板未接：标「开发中」并禁用三个渠道开关，不给假开关。 */
  planned?: boolean;
};

type NotificationState = {
  topics: TopicPreference[];
};

const CHANNELS: ChannelMeta[] = [
  { key: "inbox", icon: "bell" },
  { key: "email", icon: "mail" },
  { key: "sms", icon: "phone" },
];

/**
 * 主题清单（owner 2026-09-08 重排；2026-09-09 补两个）。**平铺，不分组**：各自四字自足，
 * 组名拼进项名等于把删掉的分组用文字再写一遍，还占列宽。
 *
 * 前 7 个有模板已经在发；后 6 个的**事件源都已存在**（各自的状态机或 webhook 事件
 * 类型跑着），只是通知模板还没接——`planned: true` 让它们在界面上挂「开发中」标并
 * **禁用三个渠道开关**。
 *
 * 为什么要把未接的也列出来：改之前页面有 6 个主题，其中 3 个没有任何模板会落到它们
 * 头上（`account` / `security` / `usage`），客户勾了等于没勾——**页面在说假话**。
 * 现在要么有模板、要么明说「开发中」并关掉开关，没有第三种。
 *
 * 事务性的四个（到期/开通/待付/退款——错过了会有实际损失）邮件默认开、可关，与服务端
 * `NotificationPreferencesService` 的 `TOPIC_DEFAULT_OVERRIDES` 同源:「恢复默认」用的
 * 就是这一份。
 */
const DEFAULT_NOTIFICATION_STATE: NotificationState = {
  topics: [
    {
      key: "subscription_expiry",
      icon: "clock",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "provision_result",
      icon: "seal-check",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "payment_due",
      icon: "credit-card",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "refund_progress",
      icon: "arrow-left",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "announcement",
      icon: "megaphone",
      channels: { inbox: true, email: false, sms: false },
    },
    /* owner 2026-09-09 补的两个。都**已经在发**，所以不带 planned 标：
       order_status 是「我那个订单最后怎么样了」(申报付款 / 取消 / 逾期关闭)；
       tenant_change 是「租户结构变了」(个人升组织)。
       两者都属于事务性——错过了会误判自己的订单或权限状态——邮件默认开、可关。 */
    {
      key: "order_status",
      icon: "receipt",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "tenant_change",
      icon: "buildings",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "security",
      icon: "shield-check",
      channels: { inbox: true, email: false, sms: false },
      lockedChannels: ["inbox"],
      planned: true,
    },
    {
      key: "invoice_progress",
      icon: "receipt",
      channels: { inbox: true, email: false, sms: false },
      planned: true,
    },
    {
      key: "verification_result",
      icon: "shield",
      channels: { inbox: true, email: false, sms: false },
      planned: true,
    },
    {
      key: "member_invitation",
      icon: "users",
      channels: { inbox: true, email: false, sms: false },
      planned: true,
    },
    {
      key: "quota_alert",
      icon: "gauge",
      channels: { inbox: true, email: false, sms: false },
      planned: true,
    },
    {
      key: "ticket_activity",
      icon: "chat-circle",
      channels: { inbox: true, email: false, sms: false },
      planned: true,
    },
  ],
};

export function NotificationsPage() {
  const t = useTranslations("notificationsPage");
  const tableLabels = useTableLabels();
  const [state, setState] = useState<NotificationState>(
    DEFAULT_NOTIFICATION_STATE,
  );
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 批 6:读失败**不再拿前端默认值当数据**。此前 state 一开始就是
   * DEFAULT_NOTIFICATION_STATE,读挂了只加一条横幅、矩阵照常渲染且开关可点——
   * 用户以为在改自己的设置,一按保存就把一整套编出来的默认值盖到服务端真值上。
   * 现在读失败就显影 + 停掉整张矩阵与保存,只留重试。
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
    setLoading(true);
    setLoadFailed(false);
    fetchNotificationPreferences()
      .then((prefs) => {
        if (alive) applyPreferences(prefs);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applyPreferences, reloadKey]);

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
        <TableTitleCell
          icon={topic.icon}
          title={t(`topics.items.${topic.key}.title`)}
          {...(topic.planned || topic.lockedChannels?.length
            ? {
                titleSuffix: (
                  <>
                    {topic.planned ? (
                      <StatusBadge tone="warning">
                        {t("topics.planned")}
                      </StatusBadge>
                    ) : null}
                    {topic.lockedChannels?.length ? (
                      <StatusBadge tone="neutral">
                        {t("topics.policyLocked")}
                      </StatusBadge>
                    ) : null}
                  </>
                ),
              }
            : {})}
        />
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
              topic.planned
                ? t("topics.plannedDescription")
                : channelLocked
                  ? t("topics.policyLockedDescription")
                  : t(`channels.short.${channel.key}`)
            }
          >
            <Checkbox
              checked={topic.channels[channel.key]}
              /* 「开发中」= 事件源在、模板未接：三个开关一律禁用。给一个点得动却
                 什么都不会发生的开关，正是这一页改之前的毛病。 */
              disabled={
                topic.planned ||
                channelLocked ||
                loading ||
                saving ||
                loadFailed
              }
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
          {loadFailed ? (
            <LoadFailedBanner
              onRetry={() => setReloadKey((k) => k + 1)}
              retrying={loading}
            />
          ) : null}
          {error !== null ? <Banner tone="danger" title={error} /> : null}
        </div>
      }
      footer={
        <>
          <Button
            size="md"
            variant="outline"
            disabled={loading || saving || loadFailed}
            onClick={resetDefaults}
          >
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("actions.reset")}</span>
          </Button>
          <Button
            size="md"
            disabled={loading || saving || loadFailed}
            onClick={() => void handleSave()}
          >
            <Icon name="check" size="xs" fallback="placeholder" />
            <span>{t("actions.save")}</span>
          </Button>
        </>
      }
    >
      {messageKey ? <Banner tone="success" title={t(messageKey)} /> : null}

      {/* 页面只剩一张表（owner 2026-09-08 简化）。删掉的三样都是同一信息的第二处
          写法：概览卡的「主题 5/11」「邮件 4 项」下面就是表本身；「渠道提醒方式」
          板块列的三个渠道就是表的三列；分组表头对 11 行来说是给十几行以上用的。 */}
      <PageSection
        icon="megaphone"
        level={2}
        title={t("topics.title")}
        description={t("topics.description")}
      >
        <DataTable
          labels={tableLabels}
          columns={topicColumns}
          rows={state.topics}
          rowKey={(topic) => topic.key}
          /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列与同页
             其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
          leadingSpacer
          indexStart={1}
          /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮。 */
          rowActions={() => <RowActionsPlaceholder />}
        />
      </PageSection>
    </FormPageTemplate>
  );
}
