import { AddonPayPage } from "@/modules/commerce/AddonPayPage";

export default async function Page({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;
  return <AddonPayPage orderNo={orderNo} />;
}
