import { AccountCenterBridge } from "@/modules/settings/AccountCenterBridge";

/* 「个人信息 / 账户设置」页 —— Header 齿轮与用户弹出面板「个人信息」的落点。
 * Phase B 收敛（2026-09-02）：运营者账户自助统一到身份层的账户中心（accounts /account），
 * 本页只出跳转入口；原内嵌邮箱自助 OperatorAccountSettings 随之退役。 */
export default function SettingsPage() {
  return (
    <div className="vx-settings-page">
      <AccountCenterBridge />
    </div>
  );
}
