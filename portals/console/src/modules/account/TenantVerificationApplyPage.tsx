"use client";

/**
 * TenantVerificationApplyPage.tsx — 企业认证**提交**页(owner 2026-09-06:提交与结果拆开)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/tenant/verification/apply`。这一页只做一件事:选方式、填表、提交。
 * 认证结果(当前认证信息 / 申请历史 / 认证说明)在 `/tenant/verification`,两页不混在一起
 * ——此前一屏里既是结果又是表单,已认证的人还得在下面看见一张空表。
 *
 * 三种方式的资料要求见 verification-methods;本期只有简易企业实名认证可提交,另两种
 * 卡片占位标「开发中」并禁用。局限性(简易认证可订阅、不可开票)在方式卡与表单里各说一次。
 * 提交成功回结果页——状态、历史都在那边,不在这里再画一遍。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Icon,
  Input,
  RadioGroup,
  RadioGroupItem,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  cn,
} from "@vxture/design-system";
import {
  fetchTenantVerification,
  submitTenantVerification,
  ConsoleBffError,
  type ConsoleTenantVerificationState,
  type ConsoleVerificationMethod,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PlannedBadge } from "@/components/planned";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import { CardRows } from "@/modules/account/profile/CardRows";
import { VERIFICATION_METHODS } from "./verification-methods";

export function TenantVerificationApplyPage() {
  const t = useTranslations("verificationPage.org");
  const { session } = useConsoleSession();
  const router = useRouter();

  const [state, setState] = useState<ConsoleTenantVerificationState | null>(
    null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  /** 选中的认证方式(owner 2026-09-06:方式可选中,下方资料填写与提交跟着它走)。
      本期只有 lite 可选,另两种卡片禁用、选不中。 */
  const [method, setMethod] = useState<ConsoleVerificationMethod>("lite");
  const [companyName, setCompanyName] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  /* strict 读:读不到就锁表单、明说、给重试——回落成「未认证」等于把一次故障
     演成一个可以重新提交的干净状态(2026-08-30 的修正,拆页后同样成立)。 */
  useEffect(() => {
    let active = true;
    fetchTenantVerification()
      .then((s) => {
        if (!active) return;
        setState(s);
        setLoadFailed(false);
        /* 企业名称只回填**上次申报过的**值:session.tenant.name 是简称优先的
           展示名,拿它预填等于诱导用户拿简称去认证。 */
        setCompanyName(s.latest?.companyName ?? "");
        if (s.latest?.businessLicenseNo)
          setLicenseNo(s.latest.businessLicenseNo);
      })
      .catch(() => {
        if (!active) return;
        setState(null);
        setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id]);

  const status = state?.status ?? "unverified";
  const isOrganization = session.tenant?.tenantType === "organization";
  const canSubmit = state !== null && status !== "pending" && isOrganization;
  const isAvailable = (m: ConsoleVerificationMethod) =>
    state?.availableMethods.includes(m) ?? m === "lite";

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 简易认证只两项(owner 2026-09-06):法定代表人姓名已去掉,后端也不再必填
      await submitTenantVerification({
        method,
        companyName: companyName.trim(),
        businessLicenseNo: licenseNo.trim(),
      });
      // 提交完回结果页:状态与历史都在那边,这一页不承载结果
      router.push("/tenant/verification");
    } catch (e) {
      setError(
        e instanceof ConsoleBffError && e.message
          ? e.message
          : t("submitFailed"),
      );
      setBusy(false);
    }
  };

  /** 能力行:一个图标 + 一句话;可与不可用同一形状,不靠颜色单独承载信息。 */
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
        icon="file-text"
        title={t("apply.title")}
        description={t("apply.description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/tenant/verification")}
          >
            <Icon name="arrow-left" size="xs" fallback="placeholder" />
            <span>{t("apply.backToResult")}</span>
          </Button>
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
      {error ? <Banner tone="danger" title={error} /> : null}
      {loadFailed ? <Banner tone="danger" title={t("loadFailed")} /> : null}

      {/* 认证方式:三张卡摆能力差异;只有开放的那一种能进表单 */}
      <PageSection
        icon="shield-check"
        level={2}
        title={t("methods.title")}
        description={t("methods.description")}
      >
        <CardRows>
          {/* 单选组:卡片可选中,下方资料填写与提交跟着选中的方式走(owner 2026-09-06)。
              整张卡是 label——点卡面任意处即选中;开发中的方式 disabled,选不动。 */}
          <RadioGroup
            value={method}
            onValueChange={(v) => {
              setMethod(v as ConsoleVerificationMethod);
              // 选中即把光标送到下面第一格——「关联下方填写」要看得见,不是一句话
              companyRef.current?.focus();
            }}
            aria-label={t("methods.title")}
            className="grid gap-lg lg:grid-cols-3"
          >
            {VERIFICATION_METHODS.map((m) => {
              const available = isAvailable(m.key);
              const selected = method === m.key;
              return (
                <label
                  key={m.key}
                  htmlFor={`verify-method-${m.key}`}
                  className={cn(
                    "block h-full",
                    available ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <Card
                    surface="soft"
                    className={cn(
                      "h-full",
                      selected && available
                        ? "ring-2 ring-primary"
                        : "ring-1 ring-foreground/10",
                      !available && "opacity-disabled",
                    )}
                  >
                    <CardHeader>
                      <span className="flex flex-wrap items-center gap-sm">
                        <RadioGroupItem
                          id={`verify-method-${m.key}`}
                          value={m.key}
                          disabled={!available}
                          aria-label={t(`methods.${m.key}.name`)}
                        />
                        <Icon
                          name={m.icon}
                          size="sm"
                          fallback="placeholder"
                          className="text-muted-foreground"
                        />
                        <CardTitle>{t(`methods.${m.key}.name`)}</CardTitle>
                        {available ? (
                          <StatusBadge tone={selected ? "brand" : "info"}>
                            {selected
                              ? t("methods.selectedTag")
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
                          {Array.from({ length: m.itemCount }, (_, i) => (
                            <li key={i} className="flex items-start gap-xs">
                              <Icon
                                name="circle-dashed"
                                size="xs"
                                fallback="placeholder"
                                className="mt-2xs shrink-0 text-muted-foreground"
                              />
                              <span>{t(`methods.${m.key}.items.${i}`)}</span>
                            </li>
                          ))}
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
                  </Card>
                </label>
              );
            })}
          </RadioGroup>
        </CardRows>
      </PageSection>

      {/* 申请资料:跟着上面选中的方式走 */}
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
        <CardRows>
          <div className="flex max-w-panel-md flex-col gap-sm">
            {/* 与上方选中项的关联:这一段填的是哪种方式的资料,写在明处 */}
            <p className="text-body-sm text-muted-foreground">
              {t("form.selectedMethod", {
                method: t(`methods.${method}.name`),
              })}
            </p>
            {/* 局限性:表单里再说一次这条路径不能开票 */}
            {method === "lite" ? (
              <Banner tone="info" title={t("form.liteNotice")} />
            ) : null}
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
            <div className="flex justify-end gap-sm">
              <Button
                variant="outline"
                size="md"
                disabled={busy}
                onClick={() => router.push("/tenant/verification")}
              >
                {t("apply.cancel")}
              </Button>
              <Button
                disabled={
                  !canSubmit || busy || !companyName.trim() || !licenseNo.trim()
                }
                onClick={() => void handleSubmit()}
              >
                {status === "pending"
                  ? t("form.pendingLocked")
                  : t("form.submit")}
              </Button>
            </div>
          </div>
        </CardRows>
      </PageSection>
    </ViewLayout>
  );
}
