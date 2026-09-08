/**
 * page.tsx - /onboarding（注册补齐，owner 2026-09-08）
 * @package @vxture/accounts
 *
 * 手机验证建号之后 IdP 把人送到这里：会话已经建立，但授权码还没发——
 * 三项资料落库、标记完成之后才发码回跳应用（判定在 auth-bff 的 finishTenantLogin
 * 这条共用尾巴里，每条租户登录路径都覆盖）。所以「注册完成」和「能进应用」是同一个瞬间。
 *
 * 页面本身不做鉴权判断：身份只在 cookie 里，取状态那一下拿到 401 就由面板
 * 提示回应用重新登录。
 */
import { OnboardingPanel } from "@/components/OnboardingPanel";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <OnboardingPanel />;
}
