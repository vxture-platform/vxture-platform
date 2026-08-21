#!/usr/bin/env node

/**
 * check-server-entry-safety.mjs — `/server` 子集必须在 react-server 运行时可求值。
 *
 * ── 补的是哪个盲区 ──
 * `/server` 入口的契约是「RSC 可直接 import，不会把页面变成 client component」。
 * 这个契约**只在 react-server 条件下求值时才成立**，而常规的 build / type-check /
 * 单测全都跑在普通 node 条件下——产物导出了一条把 `createContext` 拖进模块作用域
 * 的链路，三道关卡一道都不会响。
 *
 * 实际代价见 #347：`iconRegistry.ts` 静态引 Phosphor 的 CSR 构建（模块作用域调用
 * `createContext`），于是 StatusBadge / EmptyState / Banner / Section / MetricCard /
 * MetricGrid 六个导出全都把它带进了 `/server`。生产环境被 webpack 的 DCE 兜住了，
 * 所以没人发现；而 `next dev` 无 DCE、全量求值，消费方本地开发直接 500。这种
 * 「线上好、本地炸」的缺陷最难归因，正因如此必须机器化。
 *
 * 做法：用 `--conditions react-server` 真的 import 一次产物。这与 #347 的复现命令
 * 逐字同源——复现命令即验收命令，不另造一套近似物。
 *
 * 用法：node scripts/guardrails/check-server-entry-safety.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

/** 每个条目 = 一个声明了 server-safe 子集的包及其产物入口。 */
const TARGETS = [
  {
    pkg: "@vxture/design-ui",
    dir: "packages/design/design-ui",
    entry: "dist/server.mjs",
  },
  {
    pkg: "@vxture/design-system",
    dir: "packages/design/design-system",
    entry: "dist/server.mjs",
  },
];

let failed = 0;
let skipped = 0;

for (const target of TARGETS) {
  const abs = path.join(ROOT, target.dir, target.entry);
  if (!existsSync(abs)) {
    console.log(
      `⚠ 跳过 ${target.pkg}：产物缺失（${target.entry}）—— 请先 build 再跑本检查。`,
    );
    skipped += 1;
    continue;
  }

  // 在包目录里执行：入口对 @phosphor-icons/react 等依赖的解析要走该包自己的
  // node_modules（pnpm 严格隔离），从仓库根跑会解析不到。
  const result = spawnSync(
    process.execPath,
    [
      "--conditions",
      "react-server",
      "-e",
      `import(${JSON.stringify(pathToFileURL(abs).href)}).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); })`,
    ],
    {
      cwd: path.join(ROOT, target.dir),
      encoding: "utf8",
      timeout: 60_000,
    },
  );

  if (result.status === 0) {
    console.log(`✓ ${target.pkg} 的 /server 入口在 react-server 下可求值`);
  } else {
    failed += 1;
    const detail = (result.stderr || result.stdout || "").trim().split("\n")[0];
    console.error(
      `✗ ${target.pkg} 的 /server 入口在 react-server 下求值失败：${detail}`,
    );
    console.error(
      "  多半是某个导出把 client-only 的模块作用域副作用拖进了 server 图" +
        "（典型：图标注册中心引了 Phosphor 的 CSR 构建而非 /ssr）。",
    );
  }
}

console.log("\n── 汇总 ──");
console.log(`error: ${failed}   skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
