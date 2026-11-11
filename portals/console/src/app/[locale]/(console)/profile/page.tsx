import { redirect } from "next/navigation";
import { accountCenterUrl, legacyAccountSection } from "@/lib/account-center";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ panel?: string }>;
}) {
  const [{ locale }, { panel }] = await Promise.all([params, searchParams]);
  redirect(accountCenterUrl(locale, legacyAccountSection(panel)));
}
