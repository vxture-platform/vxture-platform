#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 枚举文案蔓延守卫:硬编码的「枚举 → 中文」映射只准少,不准多。
//
// ── 为什么需要 ──
// 2026-09-20 盘点:admin 里有 380 条硬编码枚举中文文案,散在 29 个文件,74 个
// 「返回中文的映射函数」+ 14 个「值全是中文的映射表」。同名函数重复得厉害:
// cycleLabel 5 份、subscriptionStatusLabel 4 份、billStatusLabel 4 份、
// paySourceLabel 4 份、invoiceTypeLabel / taxTypeLabel / billTypeLabel 各 3 份。
//
// 这不是洁癖。四份 subscriptionStatusLabel 实测**互不相同**:
//   · OrderDetailPage 那份漏了 `expired` 分支,落到默认分支显示「已取消」
//     ——权益自然到期被说成客户主动退订。
//   · 另外三份对 expired 的译名也不一致:「已到期」x2 vs「已过期」x1。
// 而 tenant-utils 那份的注释还写着「七值与订阅列表页同一份措辞」——注释声称
// 一致,实际不一致,没有任何东西保证那句声明。这道守卫就是那个保证。
//
// ── 为什么是计数棘轮,不是逐条名单 ──
// 存量 380 条要逐条判「该收口成哪一族」,而收口的前提是**先有值域契约**
// (规矩见 status-tone.constants.ts 头注)。那是比文案大得多的一件事,不能在
// 立守卫这一步顺带做完。棘轮保证的是:这个数只会往下走。
//
// 基线按文件记。**新文件的基线是 0**——没在表里的文件一条都不许有。
//
// ── 它覆盖不到什么 ──
// 只认两种形态:①返回 ≥2 条中文字面量的函数 ②值全是中文且 ≥2 条的对象字面量。
// 单分支的 `if (x) return "中文"`、散在 JSX 里的三元、模板串里的中文,它都不看
// ——那些归 i18n 的逐页工作,不归这道守卫。
//
// 运行:  node scripts/guardrails/check-enum-label-sprawl.mjs
// 别名:  pnpm lint:enum-label-sprawl
// 退出码:任一文件超基线、或基线有陈旧条目 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SCAN_ROOT = join(REPO_ROOT, "portals/admin/src");
const HAN = /[一-鿿]/;

/**
 * 每个文件允许的条数(2026-09-20 实测基线,subscriptionStatus 一族收口后)。
 * 不在表里的文件基线为 0。数字只准往下改。
 */
const BASELINE = new Map([
  ["modules/accounts/AccountDetailPage.tsx", 4],
  ["modules/accounts/AccountsPage.tsx", 20],
  ["modules/ai/ModelPlatformPage.tsx", 3],
  ["modules/announcements/AnnouncementsPage.tsx", 11],
  ["modules/billing/BillingBillActionDialog.tsx", 20],
  ["modules/billing/BillingDetailPage.tsx", 31],
  ["modules/billing/BillingPage.tsx", 13],
  ["modules/billing/InvoiceReceiptActionDialog.tsx", 10],
  ["modules/billing/OfflineInvoiceDialog.tsx", 15],
  ["modules/commercial/PromotionRedemptionsPage.tsx", 6],
  ["modules/commercial/PromotionsPage.tsx", 7],
  ["modules/commercial/UsageMeteringPage.tsx", 4],
  ["modules/invoices/InvoicesPage.tsx", 27],
  ["modules/ops/OpsTodosPage.tsx", 8],
  ["modules/ops/SystemNoticesSection.tsx", 3],
  ["modules/orders/OrderDetailPage.tsx", 19],
  ["modules/orders/OrderOfflinePaymentDialog.tsx", 7],
  ["modules/orders/OrdersPage.tsx", 14],
  ["modules/payments/PaymentsPage.tsx", 21],
  ["modules/products/ProductCapabilityDetailPage.tsx", 18],
  ["modules/products/ProductsPage.tsx", 15],
  ["modules/subscriptions/SubscriptionDetailPage.tsx", 11],
  ["modules/subscriptions/SubscriptionOperationDialog.tsx", 16],
  ["modules/subscriptions/SubscriptionsPage.tsx", 6],
  ["modules/support/ReviewsPage.tsx", 4],
  ["modules/support/TicketsPage.tsx", 15],
  ["modules/tenants/tenant-utils.ts", 21],
  ["modules/tenants/VerificationsPage.tsx", 2],
  ["shared/ip-location.ts", 2],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const files = walk(SCAN_ROOT);
if (files.length === 0) throw new Error("[enum-label-sprawl] 一个源文件都没扫到——判据失效");

const counts = new Map();
let scannedFiles = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!HAN.test(src)) continue;
  scannedFiles++;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!sf) throw new Error(`[enum-label-sprawl] 解析失败: ${file}`);
  const rel = relative(SCAN_ROOT, file).split(sep).join("/");
  let hits = 0;

  const visit = (node) => {
    // ① 返回 >= 2 条中文字面量的函数
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      let returns = 0;
      const scanReturns = (inner) => {
        if (ts.isReturnStatement(inner) && inner.expression &&
            (ts.isStringLiteral(inner.expression) || ts.isNoSubstitutionTemplateLiteral(inner.expression)) &&
            HAN.test(inner.expression.text)) returns++;
        ts.forEachChild(inner, scanReturns);
      };
      scanReturns(node.body);
      if (returns >= 2) hits += returns;
    }
    // ② 值全是中文、且 >= 2 条的对象字面量
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        const assigns = init.properties.filter(ts.isPropertyAssignment);
        const chinese = assigns.filter((p) =>
          (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) &&
          HAN.test(p.initializer.text));
        if (chinese.length >= 2 && chinese.length === assigns.length) hits += chinese.length;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hits > 0) counts.set(rel, hits);
}

// `--emit-baseline` 打印一份可直接粘回上面的表。基线只准由这里产出:手工誊抄
// 的数会与守卫自己的口径对不上(2026-09-20 立表时就对不上,8 个文件全错)。
if (process.argv.includes("--emit-baseline")) {
  const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [rel, hits] of rows) console.log(`  [${JSON.stringify(rel)}, ${hits}],`);
  process.exit(0);
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log("══ 枚举文案蔓延(check-enum-label-sprawl)══");
console.log(`  · 扫描 ${scannedFiles} 个含中文的源文件,命中 ${counts.size} 个,共 ${total} 条`);
// 一条都没扫到 = 遍历坏了,不是「没问题」。
if (counts.size === 0) {
  console.error("✗ 一条都没命中——判据失效,不是没问题（存量是几百条）。");
  process.exit(1);
}

const problems = [];
for (const [rel, hits] of counts) {
  const allowed = BASELINE.get(rel) ?? 0;
  if (hits > allowed) {
    problems.push(`${rel}: ${hits} 条,基线 ${allowed} —— 多了 ${hits - allowed}`);
  }
}
// 基线高于实测的条目也报:留着的虚高额度会让后来新增的蔓延藏在里面。
for (const [rel, allowed] of BASELINE) {
  const hits = counts.get(rel) ?? 0;
  if (hits < allowed) {
    problems.push(`${rel}: 实测 ${hits} 条 < 基线 ${allowed} —— 已经降下来了,把基线改成 ${hits}`);
  }
}

if (problems.length === 0) {
  console.log(`✓ 没有文件超基线（基线合计 ${[...BASELINE.values()].reduce((a, b) => a + b, 0)} 条，逐族收口中）。`);
  process.exit(0);
}
console.error(`\n✗ ${problems.length} 处:\n`);
for (const p of problems) console.error("  " + p);
console.error("\n  新写的枚举文案请收进 modules/shared/enum-labels.ts（先确认它的值域有没有契约，");
console.error("  规矩见 status-tone.constants.ts 头注：先有值域契约，再谈它的展示映射）。");
process.exit(1);
