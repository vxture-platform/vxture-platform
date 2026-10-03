#!/usr/bin/env node

/**
 * check-ops-threshold-env-parity.mjs — 待办阈值的两份 env example 逐行相等，且与代码真读的
 * env 名一个不多一个不少（2026-10-04 owner 裁定 3「通告尽量覆盖全」的 D8）。
 *
 * ── 补的是哪个盲区 ──
 * 运营待办的升档阈值（`OPS_ESCALATE_*`）与两个成熟阈值（`OPS_ORDER_AGING_HOURS` /
 * `OPS_REFUND_STUCK_HOURS`）由 `@vxture/service-ops-todos` 的 `opsTodoThresholds` 从
 * **本进程** env 读。它有两个进程在读：admin 待办页走 admin-bff（页面上的「已超时」标记），
 * 告警作业走 platform-api（升档通告）。两边值不同，页面说一回事、通告说另一回事，而且
 * 不报错。types.ts 明写「页面和作业读同一份」也包括阈值——那句话只有两份 env 一致才成立。
 *
 * 此前这十二个键在 deploy/ 的 example 里**一处都没登记**（只在 types.ts 注释与 spec 里），
 * 运维要调阈值无从下手；现在两份 example 各登记同一块，本守卫守三件事：
 *   ① 两份 example 里的阈值行（含注释掉的默认值行）**逐行逐字相等、顺序一致**；
 *   ② 两块的键集 == 仓储里 `positiveIntEnv("…")` 真读的 env 名集（登记了没读 / 读了没登记都红）；
 *   ③ 任一侧读到 0 行、或代码里解析到 0 个 env 名 → 红（判据瞎了不是通过）。
 *
 * ── 看不见什么 ──
 *   · 宿主机上的运行时 env 文件（`/srv/vxture/runtime/.env.*`）——它们不在仓里；两份运行时
 *     文件各自改了一边，本守卫不知道。example 里的注释写了「两边取同一个值」，那是运维纪律。
 *   · 值的**合理性**（默认值是设计提议，owner 可调）。
 *
 * 用法：node scripts/guardrails/check-ops-threshold-env-parity.mjs
 *       node scripts/guardrails/check-ops-threshold-env-parity.mjs --self-test
 *   不走根 package.json 的 lint:* 入口（改根 package.json 触发全栈 14 镜像重建），
 *   在 .github/workflows/ci.yml 里直接 `node` 跑。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PLATFORM_API = "deploy/.env.platform-api.example";
const ADMIN_BFF = "deploy/.env.admin-bff.example";
const REPO = "services/ops/todos/src/repository/pg-ops-todo.repository.ts";

/** 阈值行的形状：可带 `# ` 注释前缀（example 里登记的是默认值，运行时不设就走兜底）。 */
const KEY_LINE =
  /^#?\s*(OPS_ESCALATE_[A-Z0-9_]+|OPS_ORDER_AGING_HOURS|OPS_REFUND_STUCK_HOURS)=(.*)$/;

/** 一份 example 文本里的阈值行：`{ key, line }`，按出现顺序；行尾空白不算差异。 */
export function thresholdLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = KEY_LINE.exec(line);
    if (m) out.push({ key: m[1], line });
  }
  return out;
}

/** 仓储真读的 env 名：`positiveIntEnv("NAME", …)` 的第一个参数。 */
export function envNamesInCode(text) {
  return [...text.matchAll(/positiveIntEnv\(\s*\n?\s*"([A-Z0-9_]+)"/g)].map(
    (m) => m[1],
  );
}

/**
 * 三条判据，返回问题清单（空 = 通过）。
 * @param {{ a: {key:string,line:string}[], b: {key:string,line:string}[], codeNames: string[], labels: [string, string] }} p
 */
export function parityProblems({ a, b, codeNames, labels }) {
  const out = [];
  const [la, lb] = labels;
  if (a.length === 0) out.push(`${la} 里一行阈值都没读到——判据瞎了，不是通过。`);
  if (b.length === 0) out.push(`${lb} 里一行阈值都没读到——判据瞎了，不是通过。`);
  if (codeNames.length === 0)
    out.push(`${REPO} 里解析不到 positiveIntEnv("…") 的 env 名——判据瞎了，不是通过。`);
  if (out.length) return out;

  for (const [label, rows] of [
    [la, a],
    [lb, b],
  ]) {
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.key)) out.push(`${label} 里 ${r.key} 出现了两次。`);
      seen.add(r.key);
    }
  }

  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i]?.line;
    const y = b[i]?.line;
    if (x === y) continue;
    out.push(
      `第 ${i + 1} 行阈值两份不同：\n      ${la}: ${x ?? "（缺）"}\n      ${lb}: ${y ?? "（缺）"}`,
    );
  }

  const code = new Set(codeNames);
  const registered = new Set([...a, ...b].map((r) => r.key));
  const unread = [...registered].filter((k) => !code.has(k)).sort();
  const unregistered = [...code].filter((k) => !registered.has(k)).sort();
  if (unread.length) {
    out.push(
      `example 登记了、而 opsTodoThresholds 不读的 env：${unread.join(", ")}——运维改了它什么都不会发生。`,
    );
  }
  if (unregistered.length) {
    out.push(
      `opsTodoThresholds 读了、而 example 没登记的 env：${unregistered.join(", ")}——运维无从知道它存在；两份 example 都要加同一行。`,
    );
  }
  return out;
}

const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

// ── --self-test：合成文本证三态 ───────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  console.log("══ 自检：两份阈值块的相等性判据会动 ══\n");
  const labels = ["A", "B"];
  const code = [
    "OPS_ESCALATE_X_HOURS",
    "OPS_ESCALATE_Y_MINUTES",
    "OPS_ORDER_AGING_HOURS",
  ];
  const good = [
    "# prose that differs per file is fine",
    "# OPS_ESCALATE_X_HOURS=4",
    "# OPS_ESCALATE_Y_MINUTES=30",
    "# OPS_ORDER_AGING_HOURS=24",
  ].join("\n");
  const goodB = good.replace("prose that differs", "other prose");
  const codeText = code
    .map((k) => `x: positiveIntEnv(\n      "${k}",\n      1,\n    ),`)
    .join("\n");

  const run = (a, b, c = codeText) =>
    parityProblems({
      a: thresholdLines(a),
      b: thresholdLines(b),
      codeNames: envNamesInCode(c),
      labels,
    });

  say(run(good, goodB).length === 0, "正例：同一块（散文不同）→ 0 条");
  say(
    run(good, goodB.replace("=30", "=45")).some((m) => m.includes("第 2 行")),
    "反例一：一边把 Y 的默认值改成 45 → 报第 2 行不同",
  );
  say(
    run(good, goodB.replace(/\n# OPS_ORDER_AGING_HOURS=24$/, "")).some((m) =>
      m.includes("（缺）"),
    ),
    "反例二：一边少一行 → 报缺行",
  );
  say(
    run(good, goodB.replace("# OPS_ESCALATE_X_HOURS=4", "OPS_ESCALATE_X_HOURS=4")).some((m) => m.includes("第 1 行")),
    "反例三：一边取消注释（变成真值）→ 报第 1 行不同（注释掉的默认值与真值不是一回事）",
  );
  say(
    run("# nothing here", goodB).some((m) => m.includes("瞎了")),
    "反例四：一边读到 0 行 → 报判据瞎了，不是通过",
  );
  say(
    run(good, goodB, "no env reads here").some((m) => m.includes("瞎了")),
    "反例五：代码里解析不到 env 名 → 报判据瞎了，不是通过",
  );
  say(
    run(good, goodB, codeText + '\n  z: positiveIntEnv("OPS_ESCALATE_Z_HOURS", 1),').some((m) =>
      m.includes("OPS_ESCALATE_Z_HOURS") && m.includes("没登记"),
    ),
    "反例六：代码多读一个 env 而 example 没登记 → 报",
  );
  say(
    run(good + "\n# OPS_ESCALATE_W_HOURS=9", goodB + "\n# OPS_ESCALATE_W_HOURS=9").some((m) =>
      m.includes("OPS_ESCALATE_W_HOURS") && m.includes("不读"),
    ),
    "反例七：两份 example 都登记了一个代码不读的 env → 报（登记表不许过期）",
  );
  say(run(good, goodB).length === 0, "复原：又是 0 条");

  console.log(`\n── 汇总 ──\n看得见 ${9 - bad}/9 项`);
  if (bad) {
    console.log("判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("正例绿、七种反例各自红、复原绿。这个判据可以用了。");
  process.exit(0);
}

// ── 门禁 ─────────────────────────────────────────────────────────────────────
const a = thresholdLines(read(PLATFORM_API));
const b = thresholdLines(read(ADMIN_BFF));
const codeNames = envNamesInCode(read(REPO));
const problems = parityProblems({
  a,
  b,
  codeNames,
  labels: [PLATFORM_API, ADMIN_BFF],
});

console.log("══ 待办阈值 env 两份 example 对账（check-ops-threshold-env-parity）══");
console.log(
  `${PLATFORM_API}：${a.length} 行；${ADMIN_BFF}：${b.length} 行；仓储真读 ${codeNames.length} 个 env。`,
);
for (const r of a) console.log(`   ${r.line}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} 条`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n── 汇总 ──\nerror: " + problems.length);
  process.exit(1);
}
console.log("\n✓ 两份 example 的阈值块逐行相等，且与 opsTodoThresholds 真读的 env 名一个不多一个不少。");
console.log("\n── 汇总 ──\nerror: 0");
