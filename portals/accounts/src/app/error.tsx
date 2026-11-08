/**
 * error.tsx - common Accounts route state.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-09
 */
"use client";
import { AccountsStatePanel } from "@/components/AccountsStatePanel";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <AccountsStatePanel state="load-error" onRetry={reset} />;
}
