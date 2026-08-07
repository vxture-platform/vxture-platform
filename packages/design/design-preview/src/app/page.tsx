/**
 * page.tsx - 根路径重定向到第一个大类。
 * @package @vxture/design-preview
 *
 * 预览面没有"总览页"——六个大类各有各的统计口径，硬凑一页总览就又回到了
 * 把全部资源堆在一起、顶部那组数只对其中一类成立的老样子。
 */

import { redirect } from "next/navigation";
import { SECTIONS } from "@/preview/sections";

export default function IndexPage(): never {
  redirect(`/${SECTIONS[0]?.slug ?? "color"}`);
}
