/* 静态图片资源的模块声明。
 *
 * 为什么需要这一份：`declare module "*.png"` 本来由 Next 写在 `next-env.d.ts` 里
 * （`/// <reference types="next/image-types/global" />`），而**那个文件是 gitignored
 * 的**（.gitignore 第 127 行）——它由 `next dev` / `next build` 自动生成，不入库。
 *
 * CI 的 quality-gate 把 **Type check 排在 Build 之前**，全新 checkout 此时既没有
 * 仓库里的副本、Next 也还没生成它，于是 `import png from "…"` 直接 TS2307。本地却
 * 一路绿灯，因为开发机上那个文件早就躺在那儿了——**同一份代码两个结果，差异不在
 * 代码里而在一个不入库的生成物**。2026-09-16 实测：临时移走 next-env.d.ts，本地
 * 立刻复现出与 CI 一字不差的报错。
 *
 * 所以把它显式钉在入库文件里，不依赖生成物的存在与否。
 */
declare module "*.png" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
    blurWidth?: number;
    blurHeight?: number;
  };
  export default content;
}
