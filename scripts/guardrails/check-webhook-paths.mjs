#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-webhook-paths.mjs —— seed 登记的回调路径 ↔ 登记处那道门的豁免名单，双向对账
//
// ── 补的是哪个盲区 ──
// 接入通则规定所有产品的 webhook 回调同一个路径 `/api/webhooks/vxture`，
// opera-bff 的 `assertStandardWebhookPath` 在**登记处**强制它（产品页保存与
// `PUT /products/:id/webhook` 两个入口共用），存量产品的豁免写在同文件的
// `LEGACY_WEBHOOK_PATHS` 里。
//
// 2026-09-23 发现这两处**没有任何机械链路**：seed 把 arda / karda / vxtpl 三个产品的
// 回调都写成旧路径 `/provisioning/webhook`，而豁免名单里只有 vxtpl 与 yucer。后果不是
// 报一句「路径不对」——是运营在 opera 打开 arda 或 karda 的产品页、**原样按一次保存**
// 就 400，而报错还告诉他「正确的做法是让产品迁到标准路径」，一件他此刻做不了的事。
//
// **门漏抄名单就变成墙**，与发布门漏抄 override 是同一种错。而症状落在一个与名单
// 八竿子打不着的保存按钮上，没人会从那里回溯到这张表。
//
// ── 判据（双向）──
// 正向：seed 里每一条 `(产品, 路径)`，要么路径等于标准路径，要么该产品在豁免名单里
//       **且名单给的正是这条路径**。（名单是「那一个值」的豁免，不是「随便填」。）
// 反向：豁免名单里每一个产品，要么 seed 仍把它登记在那条旧路径上，要么它根本不由
//       seed 登记（运营在 opera 里手工登记的，如 yucer）。一条已经迁完的豁免留着，
//       就是下一个人以为「这个产品还在旧路径上」的理由——豁免要能自己退休。
//
// ── 第三向（2026-09-30 补）：docs 里的**规范性**引用 ──
// 上面两向把 seed 与名单钉在一起之后，2026-09-30 发现**第三处还在教旧路径**：
// `product_240_repo-template.md`（自称「回答新建一个产品仓里面应该有什么」）与
// `identity/080-rp-integration.md`（绿地 app 接入指引）都写着
// `POST /provisioning/webhook`。照它们做出来的产品，登记那一步当场被拒。
//
// **而这条守卫当时是绿的**——它的枚举只有 seed 与 `LEGACY_WEBHOOK_PATHS` 两个源码点，
// 散文从来不在里面。这正是 webhook 路径那个坑的第三次：前两次是产品各造同一个名字，
// 这一次造名字的是我们自己的模板文档。
//
// 判据：`docs/**.md` 里出现旧路径的每一行，必须至少满足一条豁免——
//   (a) 同一行也写了标准路径（= 更正说明或指路），
//   (b) 同一行点名了一个仍在豁免名单上的产品（= 现状描述，不是指引），
//   (c) 命中的是产品仓里的**源文件路径**（`app/provisioning/webhook/route.ts`），不是 URL。
// 都不满足 ⇒ 这是在教人建一条会被登记处拒收的端点。
// 枚举取自**文件系统遍历**，不是手写清单——新写一份文档照样被扫到。
//
// ── 它看不见什么 ──
// · 只看**源码里的声明**，不看生产库里实际登记的值。运营可以在 opera 里把某个产品
//   改成标准路径而 seed 不变——那时这条守卫仍然绿，因为 seed 的声明与名单仍然自洽。
//   库里的实际值由 `assertStandardWebhookPath` 在写入时把关，两层各管一段。
// · 不看域名，只看路径。域名本来就该各不相同。
// · `yucer` 这类不由 seed 登记的产品，正向对账看不到它们；反向对账才提到。
// · docs 那一向**判不了语气**：一行同时写了标准路径就算过，哪怕它写的是
//   「标准路径是 A，但你应该用 B」。它拦的是「只提旧路径、不提新路径」这一种形状。
// · `docs/80-liaison/` 整个跳过——那是**归档信件**，按索引的规矩不改史；
//   一封 2026-07 的信里写着当时的地址，是事实不是指引。
// · 只扫 `docs/`。产品仓里的源码与注释不在本仓，扫不到（那是 liaison 的事）。
//
// 用法：node scripts/guardrails/check-webhook-paths.mjs  (pnpm lint:webhook-paths)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SEED = "deploy/database/seed/seed-catalog.mjs";
const GATE = "bff/opera-bff/src/routers/product-catalog.router.ts";

/** `const WEBHOOK_PATHS = { arda: "/x", ... }` → Map(code → path)。 */
function seedPaths(src) {
  const m = src.match(/const WEBHOOK_PATHS\s*=\s*\{([^}]*)\}/s);
  if (!m) {
    throw new Error(
      `${SEED} 里找不到 WEBHOOK_PATHS —— 判据读不到就抛，不当成"没问题"`,
    );
  }
  const out = new Map();
  for (const e of m[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) out.set(e[1], e[2]);
  if (out.size === 0) {
    throw new Error(`${SEED} 的 WEBHOOK_PATHS 解析出 0 条 —— 形状变了，先改守卫`);
  }
  return out;
}

/** `const STANDARD_WEBHOOK_PATH = "/x"` */
function standardPath(src) {
  const m = src.match(/const STANDARD_WEBHOOK_PATH\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`${GATE} 里找不到 STANDARD_WEBHOOK_PATH`);
  return m[1];
}

/** `new Map<string,string>([ ["code","/x"], ... ])` → Map(code → path)。 */
function legacyPaths(src) {
  const m = src.match(
    /const LEGACY_WEBHOOK_PATHS\s*=\s*new Map<[^>]*>\(\s*\[(.*?)\]\s*\)/s,
  );
  if (!m) throw new Error(`${GATE} 里找不到 LEGACY_WEBHOOK_PATHS`);
  const out = new Map();
  for (const e of m[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)) {
    out.set(e[1], e[2]);
  }
  return out;
}

const seedSrc = read(SEED);
const gateSrc = read(GATE);
const seeded = seedPaths(seedSrc);
const standard = standardPath(gateSrc);
const legacy = legacyPaths(gateSrc);

console.log("== 回调路径对账(check-webhook-paths)==");
console.log(`  - 标准路径 ${standard}`);
console.log(
  `  - seed 登记 ${seeded.size} 个产品；豁免名单 ${legacy.size} 条（${[...legacy.keys()].join("、") || "空"}）`,
);

const problems = [];

// ── 正向：seed 的每一条都要站得住 ──────────────────────────────────────────
for (const [code, path] of [...seeded].sort()) {
  if (path === standard) continue;
  const exempt = legacy.get(code);
  if (exempt === undefined) {
    problems.push(
      `seed 把 ${code} 登记在 ${path}，而它不在豁免名单里 —— 运营在 opera 打开这个` +
        `产品页原样按一次保存就会 400（assertStandardWebhookPath 拒收），门变成墙。` +
        `要么让产品迁到 ${standard}，要么把 ${code} 补进 LEGACY_WEBHOOK_PATHS。`,
    );
  } else if (exempt !== path) {
    problems.push(
      `seed 把 ${code} 登记在 ${path}，而豁免名单给的是 ${exempt} —— 豁免是「那一个值」，` +
        `不是「随便填」，两者必须逐字相同。`,
    );
  }
}

// ── 反向：名单里不该留已经用不上的条目 ────────────────────────────────────
for (const [code, path] of [...legacy].sort()) {
  const s = seeded.get(code);
  if (s === undefined) continue; // 不由 seed 登记（如 yucer，运营手工登记）
  if (s === standard) {
    problems.push(
      `豁免名单还留着 ${code} → ${path}，而 seed 已经把它登记在标准路径上了 —— ` +
        `一条不再成立的豁免留着，就是下一个人以为「这个产品还在旧路径上」的理由。删掉它。`,
    );
  }
}

// ── 第三向：docs 里的规范性引用（枚举 = 文件系统遍历，不是手写清单）──────────
const DOCS_ROOT = "docs";
/** 归档：按 `docs/80-liaison/00-index.md` 的规矩，既有信件保留原状、不改史。 */
const DOCS_SKIP = ["docs/80-liaison/"];

function walkMarkdown(dir, out = []) {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      walkMarkdown(rel, out);
    } else if (e.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

const legacyLiterals = [...new Set(legacy.values())].filter(
  (p) => p !== standard,
);
const exemptCodes = [...legacy.keys()];
let docsScanned = 0;
let docsHits = 0;

if (legacyLiterals.length > 0) {
  for (const file of walkMarkdown(DOCS_ROOT)) {
    if (DOCS_SKIP.some((s) => file.startsWith(s))) continue;
    docsScanned += 1;
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      for (const lit of legacyLiterals) {
        let from = 0;
        for (;;) {
          const at = line.indexOf(lit, from);
          if (at === -1) break;
          from = at + 1;
          docsHits += 1;
          // (c) 产品仓里的源文件路径，不是 URL。
          if (/app\/?$/.test(line.slice(0, at)) || line.startsWith("app")) {
            continue;
          }
          if (line.slice(at).startsWith(`${lit}/route.`)) continue;
          /*
           * (a)/(b) 都按**命中处附近**判，不按整行判。
           *
           * 初版写的是 `line.includes(...)`，而它在真实缺陷上**没有报红**：
           * `product_240` 那一格是一行长表格,同一行里为了另一件事提了 `arda`
           * （"现契约与 arda 实现均单 secret"），于是 (b) 白白放行。
           * 行粒度对一行装好几个话题的表格来说太粗——判据粒度错了不会报错，
           * 只会安静地放过。所以取命中前 80 / 后 40 个字符这个窗口：
           * 真正的现状描述里产品名就贴着地址（`{ARDA_BASE_URL}/provisioning/webhook`、
           * `arda 侧边缘对 /provisioning/webhook`），更正说明里标准路径也贴着。
           */
          const near = line.slice(Math.max(0, at - 80), at + lit.length + 40);
          // (a) 命中处附近也写了标准路径（= 更正说明或指路）。
          if (near.includes(standard)) continue;
          // (b) 命中处附近点名了一个仍在豁免名单上的产品（= 现状描述）。
          const lowerNear = near.toLowerCase();
          if (exemptCodes.some((c) => lowerNear.includes(c.toLowerCase()))) {
            continue;
          }
          problems.push(
            `${file}:${i + 1} 只提旧路径 ${lit}、不提标准路径 ${standard} —— ` +
              `照这一行建出来的端点，登记那一步会被 assertStandardWebhookPath 当场拒。` +
              `要么改成标准路径，要么在这个地址**紧邻处**写明它是哪个存量产品的现状` +
              `（判据按命中前 80 / 后 40 字符的窗口看，不看整行）。`,
          );
        }
      }
    });
  }
  console.log(
    `  - docs 扫了 ${docsScanned} 份 markdown（跳过 ${DOCS_SKIP.join("、")}），命中旧路径 ${docsHits} 处`,
  );
} else {
  console.log("  - 豁免名单已空，docs 那一向无旧路径可查");
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  x ${p}`);
  console.log(
    `\n${problems.length} 处不一致。判据在接入通则 §C3 下发：所有产品同一个路径，变的只有域名。`,
  );
  process.exit(1);
}

const stillLegacy = [...seeded].filter(([, p]) => p !== standard);
if (stillLegacy.length === 0) {
  console.log(
    "✓ seed 里每一个产品都在标准路径上 —— LEGACY_WEBHOOK_PATHS 若也空了，连表一起删。",
  );
} else {
  console.log(
    `✓ 一致（还有 ${stillLegacy.length} 个产品在旧路径上：${stillLegacy.map(([c]) => c).join("、")}，等 X-4 三步迁完）`,
  );
}
