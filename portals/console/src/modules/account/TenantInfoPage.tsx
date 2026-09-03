"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  type StatusBadgeTone,
  UserAvatar,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { ConnectedRow, IdentityCard } from "@/components/detail";
import { PageSection } from "@/layout/shell";
import {
  deleteOrgLogo,
  fetchMySubscriptions,
  fetchMyWorkspaces,
  fetchOrganizationProfile,
  orgLogoUrl,
  updateOrganization,
  uploadOrgLogo,
  type ConsoleSubscription,
} from "@/api/console-bff";
import type {
  ConsoleOrganizationProfile,
  ConsoleWorkspaceItem,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Feedback = {
  tone: "success" | "error";
  key: string;
} | null;

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "GBP", "JPY", "HKD", "SGD"];

/**
 * Record lists (subscriptions / workspaces) separate their rows with the same
 * dashed hairline `DetailList` uses, so both kinds of rows read as one system.
 */
const CONNECTED_LIST_CLASS =
  "flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20";

function displayValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

/** Canonical IANA timezone list, with a curated fallback for older runtimes. */
function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    // fall through to the curated list
  }
  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
  ];
}
const TIMEZONE_OPTIONS = listTimeZones();

/** Prefix an IANA zone with its current UTC offset, e.g. "UTC+08:00 Asia/Shanghai". */
function formatTimezone(value: string | null | undefined, fallback: string) {
  const tz = value?.trim();
  if (!tz) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "UTC");
    return offset ? `${offset} ${tz}` : tz;
  } catch {
    return tz;
  }
}

function formatProfileDate(
  value: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Tenant status → StatusBadge tone (same scale as the profile page). */
function statusTone(status: string | null | undefined): StatusBadgeTone {
  if (status === "suspended" || status === "cancelled") return "danger";
  if (status === "trial") return "warning";
  return "success";
}

function normalizeOptional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

export function TenantInfoPage() {
  const t = useTranslations("tenantPage");
  const locale = useLocale();
  const { session } = useConsoleSession();
  const router = useRouter();

  const [profile, setProfile] = useState<ConsoleOrganizationProfile | null>(
    null,
  );
  const [workspaces, setWorkspaces] = useState<ConsoleWorkspaceItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<ConsoleSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  // Separate flag for the second fetch (workspaces + subscriptions) so the
  // §四/§五 empty-states don't flash before that round-trip resolves.
  const [extrasLoading, setExtrasLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [localeForm, setLocaleForm] = useState({
    language: "",
    timezone: "",
    currency: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchOrganizationProfile()
      .then((data) => {
        if (!active) return;
        setProfile(data);
        if (!data) setFeedback({ tone: "error", key: "feedback.noProfile" });
      })
      .catch(() => {
        if (active) setFeedback({ tone: "error", key: "feedback.loadError" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return; // wait for the profile fetch to settle first
    if (!profile?.tenantId) {
      setExtrasLoading(false);
      return;
    }
    let active = true;
    setExtrasLoading(true);
    void Promise.all([fetchMyWorkspaces(), fetchMySubscriptions()])
      .then(([ws, subs]) => {
        if (!active) return;
        setWorkspaces(ws);
        setSubscriptions(subs);
      })
      .finally(() => {
        if (active) setExtrasLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loading, profile?.tenantId]);

  function resetFeedback() {
    setFeedback(null);
  }

  function languageLabel(value: string | null | undefined) {
    if (!value) return empty;
    if (value === "zh-CN") return t("language.zhCN");
    if (value === "en-US") return t("language.enUS");
    return value;
  }

  function openLocaleDialog() {
    if (!profile) return;
    setLocaleForm({
      language: profile.language ?? "",
      timezone: profile.timezone ?? "",
      currency: profile.currency ?? "",
    });
    setLocaleDialogOpen(true);
    resetFeedback();
  }

  async function submitLocale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await updateOrganization({
        language: normalizeOptional(localeForm.language),
        timezone: normalizeOptional(localeForm.timezone),
        currency: normalizeOptional(localeForm.currency),
      });
      setProfile(updated);
      setLocaleDialogOpen(false);
      setFeedback({ tone: "success", key: "feedback.localizationSaved" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.localizationSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogoSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    if (!LOGO_ACCEPT.split(",").includes(file.type)) {
      setFeedback({ tone: "error", key: "feedback.logoFileTypeError" });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFeedback({ tone: "error", key: "feedback.logoFileSizeError" });
      return;
    }
    setSubmitting(true);
    resetFeedback();
    try {
      const { logoHash } = await uploadOrgLogo(file);
      setProfile({ ...profile, logoHash });
      setFeedback({ tone: "success", key: "feedback.logoSaved" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.logoUploadError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLogo() {
    if (!profile?.logoHash) return;
    setSubmitting(true);
    resetFeedback();
    try {
      await deleteOrgLogo();
      setProfile({ ...profile, logoHash: null });
      setFeedback({ tone: "success", key: "feedback.logoCleared" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.logoUploadError" });
    } finally {
      setSubmitting(false);
    }
  }

  const empty = t("common.empty");
  const loadingText = t("common.loading");
  // Outward tenant label = "{name} {type}" (owner rule 2026-07-06).
  const tenantName = displayValue(
    formatTenantDisplay(
      profile?.displayName || profile?.tenantName || session.tenant?.name,
      profile?.tenantType ?? session.tenant?.tenantType,
    ),
    empty,
  );
  const tenantCode = displayValue(profile?.tenantCode, empty);
  const statusLabel = (status: string | null | undefined) =>
    status ? t(`status.${status}`) : empty;
  const typeLabel = (type: string | null | undefined) =>
    type ? t(`type.${type}`) : empty;
  const description = displayValue(profile?.description, empty);
  const createdAt = formatProfileDate(profile?.createdAt, locale, empty);
  const language = languageLabel(profile?.language);
  const timezone = formatTimezone(profile?.timezone, empty);
  const currency = displayValue(profile?.currency, empty);
  const logoSrc = profile?.logoHash
    ? orgLogoUrl(profile.logoHash)
    : "/assets/icons/tenant-default.png";
  const tenantWorkspaces = workspaces.filter(
    (ws) => ws.tenantId === profile?.tenantId,
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="buildings"
        title={t("header.title")}
        description={t("header.description")}
      />

      {feedback ? (
        <Banner
          tone={feedback.tone === "success" ? "success" : "danger"}
          title={t(feedback.key)}
        />
      ) : null}

      <Input
        ref={fileInputRef}
        type="file"
        accept={LOGO_ACCEPT}
        hidden
        onChange={(event) => void handleLogoSelect(event)}
      />

      {/* ── §一 Header card (logo | name + status/type tags | actions) ──────── */}
      <IdentityCard
        avatar={
          <UserAvatar
            className="size-full"
            src={logoSrc}
            alt={t("logo.alt", { name: tenantName })}
          />
        }
        avatarLabel={t("actions.uploadLogo")}
        onAvatarClick={() => fileInputRef.current?.click()}
        avatarDisabled={!profile || submitting}
        name={loading ? loadingText : tenantName}
        tags={
          <>
            {profile?.status ? (
              <StatusBadge tone={statusTone(profile.status)}>
                {statusLabel(profile.status)}
              </StatusBadge>
            ) : null}
            {profile?.tenantType ? (
              <StatusBadge tone="neutral">
                {typeLabel(profile.tenantType)}
              </StatusBadge>
            ) : null}
          </>
        }
        meta={`${t("fields.tenantId")}: ${loading ? loadingText : tenantCode}`}
        actions={
          <Button
            variant="outline"
            size="md"
            onClick={() => void removeLogo()}
            disabled={submitting || !profile?.logoHash}
          >
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("actions.clearLogo")}</span>
          </Button>
        }
      />

      {/* ── §二 Tenant info (read-only identity rows) ───────────────────────── */}
      <PageSection
        title={t("sections.info.title")}
        icon="building"
        level={2}
        description={t("sections.info.description")}
      >
        <DetailList>
          <DetailRow label={t("fields.tenantName")}>
            {loading ? loadingText : tenantName}
          </DetailRow>
          <DetailRow label={t("fields.tenantId")}>
            {loading ? loadingText : tenantCode}
          </DetailRow>
          <DetailRow label={t("fields.tenantType")}>
            {loading ? loadingText : typeLabel(profile?.tenantType)}
          </DetailRow>
          <DetailRow label={t("fields.status")}>
            {loading ? (
              loadingText
            ) : profile?.status ? (
              <StatusBadge tone={statusTone(profile.status)}>
                {statusLabel(profile.status)}
              </StatusBadge>
            ) : (
              empty
            )}
          </DetailRow>
          <DetailRow label={t("fields.createdAt")}>
            {loading ? loadingText : createdAt}
          </DetailRow>
          <DetailRow label={t("fields.description")}>
            {loading ? loadingText : description}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* ── §三 Localization (the one editable section) ─────────────────────── */}
      <PageSection
        title={t("sections.localization.title")}
        icon="translate"
        level={2}
        description={t("sections.localization.description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={openLocaleDialog}
            disabled={!profile}
          >
            <Icon name="edit" size="xs" fallback="placeholder" />
            <span>{t("actions.edit")}</span>
          </Button>
        }
      >
        <DetailList>
          <DetailRow label={t("fields.language")}>
            {loading ? loadingText : language}
          </DetailRow>
          <DetailRow label={t("fields.timezone")}>
            {loading ? loadingText : timezone}
          </DetailRow>
          <DetailRow label={t("fields.currency")}>
            {loading ? loadingText : currency}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* ── §四 Subscription ────────────────────────────────────────────────── */}
      <PageSection
        title={t("sections.subscription.title")}
        icon="sparkles"
        level={2}
        description={t("sections.subscription.description")}
      >
        {subscriptions.length === 0 ? (
          <EmptyState
            title={
              loading || extrasLoading
                ? loadingText
                : t("sections.subscription.empty")
            }
          />
        ) : (
          <div className={CONNECTED_LIST_CLASS}>
            {subscriptions.map((sub) => (
              <ConnectedRow
                key={sub.id}
                logo={<Icon name="sparkles" size="sm" fallback="placeholder" />}
                title={sub.planName}
                status={
                  <StatusBadge tone={sub.isTrial ? "warning" : "success"}>
                    {sub.isTrial
                      ? t("subscription.trial")
                      : t("subscription.active")}
                  </StatusBadge>
                }
                description={sub.planId}
                meta={[
                  {
                    label: t("fields.price"),
                    value: Number.isFinite(Number(sub.price))
                      ? `${Number(sub.price).toFixed(2)} ${sub.currency}`
                      : `— ${sub.currency}`,
                  },
                  {
                    label: t("fields.nextBilling"),
                    value: formatProfileDate(
                      sub.nextBillingDate,
                      locale,
                      empty,
                    ),
                  },
                ]}
                actions={
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => router.push("/subscription")}
                  >
                    {t("actions.viewPlans")}
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </PageSection>

      {/* ── §五 Workspaces (this tenant) ────────────────────────────────────── */}
      <PageSection
        title={t("sections.workspaces.title")}
        icon="buildings"
        level={2}
        description={t("sections.workspaces.description")}
      >
        {tenantWorkspaces.length === 0 ? (
          <EmptyState
            title={
              loading || extrasLoading
                ? loadingText
                : t("sections.workspaces.empty")
            }
          />
        ) : (
          <div className={CONNECTED_LIST_CLASS}>
            {tenantWorkspaces.map((ws) => {
              const roleLabel = ["owner", "manager", "member"].includes(ws.role)
                ? t(`workspaces.role.${ws.role}`)
                : ws.role;
              const joinedAt = formatProfileDate(ws.joinedAt, locale, empty);
              const workspaceName = ws.workspaceName ?? ws.tenantName;
              const workspaceId = ws.workspaceId ?? ws.tenantId;
              const isDefault = ws.tenantType === "personal";
              return (
                <ConnectedRow
                  key={ws.tenantId}
                  title_={workspaceName}
                  logo={
                    <Icon name="buildings" size="sm" fallback="placeholder" />
                  }
                  title={workspaceName}
                  {...(isDefault
                    ? {
                        status: (
                          <StatusBadge tone="neutral">
                            {t("workspaces.defaultTag")}
                          </StatusBadge>
                        ),
                      }
                    : {})}
                  description={<span title={workspaceId}>{workspaceId}</span>}
                  meta={[
                    { label: t("fields.role"), value: roleLabel },
                    { label: t("fields.joinedAt"), value: joinedAt },
                  ]}
                />
              );
            })}
          </div>
        )}
      </PageSection>

      {/* ── Localization edit dialog ────────────────────────────────────────── */}
      {localeDialogOpen ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center p-lg"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.localization.title")}
        >
          <div
            className="absolute inset-0 bg-scrim supports-backdrop-filter:backdrop-blur-xs"
            onClick={() => setLocaleDialogOpen(false)}
          />
          <form
            className="relative flex w-full max-w-panel-md flex-col gap-lg rounded-xl bg-popover p-xl text-foreground shadow-dialog ring-1 ring-foreground/10"
            onSubmit={(event) => void submitLocale(event)}
          >
            <header className="flex flex-col gap-2xs">
              <h3 className="text-title-md text-foreground">
                {t("dialogs.localization.title")}
              </h3>
              <FieldDescription>
                {t("dialogs.localization.description")}
              </FieldDescription>
            </header>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tenant-locale-language">
                  {t("fields.language")}
                </FieldLabel>
                <NativeSelect
                  id="tenant-locale-language"
                  value={localeForm.language}
                  onChange={(event) =>
                    setLocaleForm((old) => ({
                      ...old,
                      language: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("common.empty")}</option>
                  <option value="zh-CN">{t("language.zhCN")}</option>
                  <option value="en-US">{t("language.enUS")}</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="tenant-locale-timezone">
                  {t("fields.timezone")}
                </FieldLabel>
                <NativeSelect
                  id="tenant-locale-timezone"
                  value={localeForm.timezone}
                  onChange={(event) =>
                    setLocaleForm((old) => ({
                      ...old,
                      timezone: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("common.empty")}</option>
                  {localeForm.timezone &&
                  !TIMEZONE_OPTIONS.includes(localeForm.timezone) ? (
                    <option value={localeForm.timezone}>
                      {localeForm.timezone}
                    </option>
                  ) : null}
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="tenant-locale-currency">
                  {t("fields.currency")}
                </FieldLabel>
                <NativeSelect
                  id="tenant-locale-currency"
                  value={localeForm.currency}
                  onChange={(event) =>
                    setLocaleForm((old) => ({
                      ...old,
                      currency: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("common.empty")}</option>
                  {localeForm.currency &&
                  !CURRENCY_OPTIONS.includes(localeForm.currency) ? (
                    <option value={localeForm.currency}>
                      {localeForm.currency}
                    </option>
                  ) : null}
                  {CURRENCY_OPTIONS.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap items-center justify-end gap-sm">
              <Button
                variant="outline"
                onClick={() => setLocaleDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </ViewLayout>
  );
}
