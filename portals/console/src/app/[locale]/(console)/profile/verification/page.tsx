import { redirect } from "next/navigation";
import { accountCenterUrl } from "@/lib/account-center";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(accountCenterUrl(locale));
}
