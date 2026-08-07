"use client";

import { useState, type FormEvent } from "react";
import {
  Banner,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  FormPageTemplate,
  Input,
  ViewHeader,
} from "@vxture/design-system";
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
    /* Onboarding was styled as a dialog forced to `position: static` — it is
     * a full page, so it gets the form page skeleton like every other form. */
    <form onSubmit={(event) => void handleSubmit(event)}>
      <FormPageTemplate
        header={
          <ViewHeader
            icon="user"
            title={t("title")}
            description={t("description")}
          />
        }
        footer={
          <Button type="submit" disabled={submitting}>
            {t("actions.submit")}
          </Button>
        }
      >
        {error ? <Banner tone="danger" title={error} /> : null}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-account">
              {t("fields.account")}
            </FieldLabel>
            <Input
              id="onboarding-account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder={t("fields.accountPlaceholder")}
              minLength={3}
              maxLength={24}
              required
              autoFocus
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="onboarding-display-name">
              {t("fields.displayName")}
            </FieldLabel>
            <Input
              id="onboarding-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="onboarding-phone">
              {t("fields.phone")}
            </FieldLabel>
            <Input id="onboarding-phone" value={phone} disabled readOnly />
          </Field>

          <Field>
            <FieldLabel htmlFor="onboarding-email">
              {t("fields.email")}
            </FieldLabel>
            <Input
              id="onboarding-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("fields.emailPlaceholder")}
            />
          </Field>
        </FieldGroup>
      </FormPageTemplate>
    </form>
  );
}
