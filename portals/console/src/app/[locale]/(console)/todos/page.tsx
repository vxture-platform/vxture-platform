import { TenantPlaceholderPage } from "@/modules/shared/TenantPlaceholderPage";

export default function Page() {
  return (
    <TenantPlaceholderPage
      icon="calendar"
      title="待办事项"
      description="聚合当前租户需要处理的订阅、邀请、配额和安全提醒。"
      signals={[
        {
          title: "待处理邀请",
          description: "展示待接受邀请和超时未处理记录。",
        },
        {
          title: "订阅提醒",
          description: "展示即将到期、续费失败或套餐变更确认事项。",
        },
        { title: "用量预警", description: "展示资源池接近阈值后的处理建议。" },
      ]}
    />
  );
}
