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
  | "security_event"
  | "login_activity"
  | "invoice_progress"
  | "verification_result"
  | "member_invitation"
  | "invitation_activity"
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
 * 前 13 个有模板已经在发；后 2 个的**事件源都已存在**（各自的状态机或 webhook 事件
 * 类型跑着），只是通知模板还没接——`planned: true` 让它们在界面上挂「开发中」标并
 * **禁用三个渠道开关**。这两个数字与下面那张清单是同一份事实的两处写法，一起改。
 *
 * 2026-09-28 批 5：`verification_result` 与 `quota_alert` 取下 `planned`（模板本批上线）。
 * 2026-09-29：`member_invitation` 取下 `planned` 并挪到「已在发」那一段（接受 / 拒绝 /
 * 撤回 / 过期四条模板本批上线）；它的站内档换成 `lockedChannels`，理由见那一行的注释。
 * 2026-09-29（owner 看过这一页之后）：**邀请拆成两行**——`member_invitation` 只留邀请本身
 * （站内恒锁），`invitation_activity` 装那四条周知（三档全可点）。一行装两种性质的东西时，
 * 站内锁为了保住邀请本身必须存在，四条周知的站内档就跟着关不掉，客户被迫二选一。
 * 2026-09-29（同日，账号安全线）：旧的 `security` 这一行**改名成 `security_event` 并拆出
 * `login_activity`**，两行都取下 `planned`（本批接上十四条模板）。与邀请那一刀同一条判据、
 * 同一处代价：安全事件的站内档必须锁死（账号被接管时唯一的到达路径），所以「没见过的设备
 * 登录」若与它同住一行，客户换个浏览器就来一条而且关不掉。
 * 这一处与服务端的 `NOTIFICATION_TOPICS_PLANNED`、两本词条是**手工同步**的三处；漏掉
 * 这一处的后果不是报错，是客户收到一封开关禁着、关不掉的信。
 *
 * 为什么要把未接的也列出来：改之前页面有 6 个主题，其中 3 个没有任何模板会落到它们
 * 头上（`account` / `security` / `usage`），客户勾了等于没勾——**页面在说假话**。
 * 现在要么有模板、要么明说「开发中」并关掉开关，没有第三种。
 *
 * 事务性的那几个（到期/开通/待付/退款/订单状态/租户变更/认证结果/额度用尽——
 * 错过了会有实际损失）邮件默认开、可关，与服务端 `NotificationPreferencesService` 的
 * `TOPIC_DEFAULT_OVERRIDES` 同源:「恢复默认」用的就是这一份，两份不一致的症状是
 * 「按一下恢复默认，保存后开关又变了」。
 * 账号安全那两行邮件也默认开，但**判据是另一条**（站内这个通道在那一档上不可信，
 * 不是「错过了会有损失」）——理由写在它们各自那一行上。
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
    /* 批 5（2026-09-28）接上模板的两个，所以**不再带 planned 标**、三个开关可点：
       verification_result 是企业认证通过 / 驳回；quota_alert 是加油包额度用尽。
       两者都属事务性（驳回了不知道认证一直卡着；额度用完了不知道业务在空跑），
       邮件默认开、可关——与服务端 TOPIC_DEFAULT_OVERRIDES 同源，「恢复默认」用这一份。 */
    {
      key: "verification_result",
      icon: "shield",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "quota_alert",
      icon: "gauge",
      channels: { inbox: true, email: true, sms: false },
    },
    /* 2026-09-29：成员邀请接上四条模板（接受 / 拒绝 / 撤回 / 过期），所以**不再带
       planned 标**。它与上面那几个不同的一点是**站内那一档锁着**：这个主题下还有一条
       `mandatory` 的模板——按用户号邀请时，站内那条消息**就是**邀请本身，关掉它邀请人会
       收到「已送达对方账号」而对方那边什么也没有（owner 2026-09-09）。
       站内可关会让这一行出现「未订阅」而邀请照样进收件箱的假象，而本页抬头写着「站内消息
       始终可查」；所以这一档挂「策略锁定」、由**服务端**的 LOCKED 强制（前端画不画是可以
       绕过的）。邮件那一档照常可点，作用对象是那四条可选周知——邀请本身是 inboxOnly 的，
       开着邮件也不会把邀请变成一封邮件。事务性（错过了会误判自己的权限状态）⇒ 邮件默认开。 */
    {
      key: "member_invitation",
      icon: "users",
      /* 邮件默认**关**：这一行只剩「邀请本身」一条模板，而那条是 inboxOnly 的，默认打开一个
         永远不会发出邮件的开关就是这一页此前的老毛病（页面在说假话）。开关仍可点——与服务端
         TOPIC_DEFAULT_OVERRIDES 同源，「恢复默认」用的就是这一份。 */
      channels: { inbox: true, email: false, sms: false },
      lockedChannels: ["inbox"],
    },
    /* 2026-09-29 拆出来的第二行：邀请的四个终态（接受 / 拒绝 / 撤回 / 过期）。
       **没有 lockedChannels**：这四条没有一条是「送达手段本身」，客户把三档全关掉也不会让
       任何人少收到一条邀请——关掉的是发给自己的那份周知。这正是拆行的全部意义。
       邮件默认关：它是**周知**不是事务性（owner 2026-09-29 的分类），判据同平台公告。 */
    {
      key: "invitation_activity",
      icon: "user-plus",
      channels: { inbox: true, email: false, sms: false },
    },
    /* 2026-09-29 账号安全线的两行，紧挨着（两行相邻，客户才看得出差别在哪）。
       都**不再带 planned 标**：本批接上十四条模板。 */
    {
      key: "security_event",
      icon: "shield-check",
      /* 邮件默认**开**（owner 裁定 1：「锁定与强制下线两类，站内送不到——账号都进不去了」）。
         站内那一档挂「策略锁定」、由**服务端**的 LOCKED 强制：前端画不画是可以绕过的。 */
      channels: { inbox: true, email: true, sms: false },
      lockedChannels: ["inbox"],
    },
    /* 拆出来的第二行：只装「没见过的设备登录」一条。**没有 lockedChannels**——这正是拆行的
       全部意义：它是这条线上唯一会反复发生的一条，客户嫌吵就该能整条关掉，而关掉它不会让
       「你的密码被改了」少送一条。邮件默认开、可关：要警告的那个人手上就握着这个收件箱，
       所以默认走另一个信箱；嫌吵的自己关。与服务端 TOPIC_DEFAULT_OVERRIDES 同源，
       「恢复默认」用的就是这一份。 */
    {
      key: "login_activity",
      icon: "sign-in",
      channels: { inbox: true, email: true, sms: false },
    },
    {
      key: "invoice_progress",
      icon: "receipt",
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
