"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Icon,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Banner,
  Button,
  DetailList,
  DetailRow,
  DialogForm,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  StatusBadge,
  Switch,
  Textarea,
  ViewHeader,
  ViewLayout,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useRouter } from "next/navigation";
import {
  deleteOrgLogo,
  fetchOrganizationProfile,
  orgLogoUrl,
  updateOrganization,
  uploadOrgLogo,
} from "@/api/console-bff";
import { IdentityCard } from "@/components/detail";
import { PageSection } from "@/layout/shell";
import type { ConsoleOrganizationProfile } from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
import { useLocale, useTranslations } from "next-intl";

const LOGO_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;
const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "GBP", "JPY", "HKD", "SGD"];
const LANGUAGE_OPTIONS = ["zh-CN", "en-US"];

/** Tenant lifecycle status → badge tone. */
const TENANT_STATUS_TONE: Record<
  ConsoleOrganizationProfile["status"],
  StatusBadgeTone
> = {
  trial: "warning",
  active: "success",
  suspended: "danger",
  cancelled: "neutral",
};

/** KYC verification status → badge tone. */
const VERIFIED_STATUS_TONE: Record<
  NonNullable<ConsoleOrganizationProfile["verifiedStatus"]>,
  StatusBadgeTone
> = {
  unverified: "neutral",
  pending: "warning",
  verified: "success",
  rejected: "danger",
};

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
    "Europe/London",
    "America/New_York",
  ];
}
const TIMEZONE_OPTIONS = listTimeZones();

type OrgForm = {
  description: string;
  industry: string;
  scale: string;
  website: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  countryCode: string;
  address: string;
  postalCode: string;
  isBillingRecipient: boolean;
  timezone: string;
  language: string;
  currency: string;
};

function emptyForm(p?: ConsoleOrganizationProfile | null): OrgForm {
  return {
    description: p?.description ?? "",
    industry: p?.industry ?? "",
    scale: p?.scale ?? "",
    website: p?.website ?? "",
    contactName: p?.contactName ?? "",
    contactRole: p?.contactRole ?? "",
    contactEmail: p?.contactEmail ?? "",
    contactPhone: p?.contactPhone ?? "",
    countryCode: p?.countryCode ?? "",
    address: p?.address ?? "",
    postalCode: p?.postalCode ?? "",
    isBillingRecipient: p?.isBillingRecipient ?? false,
    timezone: p?.timezone ?? "",
    language: p?.language ?? "",
    currency: p?.currency ?? "",
  };
}

function trimmed(value: string): string | null {
  return value.trim() || null;
}

function displayValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function formatOrganizationDate(
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

function organizationInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((segment) => segment[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function OrganizationPage() {
  const t = useTranslations("organizationPage");
  const locale = useLocale();
  const router = useRouter();
  const { session } = useConsoleSession();
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<ConsoleOrganizationProfile | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<OrgForm>(emptyForm());

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchOrganizationProfile()
      .then((data) => {
        if (!active) return;
        setProfile(data);
        setErrorKey(data ? null : "feedback.noProfile");
      })
      .catch(() => {
        if (active) setErrorKey("feedback.loadError");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, session.tenant?.mode]);

  const isPersonal = profile?.tenantType === "personal";

  function openEdit() {
    setForm(emptyForm(profile));
    setEditOpen(true);
    setErrorKey(null);
    setMessageKey(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    try {
      const updated = await updateOrganization({
        description: trimmed(form.description),
        industry: trimmed(form.industry),
        scale: trimmed(form.scale),
        website: trimmed(form.website),
        contactName: trimmed(form.contactName),
        contactRole: trimmed(form.contactRole),
        contactEmail: trimmed(form.contactEmail),
        contactPhone: trimmed(form.contactPhone),
        countryCode: trimmed(form.countryCode),
        address: trimmed(form.address),
        postalCode: trimmed(form.postalCode),
        isBillingRecipient: form.isBillingRecipient,
        timezone: trimmed(form.timezone),
        language: trimmed(form.language),
        currency: trimmed(form.currency),
      });
      setProfile(updated);
      setEditOpen(false);
      setMessageKey("feedback.saved");
    } catch {
      setErrorKey("feedback.saveError");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorKey("feedback.logoFileTypeError");
      return;
    }
    if (file.size > LOGO_UPLOAD_MAX_SIZE) {
      setErrorKey("feedback.logoFileSizeError");
      return;
    }
    setSubmitting(true);
    setErrorKey(null);
    try {
      await uploadOrgLogo(file);
      const refreshed = await fetchOrganizationProfile();
      setProfile(refreshed);
      setMessageKey("feedback.logoSaved");
    } catch {
      setErrorKey("feedback.logoUploadError");
    } finally {
      setSubmitting(false);
    }
  }

  async function clearLogo() {
    setSubmitting(true);
    setErrorKey(null);
    try {
      await deleteOrgLogo();
      const refreshed = await fetchOrganizationProfile();
      setProfile(refreshed);
      setMessageKey("feedback.logoCleared");
    } catch {
      setErrorKey("feedback.logoUploadError");
    } finally {
      setSubmitting(false);
    }
  }

  const empty = t("common.empty");
  const loadingText = t("common.loading");
  const baseTenantName =
    profile?.displayName || profile?.tenantName || session.tenant?.name || "";
  // Outward tenant label = "{name} {type}" (owner rule 2026-07-06).
  const displayName = displayValue(
    formatTenantDisplay(
      baseTenantName,
      profile?.tenantType ?? session.tenant?.tenantType,
    ),
    empty,
  );
  const logoInitials = organizationInitials(baseTenantName || "VX");
  const logoSrc = profile?.logoHash ? orgLogoUrl(profile.logoHash) : null;
  const status = profile ? t(`status.tenant.${profile.status}`) : empty;
  const statusTone: StatusBadgeTone = profile
    ? TENANT_STATUS_TONE[profile.status]
    : "neutral";
  const verifiedStatus = profile?.verifiedStatus
    ? t(`status.verified.${profile.verifiedStatus}`)
    : t("status.verified.unverified");
  const verifiedTone: StatusBadgeTone =
    VERIFIED_STATUS_TONE[profile?.verifiedStatus ?? "unverified"];
  const tenantType = profile ? t(`tenantType.${profile.tenantType}`) : empty;
  const createdAt = formatOrganizationDate(profile?.createdAt, locale, empty);
  const updatedAt = formatOrganizationDate(profile?.updatedAt, locale, empty);
  const region =
    [profile?.countryCode, profile?.address].filter(Boolean).join(" / ") ||
    empty;

  function readonlyRow(label: string, value: string) {
    return (
      <DetailRow label={label} key={label}>
        {loading ? loadingText : value}
      </DetailRow>
    );
  }

  return (
    <ViewLayout>
      <ViewHeader
        icon="building-library"
        title={t("header.title")}
        description={t("header.description")}
      />

      {messageKey ? <Banner tone="success" title={t(messageKey)} /> : null}
      {errorKey ? <Banner tone="danger" title={t(errorKey)} /> : null}

      {/* Logo + tenant identity card */}
      <PageSection
        title={t("sections.foundation.title")}
        icon="building"
        level={2}
        description={t("sections.foundation.description")}
        action={
          !isPersonal ? (
            <Button
              variant="outline"
              size="md"
              onClick={openEdit}
              disabled={!profile || loading || submitting}
            >
              <Icon name="edit" size="xs" fallback="placeholder" />
              <span>{t("actions.edit")}</span>
            </Button>
          ) : undefined
        }
      >
        <IdentityCard
          avatar={
            <Avatar className="size-full">
              {logoSrc ? (
                <AvatarImage
                  src={logoSrc}
                  alt={t("logo.alt", { name: displayName })}
                />
              ) : null}
              <AvatarFallback>
                <strong>{logoInitials}</strong>
              </AvatarFallback>
            </Avatar>
          }
          avatarLabel={t("logo.edit")}
          onAvatarClick={() => logoFileInputRef.current?.click()}
          avatarDisabled={submitting}
          name={loading ? loadingText : displayName}
          tags={
            loading ? null : (
              <StatusBadge tone={statusTone}>{status}</StatusBadge>
            )
          }
          meta={profile?.tenantCode || session.tenant?.tenantCode || empty}
          actions={
            <>
              <Button
                size="md"
                onClick={() => logoFileInputRef.current?.click()}
                disabled={submitting}
              >
                <Icon name="plus" size="xs" fallback="placeholder" />
                <span>{t("actions.uploadLogo")}</span>
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={clearLogo}
                disabled={!logoSrc || submitting}
              >
                <Icon name="x" size="xs" fallback="placeholder" />
                <span>{t("actions.clearLogo")}</span>
              </Button>
            </>
          }
        />
        <Input
          ref={logoFileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void handleLogoFile(event)}
        />

        <DetailList>
          {readonlyRow(t("fields.tenantCode"), profile?.tenantCode || empty)}
          {readonlyRow(t("fields.tenantType"), tenantType)}
          <DetailRow label={t("fields.tenantStatus")}>
            {loading ? (
              loadingText
            ) : (
              <StatusBadge tone={statusTone}>{status}</StatusBadge>
            )}
          </DetailRow>
          {readonlyRow(t("fields.createdAt"), createdAt)}
          {readonlyRow(
            t("fields.description"),
            displayValue(profile?.description, empty),
          )}
        </DetailList>
      </PageSection>

      {/* Personal tenant → verification summary + jump (spec §3.4) */}
      {isPersonal ? (
        <PageSection
          title={t("sections.verification.title")}
          icon="seal-check"
          level={2}
          description={t("sections.verification.personalHint")}
        >
          <DetailList>
            <DetailRow
              label={t("fields.verifiedStatus")}
              actions={
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => router.push("/profile/verification")}
                >
                  <Icon name="shield-check" size="xs" fallback="placeholder" />
                  <span>{t("actions.goVerify")}</span>
                </Button>
              }
            >
              {loading ? (
                loadingText
              ) : (
                <StatusBadge tone={verifiedTone}>{verifiedStatus}</StatusBadge>
              )}
            </DetailRow>
          </DetailList>
        </PageSection>
      ) : (
        <>
          {/* Organization → industry / scale / website */}
          <PageSection
            title={t("sections.business.title")}
            icon="certificate"
            level={2}
            description={t("sections.business.description")}
          >
            <DetailList>
              {readonlyRow(
                t("fields.industry"),
                displayValue(profile?.industry, empty),
              )}
              {readonlyRow(
                t("fields.scale"),
                displayValue(profile?.scale, empty),
              )}
              {readonlyRow(
                t("fields.website"),
                displayValue(profile?.website, empty),
              )}
            </DetailList>
          </PageSection>

          {/* Organization → admin / contact (spec §3.3) */}
          <PageSection
            title={t("sections.contact.title")}
            icon="user-circle"
            level={2}
            description={t("sections.contact.description")}
          >
            <DetailList>
              {readonlyRow(
                t("fields.contactName"),
                displayValue(profile?.contactName, empty),
              )}
              {readonlyRow(
                t("fields.contactRole"),
                displayValue(profile?.contactRole, empty),
              )}
              {readonlyRow(
                t("fields.contactEmail"),
                displayValue(profile?.contactEmail, empty),
              )}
              {readonlyRow(
                t("fields.contactPhone"),
                displayValue(profile?.contactPhone, empty),
              )}
              {readonlyRow(t("fields.region"), region)}
              {readonlyRow(
                t("fields.postalCode"),
                displayValue(profile?.postalCode, empty),
              )}
              <DetailRow label={t("fields.isBillingRecipient")}>
                {loading
                  ? loadingText
                  : profile?.isBillingRecipient
                    ? t("common.yes")
                    : t("common.no")}
              </DetailRow>
            </DetailList>
          </PageSection>

          {/* Organization → localization (tenant-level; WS inherits, spec §3.6) */}
          <PageSection
            title={t("sections.localization.title")}
            icon="translate"
            level={2}
            description={t("sections.localization.description")}
          >
            <DetailList>
              {readonlyRow(
                t("fields.timeZone"),
                displayValue(profile?.timezone, empty),
              )}
              {readonlyRow(
                t("fields.language"),
                displayValue(profile?.language, empty),
              )}
              {readonlyRow(
                t("fields.currency"),
                displayValue(profile?.currency, empty),
              )}
            </DetailList>
          </PageSection>

          {/* Organization → enterprise verification summary + jump (spec §3.4) */}
          <PageSection
            title={t("sections.verification.title")}
            icon="seal-check"
            level={2}
            description={t("sections.verification.orgHint")}
          >
            <DetailList>
              <DetailRow
                label={t("fields.verifiedStatus")}
                actions={
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => router.push("/organization/verification")}
                  >
                    <Icon
                      name="shield-check"
                      size="xs"
                      fallback="placeholder"
                    />
                    <span>{t("actions.goVerify")}</span>
                  </Button>
                }
              >
                {loading ? (
                  loadingText
                ) : (
                  <StatusBadge tone={verifiedTone}>
                    {verifiedStatus}
                  </StatusBadge>
                )}
              </DetailRow>
              {readonlyRow(t("fields.updatedAt"), updatedAt)}
            </DetailList>
          </PageSection>
        </>
      )}

      {/* Edit dialog (organization only) */}
      <DialogForm
        open={editOpen}
        onOpenChange={setEditOpen}
        size="lg"
        title={t("dialogs.edit.title")}
        description={t("dialogs.edit.description")}
        submitLabel={t("actions.save")}
        cancelLabel={t("actions.cancel")}
        submitting={submitting}
        onSubmit={submitEdit}
      >
        {/* Two-column field grid; wide fields span both columns. */}
        <FieldGroup className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="org-description">
              {t("fields.description")}
            </FieldLabel>
            <Textarea
              id="org-description"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((o) => ({ ...o, description: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-industry">
              {t("fields.industry")}
            </FieldLabel>
            <Input
              id="org-industry"
              value={form.industry}
              onChange={(e) =>
                setForm((o) => ({ ...o, industry: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-scale">{t("fields.scale")}</FieldLabel>
            <Input
              id="org-scale"
              value={form.scale}
              onChange={(e) =>
                setForm((o) => ({ ...o, scale: e.target.value }))
              }
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="org-website">{t("fields.website")}</FieldLabel>
            <Input
              id="org-website"
              value={form.website}
              onChange={(e) =>
                setForm((o) => ({ ...o, website: e.target.value }))
              }
              autoComplete="url"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-contact-name">
              {t("fields.contactName")}
            </FieldLabel>
            <Input
              id="org-contact-name"
              value={form.contactName}
              onChange={(e) =>
                setForm((o) => ({ ...o, contactName: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-contact-role">
              {t("fields.contactRole")}
            </FieldLabel>
            <Input
              id="org-contact-role"
              value={form.contactRole}
              onChange={(e) =>
                setForm((o) => ({ ...o, contactRole: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-contact-email">
              {t("fields.contactEmail")}
            </FieldLabel>
            <Input
              id="org-contact-email"
              type="email"
              value={form.contactEmail}
              onChange={(e) =>
                setForm((o) => ({ ...o, contactEmail: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-contact-phone">
              {t("fields.contactPhone")}
            </FieldLabel>
            <Input
              id="org-contact-phone"
              value={form.contactPhone}
              onChange={(e) =>
                setForm((o) => ({ ...o, contactPhone: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-country-code">
              {t("fields.countryCode")}
            </FieldLabel>
            <Input
              id="org-country-code"
              value={form.countryCode}
              onChange={(e) =>
                setForm((o) => ({ ...o, countryCode: e.target.value }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="org-postal-code">
              {t("fields.postalCode")}
            </FieldLabel>
            <Input
              id="org-postal-code"
              value={form.postalCode}
              onChange={(e) =>
                setForm((o) => ({ ...o, postalCode: e.target.value }))
              }
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="org-address">{t("fields.address")}</FieldLabel>
            <Input
              id="org-address"
              value={form.address}
              onChange={(e) =>
                setForm((o) => ({ ...o, address: e.target.value }))
              }
            />
          </Field>
          <Field orientation="horizontal" className="sm:col-span-2">
            <Switch
              id="org-billing-recipient"
              checked={form.isBillingRecipient}
              onCheckedChange={(checked) =>
                setForm((o) => ({
                  ...o,
                  isBillingRecipient: checked,
                }))
              }
            />
            <FieldLabel htmlFor="org-billing-recipient">
              {t("fields.isBillingRecipient")}
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="org-timezone">
              {t("fields.timeZone")}
            </FieldLabel>
            <NativeSelect
              id="org-timezone"
              value={form.timezone}
              onChange={(e) =>
                setForm((o) => ({ ...o, timezone: e.target.value }))
              }
            >
              <option value="">{t("common.empty")}</option>
              {form.timezone && !TIMEZONE_OPTIONS.includes(form.timezone) ? (
                <option value={form.timezone}>{form.timezone}</option>
              ) : null}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="org-language">
              {t("fields.language")}
            </FieldLabel>
            <NativeSelect
              id="org-language"
              value={form.language}
              onChange={(e) =>
                setForm((o) => ({ ...o, language: e.target.value }))
              }
            >
              <option value="">{t("common.empty")}</option>
              {LANGUAGE_OPTIONS.map((lng) => (
                <option key={lng} value={lng}>
                  {lng}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="org-currency">
              {t("fields.currency")}
            </FieldLabel>
            <NativeSelect
              id="org-currency"
              value={form.currency}
              onChange={(e) =>
                setForm((o) => ({ ...o, currency: e.target.value }))
              }
            >
              <option value="">{t("common.empty")}</option>
              {CURRENCY_OPTIONS.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
      </DialogForm>
    </ViewLayout>
  );
}
