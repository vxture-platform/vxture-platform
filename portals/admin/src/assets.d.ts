/* 静态图片资源的模块声明。
 *
 * **这份必须是零 import 的独立文件**，不能并进 `global.d.ts`：一个 `.d.ts`
 * 只要有顶层 `import` / `export`，它就从「全局脚本」变成「模块」，里面的
 * `declare module "*.png"` 随之从全局 ambient 声明降级为模块内声明，对其它
 * 文件不可见。admin 的 `global.d.ts` 带着 `import type { Locale }`，2026-09-16
 * 把 png 声明追加到那里，**落地即失效**，本地靠 next-env.d.ts 兜着看不出来，
 * CI 上（Type check 在 Build 之前、next-env.d.ts 还没生成）当场 TS2307。
 *
 * 为什么需要它：`declare module "*.png"` 本由 Next 写在 `next-env.d.ts`，而那个
 * 文件是 gitignored 的（.gitignore 第 127 行），不入库。把声明显式钉在入库文件里，
 * 不依赖生成物的存在与否。
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
