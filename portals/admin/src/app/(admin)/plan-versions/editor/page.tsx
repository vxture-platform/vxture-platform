import { PlanVersionsPage } from "@/modules/products/PlanVersionsPage";

/* 过渡路由：草稿编辑器。
 *
 * 一级列表改成「每行一个产品」之后，旧的「矩阵 + 版本时间线 + 编辑器」单页不再是
 * `/plan-versions` 的落点，但它承载着**唯一可用的草稿编辑面**，在编辑器重做那一批
 * 完成之前不能下线。它接受 `?plan=&version=` 预选参数，所以二级页的「编辑草稿」
 * 能直接落到那一版，而不是让人重新在矩阵里找一遍。
 *
 * 撤下 = 删掉本文件（届时编辑器已有自己的路由）。 */
export default function Page() {
  return <PlanVersionsPage />;
}
