/**
 * CustomerProfileEditor.tsx - account profile, avatar and personal preferences.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { formatDay, formatPrincipalNoOr } from "@vxture-platform/shared";
import { useEffect, useId, useRef, useState } from "react";
import { downscaleImage } from "@vxture/platform-browser";
import {
  Banner,
  Button,
  DialogForm,
  Input,
  NativeSelect,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  useTheme,
  useToast,
  StatusBadge,
} from "@vxture/design-system";
import { useRouter } from "next/navigation";
import { setAccountsLocale } from "@/lib/locale-preference";
import {
  accountsRequest,
  type CustomerProfile,
  type CustomerSecurity,
} from "@/api/customer-self";
import {
  AccountSection,
  AccountRow,
  AccountActions,
} from "./AccountPrimitives";

// ============================================================================
// Profile and avatar
// ============================================================================
const BASE = process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/** Render editable identity data without exposing tenant-specific profile fields. */
export function CustomerProfileEditor({
  profile,
  onSaved,
  security,
}: {
  profile: CustomerProfile;
  security: CustomerSecurity | null;
  onSaved: () => void;
}) {
  const formText = useTranslations("accountsForms");
  const accountText = useTranslations("accountCenter");
  const locale = useLocale();
  const { toast } = useToast();
  const [name, setName] = useState(profile.name ?? "");
  const [savedName, setSavedName] = useState(profile.name ?? "");
  const [gender, setGender] = useState(profile.gender ?? "");
  const [savedGender, setSavedGender] = useState(profile.gender ?? "");
  const [refreshPending, setRefreshPending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const genderId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [resetAvatar, setResetAvatar] = useState(false);
  function openAvatar() {
    setName(profile.name ?? "");
    setSavedName(profile.name ?? "");
    setGender(profile.gender ?? "");
    setSavedGender(profile.gender ?? "");
    setRefreshPending(false);
    setFile(null);
    setResetAvatar(false);
    setError("");
    setAvatarOpen(true);
  }
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function selectImage(next: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type)) {
      setError(formText("choose_a_png_jpeg_or_webp_image_no_larger_than_1mb"));
      return;
    }
    if (next.size > 20 * 1024 * 1024) {
      setError(formText("avatar_source_too_large"));
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const image = await downscaleImage(next);
      if (image.size > 1048576) {
        setError(
          formText("choose_a_png_jpeg_or_webp_image_no_larger_than_1mb"),
        );
        return;
      }
      setFile(image);
      setResetAvatar(false);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : formText("unable_to_save"),
      );
    } finally {
      setProcessing(false);
    }
  }
  async function saveProfile() {
    if (busy || processing) return;
    setBusy(true);
    setError("");
    let profileChanged = false;
    try {
      if (name.trim() !== savedName || gender !== savedGender) {
        await accountsRequest("/oidc/customer/self", {
          method: "PATCH",
          body: JSON.stringify({
            ...(name.trim() !== savedName ? { name: name.trim() } : {}),
            ...(gender !== savedGender ? { gender } : {}),
          }),
        });
        setSavedName(name.trim());
        setSavedGender(gender);
        setRefreshPending(true);
        profileChanged = true;
      }
      if (resetAvatar)
        await accountsRequest("/api/me/avatar", { method: "DELETE" });
      else if (file)
        await accountsRequest("/api/me/avatar", {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
      setAvatarOpen(false);
      toast({ tone: "success", title: formText("saved") });
      onSaved();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : formText("unable_to_save");
      setError(
        profileChanged || refreshPending
          ? formText("profile_partial_save", { message })
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
  const currentPicture = profile.avatarHash
    ? `${BASE}/avatar/usr_${profile.id}?v=${encodeURIComponent(profile.avatarHash)}`
    : "";
  const picture = resetAvatar ? "" : preview || currentPicture;
  const avatar = (src: string) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={formText("avatar")}
        width={96}
        height={96}
        className="rounded-full object-cover"
      />
    ) : (
      <span>{(profile.name || profile.account).slice(0, 1).toUpperCase()}</span>
    );
  return (
    <>
      <div className="accounts-identity">
        <Button
          variant="ghost"
          className="accounts-identity-avatar"
          aria-label={formText("change_avatar")}
          onClick={openAvatar}
        >
          {avatar(currentPicture)}
        </Button>
        <div>
          <h2>{profile.name || profile.account}</h2>
          <div className="accounts-identity-meta">
            <span>{formatPrincipalNoOr(profile.userNo, "user", "—")}</span>
            {profile.createdAt ? (
              <span>
                {accountText("createdAt")} ·{" "}
                {formatDay(profile.createdAt, locale)}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="accounts-identity-edit"
          onClick={openAvatar}
        >
          {formText("edit")}
        </Button>
      </div>
      <AccountSection title={formText("basic_information")} icon="user">
        <AccountRow label={formText("name")}>
          {profile.name || "—"}
          {profile.gender ? (
            <span
              role="img"
              aria-label={formText(profile.gender)}
              title={formText(profile.gender)}
            >
              {" "}
              {profile.gender === "male" ? "♂" : "♀"}
            </span>
          ) : null}
        </AccountRow>
        {profile.status ? (
          <AccountRow label={formText("account_status")}>
            <StatusBadge
              tone={profile.status === "active" ? "success" : "warning"}
            >
              {formText(
                profile.status === "active"
                  ? "account_status_active"
                  : profile.status === "deleting"
                    ? "account_status_deleting"
                    : "account_status_unknown",
              )}
            </StatusBadge>
          </AccountRow>
        ) : null}
        <AccountRow label={formText("account")}>{profile.account}</AccountRow>
        {(["phone", "email"] as const).map((kind) => (
          <AccountRow key={kind} label={formText(kind)}>
            <div className="accounts-profile-contact">
              <span>{security?.[kind] || "—"}</span>
              {security?.[kind] ? (
                <StatusBadge
                  tone={
                    security[
                      kind === "phone" ? "phoneVerified" : "emailVerified"
                    ]
                      ? "success"
                      : "neutral"
                  }
                >
                  {formText(
                    security[
                      kind === "phone" ? "phoneVerified" : "emailVerified"
                    ]
                      ? "verified"
                      : "unverified",
                  )}
                </StatusBadge>
              ) : null}
            </div>
          </AccountRow>
        ))}
      </AccountSection>
      <CustomerPreferences profile={profile} />
      <DialogForm
        size="sm"
        title={formText("edit_profile")}
        submitLabel={formText("save")}
        cancelLabel={formText("cancel")}
        submitting={busy}
        submitDisabled={
          processing ||
          !name.trim() ||
          (name.trim() === savedName &&
            gender === savedGender &&
            !file &&
            !resetAvatar)
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (!processing) void saveProfile();
        }}
        open={avatarOpen}
        onOpenChange={(open) => {
          if (!busy && !processing) {
            setAvatarOpen(open);
            if (!open && refreshPending) onSaved();
          }
        }}
      >
        <div className="accounts-profile-editor" aria-busy={processing || busy}>
          <div className="accounts-profile-avatar-editor">
            <div className="accounts-avatar-preview">{avatar(picture)}</div>
            <div className="accounts-profile-upload-actions">
              <Input
                ref={fileInput}
                type="file"
                hidden
                className="hidden"
                aria-label={formText("choose_image")}
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || processing}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  event.target.value = "";
                  if (next) void selectImage(next);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || processing}
                onClick={() => fileInput.current?.click()}
              >
                {formText(processing ? "processing_image" : "choose_image")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="accounts-avatar-reset"
                disabled={busy || processing || (!file && !currentPicture)}
                onClick={() => {
                  setFile(null);
                  setResetAvatar(Boolean(currentPicture));
                  setError("");
                }}
              >
                {formText("restore_default")}
              </Button>
            </div>
            <p className="accounts-profile-upload-hint">
              {formText("avatar_upload_hint")}
            </p>
          </div>
          <div className="accounts-profile-name-editor">
            <label htmlFor={nameId}>
              {formText("name")}
              <span className="accounts-required" aria-hidden="true">
                {" "}
                *
              </span>
            </label>
            <Input
              id={nameId}
              required
              maxLength={100}
              value={name}
              disabled={busy || processing}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset disabled={busy || processing}>
            <legend>{formText("gender")}</legend>
            <RadioGroup
              value={gender || "unset"}
              aria-label={formText("gender")}
              className="flex flex-wrap items-center gap-md"
              onValueChange={(value) => {
                if (value === "male" || value === "female") setGender(value);
                else if (value === "unset") setGender("");
              }}
            >
              {(["male", "female", "unset"] as const).map((value) => {
                const label = formText(value === "unset" ? "not_set" : value);
                return (
                  <label
                    key={value}
                    htmlFor={`${genderId}-${value}`}
                    title={label}
                    className="flex cursor-pointer items-center gap-xs"
                  >
                    <RadioGroupItem
                      id={`${genderId}-${value}`}
                      value={value}
                      aria-label={label}
                    />
                    <span aria-hidden="true">
                      {value === "male" ? "♂" : value === "female" ? "♀" : "—"}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </fieldset>
          {error ? <Banner tone="danger" title={error} /> : null}
        </div>
      </DialogForm>
    </>
  );
}

// ============================================================================
// Console-aligned personal preferences
// ============================================================================
function CustomerPreferences({ profile }: { profile: CustomerProfile }) {
  const formText = useTranslations("accountsForms");
  const { toast } = useToast();
  const theme = useTheme();
  const router = useRouter();
  const [language, setLanguage] = useState(profile.language || "zh-CN");
  const [timezone, setTimezone] = useState(profile.timezone || "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await accountsRequest("/oidc/customer/self", {
        method: "PATCH",
        body: JSON.stringify({ language, timezone }),
      });
      setAccountsLocale(language === "en-US" ? "en-US" : "zh-CN");
      toast({ tone: "success", title: formText("saved") });
      router.refresh();
    } catch (e) {
      toast({
        tone: "danger",
        title: formText("unable_to_save"),
        ...(e instanceof Error ? { description: e.message } : {}),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountSection title={formText("preferences")} icon="faders">
      <AccountRow label={formText("language")}>
        <NativeSelect
          aria-label={formText("language")}
          wrapperClassName="accounts-preference-control"
          value={language}
          disabled={busy}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="zh-CN">{formText("simplified_chinese")}</option>
          <option value="en-US">English</option>
        </NativeSelect>
      </AccountRow>
      <AccountRow label={formText("time_zone")}>
        <NativeSelect
          aria-label={formText("time_zone")}
          wrapperClassName="accounts-preference-control"
          value={timezone}
          disabled={busy}
          onChange={(e) => setTimezone(e.target.value)}
        >
          <option value="">{formText("not_set")}</option>
          {Array.from(
            new Set([
              timezone,
              "Asia/Shanghai",
              "Asia/Hong_Kong",
              "Asia/Tokyo",
              "Asia/Singapore",
              "UTC",
              "Europe/London",
              "America/New_York",
              "America/Los_Angeles",
            ]),
          )
            .filter(Boolean)
            .map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
        </NativeSelect>
      </AccountRow>
      <AccountRow label={formText("theme")}>
        <SegmentedControl
          className="accounts-preference-control"
          size="md"
          fill
          ariaLabel={formText("theme")}
          value={theme.theme}
          onChange={theme.setTheme}
          items={[
            { value: "system", label: formText("system") },
            { value: "light", label: formText("light") },
            { value: "dark", label: formText("dark") },
          ]}
        />
      </AccountRow>
      <AccountRow label={formText("density")}>
        <SegmentedControl
          className="accounts-preference-control"
          size="md"
          fill
          ariaLabel={formText("density")}
          value={theme.density}
          onChange={theme.setDensity}
          items={[
            { value: "compact", label: formText("compact") },
            { value: "default", label: formText("default") },
            { value: "comfortable", label: formText("comfortable") },
          ]}
        />
      </AccountRow>
      <AccountRow label={formText("text_size")}>
        <SegmentedControl
          className="accounts-preference-control"
          size="md"
          fill
          ariaLabel={formText("text_size")}
          value={theme.fontSize}
          onChange={theme.setFontSize}
          items={[
            { value: "small", label: formText("smaller") },
            { value: "default", label: formText("default") },
            { value: "large", label: formText("larger") },
          ]}
        />
      </AccountRow>
      <AccountActions>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? formText("processing") : formText("save")}
        </Button>
      </AccountActions>
    </AccountSection>
  );
}
