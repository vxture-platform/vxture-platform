"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@vxture/design-system";
import { useTranslations } from "next-intl";
import {
  ConsoleBffError,
  updateUserProfile,
  updateUsername,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";

const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeOptional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

/**
 * First-time setup, forced once for every new phone/social login before the
 * rest of console is reachable (ConsoleShell redirects here while the
 * username still has the system default `_{user_no}` shape). Collects
 * account + display name (required), confirms the already-verified phone,
 * and offers an optional email (format-checked here, verified later from the
 * profile page — see ProfilePage's contact-verify flow).
 */
export function OnboardingPage() {
  const t = useTranslations("onboarding");
  const { session, refreshSession } = useConsoleSession();
  const router = useRouter();

  const [account, setAccount] = useState("");
  const [displayName, setDisplayName] = useState(
    session.user?.displayName ?? session.user?.name ?? "",
  );
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone = session.user?.phone ?? "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedAccount = account.trim();
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();

    if (!ACCOUNT_RE.test(trimmedAccount)) {
      setError(t("errors.accountFormat"));
      return;
    }
    if (!trimmedName) {
      setError(t("errors.displayNameRequired"));
      return;
    }
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setError(t("errors.emailFormat"));
      return;
    }

    setSubmitting(true);
    try {
      await updateUserProfile({
        displayName: trimmedName,
        email: normalizeOptional(trimmedEmail),
      });
      await updateUsername(trimmedAccount);
      await refreshSession();
      router.replace("/");
    } catch (caught) {
      const status =
        caught instanceof ConsoleBffError ? caught.status : undefined;
      setError(status === 409 ? t("errors.accountTaken") : t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="vx-profile-dialog" style={{ position: "static" }}>
      <form
        className="vx-profile-dialog__content vx-account-profile-dialog"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <header className="vx-account-profile-dialog__header">
          <h3>{t("title")}</h3>
          <p>{t("description")}</p>
        </header>

        <Label>
          {t("fields.account")}
          <Input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder={t("fields.accountPlaceholder")}
            minLength={3}
            maxLength={24}
            required
            autoFocus
          />
        </Label>

        <Label>
          {t("fields.displayName")}
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Label>

        <Label>
          {t("fields.phone")}
          <Input value={phone} disabled readOnly />
        </Label>

        <Label>
          {t("fields.email")}
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("fields.emailPlaceholder")}
          />
        </Label>

        {error ? <p className="vx-profile-error">{error}</p> : null}

        <div className="vx-profile-dialog__actions">
          <Button type="submit" disabled={submitting}>
            {t("actions.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
