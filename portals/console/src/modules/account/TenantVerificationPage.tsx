"use client";

/**
 * TenantVerificationPage.tsx — 组织企业认证(owner 2026-08-21 P0;2026-09-06 三方式重排)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * spec 20-vxture-tenant-console-info §3.4 组织租户独立详情页。页面自上而下:
 * 认证方式(三张卡,能力对比)→ 当前认证信息(已认证)→ 提交表单 → 申请历史 → 说明。
 *
 * 三种方式(owner 2026-09-06),资料要求与能力各不同:
 *   1. 简易企业实名认证 —— 企业名称 + 统一社会信用代码 + 法定代表人姓名;
 *      **可订阅、不可开票**;本期唯一开放。
 *   2. 法人扫脸实名认证 —— 开发中,卡片占位禁用。
 *   3. 提交资料实名认证 —— 开发中,卡片占位禁用。
 *
 * 局限性要说在明处(owner:「需要提醒局限性」),页面三处提醒:方式卡的能力行、
 * 已认证时的横幅、提交表单的说明;开票入口另有一处(账单页申请开票弹窗)。
 * 后端同门:未开放的方式提交一律 400,简易认证申请开票一律 400——页面提示挡不住
 * 直接打接口的人(bff lib/verification-level 是唯一判定)。
 *
 * 提交 → pending → admin 既有台账审核 → 状态回流(approve 同步 tenants.
 * verification_status,租户信息页徽章即变)。pending 拒重复提交;rejected 显示驳回
 * 原因可重新提交;verified 后再提交 = 变更重审(spec 245)。
 * 个人实名(/profile/verification)另立项仍为骨架。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  DetailList,
  DetailRow,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
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
  type ConsoleVerificationMethod,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PlannedBadge } from "@/components/planned";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

const STATUS_TONES: Record<ConsoleVerification["status"], StatusBadgeTone> = {
  unverified: "neutral",
  pending: "info",
  verified: "success",
  rejected: "warning",
  // 批 5c:组织租户改名即作废原认证(设计 §5.1),历史里留一条「已作废」
  superseded: "danger",
};

/**
 * 三种方式的呈现次序与能力。`canInvoice` 是**说明**不是判据——真判据在 BFF
 * (lib/verification-level),这里只负责把差异摆给用户看。
 */
const METHODS: readonly {
  key: ConsoleVerificationMethod;
  icon: "file-text" | "user" | "folder";
  canInvoice: boolean;
}[] = [
  { key: "lite", icon: "file-text", canInvoice: false },
  // 扫脸没有对应图标(装着的 DS 10.1.0 无 camera / scan),用「人」表示核到本人
  { key: "face", icon: "user", canInvoice: true },
  { key: "documents", icon: "folder", canInvoice: true },
];

/** 每种方式要填 / 要交的东西,逐条列在卡里(文案键 methods.<key>.items.<n>)。 */
const METHOD_ITEM_COUNT: Record<ConsoleVerificationMethod, number> = {
  lite: 3,
  face: 2,
  documents: 3,
};

export function TenantVerificationPage() {
  const t = useTranslations("verificationPage.org");
  const { session } = useConsoleSession();

  const [state, setState] = useState<ConsoleTenantVerificationState | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [legalName, setLegalName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const companyRef = useRef<HTMLInputElement>(null);

  /* fetchTenantVerification 是 strict 读（2026-08-30）：此前失败回落成
   * "unverified"，页面会照常放开表单、徽章写「未认证」——把一次故障演成一个
   * 可以重新提交的干净状态。现在读不到就锁表单、明说、给重试。 */
  const reload = () =>
    fetchTenantVerification()
      .then((s) => {
        setState(s);
        setLoadFailed(false);
        // 企业名称:上次申报的优先,没有就用租户认证名托底(两者本就应当一致)
        setCompanyName(s.latest?.companyName ?? session.tenant?.name ?? "");
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
  const isAvailable = (m: ConsoleVerificationMethod) =>
    state?.availableMethods.includes(m) ?? m === "lite";
  /** 已按简易方式认证:能订阅但不能开票,这条要一直摆在明处。 */
  const liteVerified = status === "verified" && state?.level === "lite";

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setSubmitted(false);
    try {
      await submitTenantVerification({
        method: "lite",
        companyName: companyName.trim(),
        businessLicenseNo: licenseNo.trim(),
        legalPersonName: legalName.trim(),
      });
      setSubmitted(true);
      await reload();
    } catch (e) {
      setError(
        e instanceof ConsoleBffError && e.message
          ? e.message
          : t("submitFailed"),
      );
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
      id: "method",
      header: t("history.colMethod"),
      cell: (r) => t(`methods.${r.verificationMethod}.name`),
    },
    {
      id: "company",
      header: t("history.colCompany"),
      cell: (r) => r.companyName ?? "—",
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

  /** 能力行:一个图标 + 一句话,可与不可用同一形状,不用颜色单独承载信息。 */
  const capability = (ok: boolean, label: string) => (
    <span
      className={`flex items-center gap-xs text-body-sm ${
        ok ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      <Icon
        name={ok ? "check" : "x"}
        size="xs"
        fallback="placeholder"
        className={ok ? "text-success-text" : "text-muted-foreground"}
      />
      <span>{label}</span>
    </span>
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="seal-check"
        title={t("title")}
        description={t("description")}
        action={
          state ? (
            /* 已认证分两档(owner 2026-09-06):简易认证 / 实名认证 */
            <StatusBadge
              tone={
                status === "verified" && state.level === "lite"
                  ? "info"
                  : STATUS_TONES[status]
              }
            >
              {status === "verified"
                ? t(state.level === "lite" ? "status.lite" : "status.full")
                : t(`status.${status}`)}
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
      {/* 局限性提醒之一(owner 2026-09-06):已按简易方式认证 = 可订阅、不可开票 */}
      {liteVerified ? (
        <Banner
          tone="warning"
          title={t("liteLimitBanner")}
          description={t("liteLimitBannerBody")}
        />
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

      {/* 认证方式:三张卡摆能力差异;只有开放的那一种能进表单 */}
      <PageSection
        icon="shield-check"
        level={2}
        title={t("methods.title")}
        description={t("methods.description")}
      >
        <div className="grid gap-lg lg:grid-cols-3">
          {METHODS.map((m) => {
            const available = isAvailable(m.key);
            const active = liteVerified && m.key === "lite";
            return (
              <Card key={m.key} surface="soft" className="h-full">
                <CardHeader>
                  <span className="flex flex-wrap items-center gap-sm">
                    <Icon
                      name={m.icon}
                      size="sm"
                      fallback="placeholder"
                      className="text-muted-foreground"
                    />
                    <CardTitle>{t(`methods.${m.key}.name`)}</CardTitle>
                    {available ? (
                      <StatusBadge tone={active ? "success" : "info"}>
                        {active
                          ? t("methods.currentTag")
                          : t("methods.availableTag")}
                      </StatusBadge>
                    ) : (
                      <PlannedBadge />
                    )}
                  </span>
                  <CardDescription>
                    {t(`methods.${m.key}.summary`)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-md">
                  <div className="flex flex-col gap-2xs">
                    <span className="text-label-sm text-muted-foreground">
                      {t("methods.needLabel")}
                    </span>
                    <ul className="flex flex-col gap-2xs text-body-sm text-foreground">
                      {Array.from(
                        { length: METHOD_ITEM_COUNT[m.key] },
                        (_, i) => (
                          <li key={i} className="flex items-start gap-xs">
                            <Icon
                              name="circle-dashed"
                              size="xs"
                              fallback="placeholder"
                              className="mt-2xs shrink-0 text-muted-foreground"
                            />
                            <span>{t(`methods.${m.key}.items.${i}`)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2xs">
                    <span className="text-label-sm text-muted-foreground">
                      {t("methods.capabilityLabel")}
                    </span>
                    {capability(true, t("methods.canSubscribe"))}
                    {capability(
                      m.canInvoice,
                      m.canInvoice
                        ? t("methods.canInvoice")
                        : t("methods.cannotInvoice"),
                    )}
                  </div>
                </CardContent>
                <CardFooter className="justify-end">
                  <Button
                    size="sm"
                    variant={available ? "default" : "outline"}
                    disabled={!available || !canSubmit || busy}
                    onClick={() => companyRef.current?.focus()}
                  >
                    {available
                      ? t("methods.useThis")
                      : t("methods.inDevelopment")}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </PageSection>

      {/* 当前认证信息(verified 展示) */}
      {status === "verified" && state?.latest ? (
        <PageSection
          icon="seal-check"
          level={2}
          title={t("current.title")}
          description={t("current.description")}
        >
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
            <DetailRow label={t("form.legalName")}>
              {state.latest.legalPersonName}
            </DetailRow>
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
        </PageSection>
      ) : null}

      {/* 申请表单(本期只有简易方式) */}
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
          {/* 局限性提醒之二:表单里再说一次这条路径不能开票 */}
          <Banner tone="info" title={t("form.liteNotice")} />
          <Field>
            <FieldLabel htmlFor="verify-company-name">
              {t("form.companyName")} *
            </FieldLabel>
            <Input
              id="verify-company-name"
              ref={companyRef}
              value={companyName}
              disabled={!canSubmit || busy}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t("form.companyNamePlaceholder")}
            />
          </Field>
          <Field>
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
          </Field>
          <Field>
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
          </Field>
          <div className="flex justify-end">
            <Button
              disabled={
                !canSubmit ||
                busy ||
                !companyName.trim() ||
                !licenseNo.trim() ||
                !legalName.trim()
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
