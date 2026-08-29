"use client";

/**
 * TenantVerificationPage.tsx — 组织企业认证(owner 2026-08-21 P0,替换骨架)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * spec 20-vxture-tenant-console-info §3.4 组织租户独立详情页;轻量模式
 * (§1.2 第 57 行裁定:一次认证长期有效,本期无需上传证件影像)——表单 =
 * 统一社会信用代码 + 法定代表人姓名。提交 → pending → admin 既有台账审核 →
 * 状态回流(approve 同步 tenants.verification_status,组织信息页徽章即变)。
 * pending 拒重复提交;rejected 显示驳回原因可重新提交;verified 后再提交 =
 * 变更重审(spec 245)。个人实名(/profile/verification)另立项仍为骨架。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  EmptyState,
  FieldLabel,
  Input,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  fetchTenantVerification,
  submitTenantVerification,
  ConsoleBffError,
  type ConsoleTenantVerificationState,
  type ConsoleVerification,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

const STATUS_TONES: Record<ConsoleVerification["status"], StatusBadgeTone> = {
  unverified: "neutral",
  pending: "info",
  verified: "success",
  rejected: "warning",
};

export function TenantVerificationPage() {
  const t = useTranslations("verificationPage.org");
  const { session } = useConsoleSession();

  const [state, setState] = useState<ConsoleTenantVerificationState | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [licenseNo, setLicenseNo] = useState("");
  const [legalName, setLegalName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  /* fetchTenantVerification 是 strict 读（2026-08-30）：此前失败回落成
   * "unverified"，页面会照常放开表单、徽章写「未认证」——把一次故障演成一个
   * 可以重新提交的干净状态。现在读不到就锁表单、明说、给重试。 */
  const reload = () =>
    fetchTenantVerification()
      .then((s) => {
        setState(s);
        setLoadFailed(false);
        if (s.latest?.businessLicenseNo)
          setLicenseNo(s.latest.businessLicenseNo);
        if (s.latest?.legalPersonName) setLegalName(s.latest.legalPersonName);
      })
      .catch(() => {
        setState(null);
        setLoadFailed(true);
      });

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [session.tenant?.id]);

  const status = state?.status ?? "unverified";
  // state 为 null 的两种情况（还没读到 / 读取失败）都不放开表单。
  const canSubmit = state !== null && status !== "pending";

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setSubmitted(false);
    try {
      await submitTenantVerification({
        businessLicenseNo: licenseNo.trim(),
        legalPersonName: legalName.trim(),
      });
      setSubmitted(true);
      await reload();
    } catch (e) {
      setError(e instanceof ConsoleBffError ? e.message : t("submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const historyColumns: DataTableColumn<ConsoleVerification>[] = [
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
      id: "license",
      header: t("history.colLicense"),
      cell: (r) =>
        r.businessLicenseNo ? (
          <span className="font-mono text-body-sm">{r.businessLicenseNo}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: t("history.colStatus"),
      align: "center",
      cell: (r) => (
        <StatusBadge tone={STATUS_TONES[r.status]}>
          {t(`status.${r.status}`)}
        </StatusBadge>
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

  return (
    <ViewLayout>
      <ViewHeader
        icon="seal-check"
        title={t("title")}
        description={t("description")}
        action={
          state ? (
            <StatusBadge tone={STATUS_TONES[status]}>
              {t(`status.${status}`)}
            </StatusBadge>
          ) : null
        }
      />

      {status === "rejected" && state?.latest?.rejectReason ? (
        <Banner
          tone="warning"
          title={t("rejectedBanner", { reason: state.latest.rejectReason })}
        />
      ) : null}
      {status === "pending" ? (
        <Banner tone="info" title={t("pendingBanner")} />
      ) : null}
      {submitted ? (
        <Banner tone="success" title={t("submittedBanner")} />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      {loadFailed ? (
        <Banner
          tone="danger"
          title={t("loadFailed")}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                void reload().finally(() => setLoading(false));
              }}
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
          <DetailList>
            <DetailRow label={t("form.licenseNo")}>
              <span className="font-mono">
                {state.latest.businessLicenseNo}
              </span>
            </DetailRow>
            <DetailRow label={t("form.legalName")}>
              {state.latest.legalPersonName}
            </DetailRow>
            <DetailRow label={t("current.verifiedAt")}>
              {state.latest.reviewedAt
                ? `${fmtDate(state.latest.reviewedAt)} ${fmtTime(state.latest.reviewedAt)}`
                : "—"}
            </DetailRow>
          </DetailList>
        </PageSection>
      ) : null}

      {/* 申请表单 */}
      <PageSection
        icon="file-text"
        level={2}
        title={status === "verified" ? t("form.retitleTitle") : t("form.title")}
        description={
          status === "verified"
            ? t("form.retitleDescription")
            : t("form.description")
        }
      >
        <div className="flex max-w-panel-md flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <FieldLabel htmlFor="verify-license-no">
              {t("form.licenseNo")} *
            </FieldLabel>
            <Input
              id="verify-license-no"
              value={licenseNo}
              disabled={!canSubmit || busy}
              onChange={(e) => setLicenseNo(e.target.value)}
              placeholder={t("form.licenseNoPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-xs">
            <FieldLabel htmlFor="verify-legal-name">
              {t("form.legalName")} *
            </FieldLabel>
            <Input
              id="verify-legal-name"
              value={legalName}
              disabled={!canSubmit || busy}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder={t("form.legalNamePlaceholder")}
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={
                !canSubmit || busy || !licenseNo.trim() || !legalName.trim()
              }
              onClick={() => void handleSubmit()}
            >
              {status === "pending"
                ? t("form.pendingLocked")
                : t("form.submit")}
            </Button>
          </div>
        </div>
      </PageSection>

      {/* 历史记录 */}
      <PageSection
        icon="clock-counter-clockwise"
        level={2}
        title={t("history.title")}
        description={t("history.description")}
      >
        <DataTable<ConsoleVerification>
          columns={historyColumns}
          rows={state?.history ?? []}
          rowKey={(r) => r.id}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("history.empty")} />}
        />
      </PageSection>

      {/* 口径说明 */}
      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            { title: t("notes.liteTitle"), description: t("notes.liteBody") },
            {
              title: t("notes.effectTitle"),
              description: t("notes.effectBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
