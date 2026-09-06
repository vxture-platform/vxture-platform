"use client";

/**
 * TenantVerificationPage.tsx — 企业认证**结果**页(owner 2026-09-06:提交与结果拆开)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/tenant/verification`。这一页只讲结果:当前是什么状态、认证信息是什么、
 * 历次申请、口径说明。**提交在 `/tenant/verification/apply`**——此前一屏里既是结果
 * 又是表单,已认证的人还得在下面看见一张空表(owner:「认证提交和认证结果页面应该
 * 拆分,不能混在一起」)。页头右侧一个按钮去提交页。
 *
 * 认证状态两档(owner 2026-09-06):简易认证(可订阅、不可开票)/ 实名认证(全功能);
 * 由 BFF 的 level 派生,不在页面里推。局限性在横幅与当前认证信息里各说一次。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  EmptyState,
  Icon,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { ActionMenuItem, DataTableColumn } from "@vxture/design-system";
import {
  fetchTenantVerification,
  type ConsoleTenantVerificationState,
  type ConsoleVerification,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection, SignalList } from "@/layout/shell";
import { CardRows } from "@/modules/account/profile/CardRows";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";
import { VERIFICATION_STATUS_TONES } from "./verification-methods";

export function TenantVerificationPage() {
  const t = useTranslations("verificationPage.org");
  const tableLabels = useTableLabels();
  const { session } = useConsoleSession();
  const router = useRouter();

  const [state, setState] = useState<ConsoleTenantVerificationState | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* strict 读(2026-08-30):读不到就显影 + 重试,不回落成「未认证」——那会把一次
     故障演成一个干净可提交的状态。 */
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchTenantVerification()
      .then((s) => {
        if (!active) return;
        setState(s);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setState(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  const status = state?.status ?? "unverified";
  const isOrganization = session.tenant?.tenantType === "organization";
  /** 已按简易方式认证:能订阅但不能开票,这条要一直摆在明处。 */
  const liteVerified = status === "verified" && state?.level === "lite";

  /* 列序(owner 2026-09-06 走查):企业主体(名称主 / 信用代码辅)为首列 → 认证方式 →
     状态 → 提交时间 → 审核结果(时间与结果相邻)→ 操作(rowActions 单列,表格规范)。 */
  const historyColumns: DataTableColumn<ConsoleVerification>[] = [
    {
      id: "subject",
      header: t("history.colSubject"),
      // 主辅:企业名称在上、统一社会信用代码在下(等宽小字),一列两读不占两列
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-2xs">
          <span className="truncate text-label-md text-foreground">
            {r.companyName ?? "—"}
          </span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {r.businessLicenseNo ?? "—"}
          </span>
        </span>
      ),
    },
    {
      id: "method",
      header: t("history.colMethod"),
      cell: (r) => t(`methods.${r.verificationMethod}.name`),
    },
    {
      id: "status",
      header: t("history.colStatus"),
      align: "center",
      cell: (r) => (
        <StatusBadge tone={VERIFICATION_STATUS_TONES[r.status] ?? "neutral"}>
          {t(`status.${r.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: "at",
      header: t("history.colAt"),
      cell: (r) => (
        <span className="tabular-nums">
          {fmtDate(r.createdAt)} {fmtTime(r.createdAt)}
        </span>
      ),
    },
    {
      id: "result",
      header: t("history.colResult"),
      cell: (r) =>
        r.status === "rejected" && r.rejectReason ? (
          <span className="text-body-sm text-warning-text">
            {r.rejectReason}
          </span>
        ) : r.reviewedAt ? (
          <span className="tabular-nums text-body-sm text-muted-foreground">
            {fmtDate(r.reviewedAt)} {fmtTime(r.reviewedAt)}
          </span>
        ) : (
          t("history.awaiting")
        ),
    },
  ];

  /* 行操作:只有**最新一条**能接着动作(重新提交 / 变更认证信息)——历史行是既成事实,
     给它一个点了没反应的菜单不如不给。审核中不放行,与页头按钮同一判据。 */
  const latestId = state?.latest?.id ?? null;
  const rowActions = (r: ConsoleVerification) => {
    if (r.id !== latestId || !isOrganization || status === "pending") {
      return null;
    }
    const items: ActionMenuItem[] = [
      {
        id: "apply",
        label:
          status === "verified"
            ? t("actions.changeApply")
            : t("actions.goApply"),
        onSelect: () => router.push("/tenant/verification/apply"),
      },
    ];
    return <ActionMenu label={t("history.rowMenu")} items={items} />;
  };

  return (
    <ViewLayout>
      <ViewHeader
        icon="seal-check"
        title={t("title")}
        description={t("description")}
        action={
          <span className="flex flex-wrap items-center gap-sm">
            {state ? (
              /* 已认证分两档(owner 2026-09-06):简易认证 / 实名认证 */
              <StatusBadge
                tone={
                  status === "verified" && state.level === "lite"
                    ? "info"
                    : (VERIFICATION_STATUS_TONES[status] ?? "neutral")
                }
              >
                {status === "verified"
                  ? t(state.level === "lite" ? "status.lite" : "status.full")
                  : t(`status.${status}`)}
              </StatusBadge>
            ) : null}
            {isOrganization ? (
              <Button
                size="md"
                variant={status === "verified" ? "outline" : "default"}
                disabled={status === "pending"}
                onClick={() => router.push("/tenant/verification/apply")}
              >
                <Icon name="file-text" size="xs" fallback="placeholder" />
                <span>
                  {status === "verified"
                    ? t("actions.changeApply")
                    : t("actions.goApply")}
                </span>
              </Button>
            ) : null}
          </span>
        }
      />

      {!isOrganization ? (
        <Banner
          tone="info"
          title={t("personalTenantBanner")}
          description={t("personalTenantBannerBody")}
        />
      ) : null}
      {status === "pending" ? (
        <Banner tone="info" title={t("pendingBanner")} />
      ) : null}
      {status === "rejected" && state?.latest?.rejectReason ? (
        <Banner
          tone="warning"
          title={t("rejectedBanner", { reason: state.latest.rejectReason })}
        />
      ) : null}
      {/* 局限性(owner 2026-09-06):已按简易方式认证 = 可订阅、不可开票 */}
      {liteVerified ? (
        <Banner
          tone="warning"
          title={t("liteLimitBanner")}
          description={t("liteLimitBannerBody")}
        />
      ) : null}
      {loadFailed ? (
        <Banner
          tone="danger"
          title={t("loadFailed")}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {t("retry")}
            </Button>
          }
        />
      ) : null}

      {/* 当前认证信息(verified 展示) */}
      {status === "verified" && state?.latest ? (
        <PageSection
          icon="seal-check"
          level={2}
          title={t("current.title")}
          description={t("current.description")}
        >
          <CardRows>
            <DetailList>
              <DetailRow label={t("current.method")}>
                {t(`methods.${state.latest.verificationMethod}.name`)}
              </DetailRow>
              <DetailRow label={t("form.companyName")}>
                {state.latest.companyName ?? "—"}
              </DetailRow>
              <DetailRow label={t("form.licenseNo")}>
                <span className="font-mono">
                  {state.latest.businessLicenseNo}
                </span>
              </DetailRow>
              {/* 简易认证不收法定代表人姓名:没有就不出这一行,不画一个空「—」 */}
              {state.latest.legalPersonName ? (
                <DetailRow label={t("form.legalName")}>
                  {state.latest.legalPersonName}
                </DetailRow>
              ) : null}
              <DetailRow label={t("current.verifiedAt")}>
                {state.latest.reviewedAt
                  ? `${fmtDate(state.latest.reviewedAt)} ${fmtTime(state.latest.reviewedAt)}`
                  : "—"}
              </DetailRow>
              <DetailRow label={t("current.invoicing")}>
                {state.canIssueInvoice
                  ? t("current.invoicingAllowed")
                  : t("current.invoicingBlocked")}
              </DetailRow>
            </DetailList>
          </CardRows>
        </PageSection>
      ) : null}

      {/* 历史记录 */}
      <PageSection
        icon="clock-counter-clockwise"
        level={2}
        title={t("history.title")}
        description={t("history.description")}
      >
        {/* 表格不套 CardRows:console 各页的 DataTable 一律与面头同宽铺开
            (账单 / 成员 / 审计都是),缩进只用于字段行与说明这类内容块 */}
        <DataTable<ConsoleVerification>
          labels={tableLabels}
          columns={historyColumns}
          rows={state?.history ?? []}
          rowKey={(r) => r.id}
          loading={loading}
          indexStart={1}
          rowActions={rowActions}
          empty={<EmptyState title={t("history.empty")} />}
        />
      </PageSection>

      {/* 口径说明。走查(owner 2026-09-06):内容块不能顶头,与面头标题文字对齐——
          `CardRows` 就是那道缩进骨架(留一个 icon 宽的占位),与账号 / 租户各卡同源。 */}
      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <CardRows>
          <SignalList
            items={[
              { title: t("notes.liteTitle"), description: t("notes.liteBody") },
              // owner 2026-09-06 明令:所有认证都不收身份证件影像,写进说明
              { title: t("notes.noIdTitle"), description: t("notes.noIdBody") },
              {
                title: t("notes.effectTitle"),
                description: t("notes.effectBody"),
              },
            ]}
          />
        </CardRows>
      </PageSection>
    </ViewLayout>
  );
}
