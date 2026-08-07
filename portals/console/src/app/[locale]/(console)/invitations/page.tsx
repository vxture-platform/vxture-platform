import { TenantPlaceholderPage } from "@/modules/shared/TenantPlaceholderPage";

export default function Page() {
  return (
    <TenantPlaceholderPage
      icon="mail"
      title="邀请记录"
      description="查看待接受邀请、历史邀请和邀请处理状态。"
      signals={[
        { title: "待接受邀请", description: "展示仍在有效期内的成员邀请。" },
        {
          title: "历史邀请",
          description: "展示已接受、过期、撤销的邀请记录。",
        },
        {
          title: "邀请策略",
          description: "后续支持邀请有效期和审批规则配置。",
        },
      ]}
    />
  );
}
