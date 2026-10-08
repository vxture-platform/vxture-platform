import { ModelPlatformPage } from "@/modules/ai/ModelPlatformPage";
import { CreditPricingSection } from "@/modules/ai/CreditPricingSection";

export default function AdminAtlasRoute() {
  return (
    <>
      <ModelPlatformPage />
      {/* 积分换算/定价（ADR-014）：与供应商价目（付上游）并列的另一侧——token→credit
          费率（收客户）。按目标毛利从每模型成本逐维反推，各模型毛利趋同。 */}
      <section className="flex flex-col gap-md p-lg">
        <h2 className="text-heading-sm">积分换算 / 定价</h2>
        <CreditPricingSection />
      </section>
    </>
  );
}
