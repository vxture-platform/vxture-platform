#!/usr/bin/env node

/**
 * check-account-rules.mjs — 用户名格式规则三处必须逐字一致。
 *
 * ── 补的是哪个盲区 ──
 * 同一条正则写在三个文件里：后端的判据、console 补齐页的前端校验、accounts 补齐页
 * 的前端校验。任一处漂了**不报错、不影响构建、类型也对**，只表现为「这个用户名
 * 怎么不让用」：
 *
 *  · 前端比后端**松** → 用户填得进去，提交被后端 400 拒。人看到的是一次莫名其妙的
 *    失败，而前端刚刚告诉他这个名字是合法的。
 *  · 前端比后端**紧** → 后端本来接受的名字被前端拦下，用户永远不知道那是可以用的。
 *
 * 2026-09-08 实际漂过一次：accounts 那份写成 `{3,31}`（4–32 位），而后端是
 * `{2,23}`（3–24 位），注释还写着「与后端 assertValidAccount 同口径」——注释是
 * 对的，代码不是。三处比对没有任何自动判据，是靠人翻源码撞见的。
 *
 * ── 判据 ──
 * 三个文件里 `ACCOUNT_RE` 的正则字面量必须逐字相同。**以后端为准**——它是真正
 * 拒绝请求的那一道；前端只是提前告知。
 *
 * 用法：node scripts/guardrails/check-account-rules.mjs
 */

import { readFileSync } from "node:fs";
import process from "node:process";

/** 第一项是权威（后端判据），其余必须与它一致。 */
const SITES = [
  {
    file: "services/identity/account/src/service/account.service.ts",
    what: "后端判据（assertValidAccount）",
  },
  {
    file: "portals/console/src/modules/onboarding/OnboardingPage.tsx",
    what: "console 首次补齐页",
  },
  {
    file: "portals/accounts/src/components/OnboardingPanel.tsx",
    what: "accounts 注册补齐页",
  },
];

/** 只取名为 ACCOUNT_RE 的那一条，避免误抓同文件里的 DEFAULT_ACCOUNT_RE 等。 */
const PATTERN = /^\s*const ACCOUNT_RE\s*=\s*(\/.+\/[a-z]*)\s*;/m;

// ── 自检：探测逻辑先过内置样本 ──────────────────────────────────────────────
const GOOD = 'const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;';
const OTHER = 'const DEFAULT_ACCOUNT_RE = /^_\\d+$/;';
if (PATTERN.exec(GOOD)?.[1] !== "/^[A-Za-z][A-Za-z0-9_]{2,23}$/") {
  console.error("自检失败：抽不出正则字面量 —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}
if (PATTERN.exec(OTHER)) {
  console.error("自检失败：DEFAULT_ACCOUNT_RE 被误抓 —— 判据失效");
  process.exit(1);
}

const found = [];
for (const site of SITES) {
  let src;
  try {
    src = readFileSync(site.file, "utf8");
  } catch {
    console.error(`读不到 ${site.file} —— 判据失效，拒绝给出通过结论`);
    process.exit(1);
  }
  const m = PATTERN.exec(src);
  if (!m) {
    console.error(
      `${site.file} 里找不到 \`const ACCOUNT_RE = /…/;\` —— 规则被挪走或改名了，` +
        "请更新本守卫的 SITES，别让它静默失效",
    );
    process.exit(1);
  }
  found.push({ ...site, re: m[1] });
}

const authority = found[0];
const drifted = found.slice(1).filter((f) => f.re !== authority.re);

console.log("══ 用户名规则一致性检查（check-account-rules）══");
console.log(`权威（${authority.what}）：${authority.re}\n`);

if (drifted.length > 0) {
  console.error(`以下 ${drifted.length} 处与后端判据不一致：`);
  for (const d of drifted) {
    console.error(`  ✗ ${d.file}`);
    console.error(`      ${d.what}：${d.re}`);
  }
  console.error(
    "\n改法：以**后端**为准逐字对齐——它是真正拒绝请求的那一道，前端只是提前告知。" +
      "\n前端比后端松 → 用户填得进去、提交被 400 拒；" +
      "前端比后端紧 → 后端接受的名字被拦下，用户永远不知道那可以用。" +
      "\n对齐时别忘了同一文件里的提示文案与 placeholder（位数写在那里）。",
  );
  console.error(`\n── 汇总 ──\nerror: ${drifted.length}`);
  process.exit(1);
}

console.log(`✓ ${found.length} 处用户名规则逐字一致。`);
console.log("\n── 汇总 ──\nerror: 0");
