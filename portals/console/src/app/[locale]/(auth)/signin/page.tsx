"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildRpLoginUrl } from "@/api/console-bff";

/**
 * Sign-in entry. The Identity Platform centralizes the login surface at the IdP
 * (accounts.vxture.com), so console no longer renders its own credential form:
 * it redirects to the console-bff RP login endpoint, which 302s to the IdP
 * authorize page and on to the accounts login UI. On success the RP callback
 * sets the opaque session cookie and returns the browser to `next`.
 * See identity-platform-architecture.md §9.
 */
export default function SignInPage() {
  const params = useSearchParams();
  const t = useTranslations("login");

  useEffect(() => {
    const next = params.get("next") || "/";
    const returnTo = new URL(next, window.location.origin).toString();
    window.location.assign(buildRpLoginUrl(returnTo));
  }, [params]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>{t("redirecting")}</p>
    </main>
  );
}
