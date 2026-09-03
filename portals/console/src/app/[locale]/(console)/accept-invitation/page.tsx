import { AcceptInvitationPage } from "@/modules/workspace/AcceptInvitationPage";

/* 邮件链接落点:任何登录用户都能来,租户与角色由 token 决定——这里不套 CapabilityGate。 */
export default function Page() {
  return <AcceptInvitationPage />;
}
