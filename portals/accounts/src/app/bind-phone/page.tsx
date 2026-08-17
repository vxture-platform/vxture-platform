/**
 * page.tsx - /bind-phone?binding_token=… (bind a phone to a social login)
 * @package @vxture/accounts
 *
 * Landing page after a social login whose upstream returned no phone. Reads the
 * one-time binding token and renders the phone-binding form; a missing token
 * means the page was opened out of band — show a friendly notice.
 */
import { AccountsNotice } from "@/components/AuthChrome";
import { BindPhonePanel } from "@/components/BindPhonePanel";

export const dynamic = "force-dynamic";

export default async function BindPhonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token =
    typeof params.binding_token === "string" ? params.binding_token : "";

  if (!token) {
    return (
      <AccountsNotice
        title="绑定会话无效"
        description="这个绑定链接已过期或被使用过。请回到应用重新发起登录。"
      />
    );
  }

  return <BindPhonePanel token={token} />;
}
