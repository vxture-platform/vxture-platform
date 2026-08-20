#!/usr/bin/env node
/**
 * generate-reexports.mjs - 生成 index 对 design-ui / design-tokens 的具名再导出
 * （vxture-platform#320）。
 *
 * 为什么存在：index 产物被注入 "use client"，而对 external 包的 `export *` 会
 * 原样留在产物里——Next 15 的 next-flight-loader 在 server/client 边界上硬拒
 * 这个组合（它无法静态枚举客户端引用图）。修法就是错误信息里那句
 * "Please use named exports instead"：值走生成的具名清单，类型走
 * `export type *`（编译期擦除，无运行时痕迹）。
 *
 * 事实来源：两包**已构建**的 CJS 产物（build 顺序本就要求 tokens -> ui ->
 * system，见 050-design-system-release.md §4）。生成物 src/generated-reexports.ts
 * 入仓供编辑器/type-check 直读；每次 `pnpm build` 前重新生成，所以发布产物
 * 永远与当版依赖对齐（伞包对两包钉精确版本，050 §1）。生成物不得手工编辑。
 *
 * 去重规则：design-ui 优先；design-tokens 里与 design-ui 同名的值不再二次
 * 导出（原 `export *` 语义下同名本就 ambiguous-drop，这里显式化）。伞包自持
 * 层（./components ./theme ./density）与两包的值名冲突会在 tsup 构建时直接
 * 报 duplicate export——冲突应当是构建错误，不是静默遮蔽。
 */
import { writeFileSync } from "node:fs";
import { stdout } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// 用 import()（不是 createRequire）：require 条件会解析到某些依赖损坏的
// CJS 条件文件（如 @phosphor-icons/react 的 index.cjs.js —— .js 后缀 +
// "type":"module"，require(esm) 直接炸）；import 条件是健康的 ESM。
async function runtimeExports(pkg) {
  const mod = await import(pkg);
  return Object.keys(mod)
    .filter((k) => k !== "default" && k !== "__esModule")
    .sort();
}

const ui = await runtimeExports("@vxture/design-ui");
const uiSet = new Set(ui);
const tokens = (await runtimeExports("@vxture/design-tokens")).filter((k) => !uiSet.has(k));

const list = (names) => names.map((n) => `  ${n},`).join("\n");

const out = `// 本文件由 scripts/generate-reexports.mjs 生成——不得手工编辑（改动会在下一次
// pnpm build 时被覆盖）。背景与规则见生成脚本头注释（vxture-platform#320）。
/* eslint-disable */

// ---- @vxture/design-ui 的全部运行时导出（${ui.length} 个） ----
export {
${list(ui)}
} from "@vxture/design-ui";

// ---- @vxture/design-tokens 的运行时导出（${tokens.length} 个，去除与 design-ui 同名项） ----
export {
${list(tokens)}
} from "@vxture/design-tokens";
`;

writeFileSync(join(here, "..", "src", "generated-reexports.ts"), out);
stdout.write(`[generate-reexports] design-ui ${ui.length} + design-tokens ${tokens.length} named re-exports written
`);
