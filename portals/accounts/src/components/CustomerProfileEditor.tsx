/**
 * CustomerProfileEditor.tsx - account profile, avatar and personal preferences.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useTranslations } from "next-intl";
import { formatPrincipalNoOr } from "@vxture-platform/shared";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  DialogForm,
  Input,
  NativeSelect,
  SegmentedControl,
  useTheme,
  StatusBadge,
} from "@vxture/design-system";
import { useRouter } from "next/navigation";
import {
  accountsRequest,
  type CustomerProfile,
  type CustomerSecurity,
} from "@/api/customer-self";
import { AccountSection, AccountRow } from "./AccountPrimitives";

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
  const [name, setName] = useState(profile.name ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [resetAvatar, setResetAvatar] = useState(false);
  function openAvatar() {
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
  async function save() {
    setBusy(true);
    setError("");
    try {
      await accountsRequest("/oidc/customer/self", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : formText("unable_to_save"));
    } finally {
      setBusy(false);
    }
  }
  async function saveAvatar() {
    setBusy(true);
    setError("");
    try {
      if (resetAvatar)
        await accountsRequest("/api/me/avatar", { method: "DELETE" });
      else if (file)
        await accountsRequest("/api/me/avatar", {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
      setAvatarOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : formText("unable_to_save"));
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
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="accounts-identity-edit"
          onClick={openAvatar}
        >
          {formText("edit_avatar")}
        </Button>
      </div>
      <AccountSection
        title={formText("basic_information")}
        icon="user"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(profile.name ?? "");
              setEditing(!editing);
            }}
          >
            {editing ? formText("cancel") : formText("edit")}
          </Button>
        }
      >
        <AccountRow
          label={
            <>
              {formText("name")}
              {editing ? (
                <span className="accounts-required" aria-hidden="true">
                  *
                </span>
              ) : null}
            </>
          }
        >
          {editing ? (
            <Input
              aria-label={formText("name")}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          ) : (
            profile.name || "—"
          )}
        </AccountRow>
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
        {editing ? (
          <Button disabled={busy || !name.trim()} onClick={() => void save()}>
            {formText("save")}
          </Button>
        ) : null}
        {error && !avatarOpen ? <Banner tone="danger" title={error} /> : null}
      </AccountSection>
      <CustomerPreferences profile={profile} />
      <DialogForm
        size="sm"
        title={formText("change_avatar")}
        submitLabel={formText("save")}
        cancelLabel={formText("cancel")}
        submitting={busy}
        submitDisabled={!file && !resetAvatar}
        onSubmit={(event) => {
          event.preventDefault();
          void saveAvatar();
        }}
        open={avatarOpen}
        onOpenChange={(open) => {
          if (!busy) setAvatarOpen(open);
        }}
      >
        <div className="accounts-avatar-preview">{avatar(picture)}</div>
        <label className="text-body-sm">
          {formText("choose_image")}
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (!next) return;
              if (
                next.size > 1048576 ||
                !["image/png", "image/jpeg", "image/webp"].includes(next.type)
              ) {
                setError(
                  formText(
                    "choose_a_png_jpeg_or_webp_image_no_larger_than_1mb",
                  ),
                );
                return;
              }
              setFile(next);
              setResetAvatar(false);
              setError("");
            }}
          />
        </label>
        {error ? <Banner tone="danger" title={error} /> : null}
        <div className="accounts-avatar-reset">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setFile(null);
              setResetAvatar(true);
            }}
          >
            {formText("restore_default")}
          </Button>
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
  const theme = useTheme();
  const router = useRouter();
  const [language, setLanguage] = useState(profile.language || "zh-CN");
  const [timezone, setTimezone] = useState(profile.timezone || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await accountsRequest("/oidc/customer/self", {
        method: "PATCH",
        body: JSON.stringify({ language, timezone }),
      });
      document.cookie = `NEXT_LOCALE=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
      setMessage(formText("saved"));
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : formText("unable_to_save"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountSection title={formText("preferences")} icon="faders">
      <AccountRow label={formText("language")}>
        <NativeSelect
          aria-label={formText("language")}
          className="accounts-preference-control"
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
          className="accounts-preference-control"
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
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        {formText("save")}
      </Button>
      {message ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </AccountSection>
  );
}
