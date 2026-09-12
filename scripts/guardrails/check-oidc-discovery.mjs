#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// OIDC discovery 与实现必须一致
//
// ## 为什么要这条守卫
//
// 平台的 OIDC 面对外承诺了一堆性质，而它们此前**全都只写在代码里**，消费方只能
// 靠探针猜。这不是理论问题，已经发生过三次：
//
//   · ruyin 带 `prompt=select_account` 并记 TD-057「平台认不认，没验证过」——
//     平台当时只认 `none`，那个缓解从未生效，而两侧都不知道（#296）
//   · atlas 的 OperatorAuthGuard 依赖「`mgmt:atlas` 只发给 workforce+operator」，
//     那是一条平台**从未明说**的性质（#14）
//   · 公共客户端禁铸 S2S 的理由只在一行注释里（#264）
//
// 共同形状：**契约在代码里，消费方在仓外**。代码改了没人通知，文档没有，
// 而消费方发现的方式是线上行为变了。
//
// 这条守卫只解其中最机械的一半：discovery 文档声明支持的东西，实现必须真的支持。
// 声明与实现一起改，或者一起不改——不允许一边动另一边不动。
//
// ## 判据
//
// `prompt_values_supported` 里的每个值，在 `authorize()` 里必须有对应处理：
//   - `none`            → 有 `req.prompt === "none"` 分支
//   - `login`           → 出现在强制交互的判断里
//   - `select_account`  → 同上
//
// 反过来也查：实现里认的值必须出现在 discovery 里。**漏公布与漏实现一样坏**——
// 前者让消费方不敢用，后者让消费方白用。
//
// 运行：  node scripts/guardrails/check-oidc-discovery.mjs
// 别名：  pnpm lint:oidc-discovery
// 退出码：不一致 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SERVICE = resolve(REPO_ROOT, "bff/auth-bff/src/oidc/oidc.service.ts");

const src = readFileSync(SERVICE, "utf8");

/** discovery 里公布的 prompt 值。读不到就抛——读不到不等于没有。 */
function declaredPromptValues(text) {
  const m = /prompt_values_supported:\s*\[([^\]]*)\]/.exec(text);
  if (!m) {
    throw new Error(
      "discovery 里找不到 prompt_values_supported。" +
        "若是有意移除，请同时删掉本守卫并说明理由；不要让它静默消失。",
    );
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * authorize 实现里真正认的 prompt 值。
 *
 * 按**字面量**找：`req.prompt === "x"`。这有意做得笨——如果哪天改成查表或走常量，
 * 这里会抓不到而报错，那正是该发生的事：换实现形状时要顺手把守卫也带上，
 * 而不是让它悄悄失效（守卫读不到就抛，不兜底）。
 */
function implementedPromptValues(text) {
  const body = text.slice(text.indexOf("async authorize("));
  if (!body) throw new Error("找不到 authorize()");
  const found = new Set(
    [...body.matchAll(/req\.prompt\s*===\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  if (found.size === 0) {
    throw new Error(
      "authorize() 里一个 `req.prompt === \"…\"` 都没匹配到——" +
        "实现形状变了（查表？常量？），请同步改本守卫的判据。",
    );
  }
  return [...found];
}

const declared = declaredPromptValues(src).sort();
const implemented = implementedPromptValues(src).sort();

const missingImpl = declared.filter((v) => !implemented.includes(v));
const missingDoc = implemented.filter((v) => !declared.includes(v));

console.log("══ OIDC discovery 一致性（check-oidc-discovery）══");
console.log(`discovery 公布：${declared.join(", ")}`);
console.log(`authorize 实现：${implemented.join(", ")}`);

let failed = false;
if (missingImpl.length) {
  failed = true;
  console.error(
    `\n✗ 公布了但没实现：${missingImpl.join(", ")}\n` +
      "  消费方会照着 discovery 去用，然后发现没效果——而那正是 ruyin TD-057 的形状。",
  );
}
if (missingDoc.length) {
  failed = true;
  console.error(
    `\n✗ 实现了但没公布：${missingDoc.join(", ")}\n` +
      "  消费方不敢用一个没写在 discovery 里的值，能力等于白做。",
  );
}

if (failed) {
  console.error("\n── 汇总 ──\nerror: 1");
  process.exit(1);
}
console.log("\n✓ 公布与实现一致。");
console.log("\n── 汇总 ──\nerror: 0");
