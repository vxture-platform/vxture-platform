"use client";
/**
 * Return legacy profile completion to the central identity flow.
 * @package @vxture/console
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { buildRpLoginUrl } from "@/api/console-bff";

export function OnboardingPage() {
  const params = useSearchParams();
  useEffect(() => {
    const next = params.get("next");
    let returnTo = window.location.origin;
    try {
      const target = new URL(next || "/", window.location.origin);
      if (
        target.origin === window.location.origin &&
        !/\/onboarding\/?$/.test(target.pathname)
      ) {
        returnTo = target.href;
      }
    } catch {
      // Malformed legacy return links fall back to the Console origin.
    }
    // Central login performs profile completion before issuing a new RP session.
    window.location.replace(buildRpLoginUrl(returnTo));
  }, [params]);
  return null;
}
