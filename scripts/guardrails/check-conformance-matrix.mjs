#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 三方契约符合性矩阵 —— 每次重算，不靠记
//
// 背景：接口规范里有一张「platform / atlas / runos × 拒绝词表 × retryable」的
// 符合性表。这张表在 product_251 里被手写成一次快照，然后烂掉了——2026-08-29
// 复核时三行记载全部与代码不符，而且**人工复核自己也数错了两次**：
// 第一次把范围划成 packages/shared + services，数出 platform「0 处 retryable」；
// 实际 retryable 全在 bff/opera-bff（管理面，也正是 product_251 管的那个面）。
//
// 这个脚本就是那件事的结论：**范围写进代码，数由机器数。**
//
//   · 范围（SURFACES）是显式的。数字对不对，先看范围对不对——上一次错的是范围。
//   · 注释里的字不算数。用词法扫描剥注释，不是正则——正则会把注释里的
//     `retryable` 和代码里的算成一样，那正是第一次数错的第二个原因。
//   · 结果与 conformance.snapshot.json 比对，漂移即失败。要改数字得改快照，
//     是一次显式动作，会进 diff、会被评审看见。
//
// 用法：
//   node scripts/guardrails/check-conformance-matrix.mjs          比对快照，漂移退 1
//   node scripts/guardrails/check-conformance-matrix.mjs --update 重写快照
//   node scripts/guardrails/check-conformance-matrix.mjs --emit-html   打印文档用表格
//   node scripts/guardrails/check-conformance-matrix.mjs --root DIR    换个树测（自检用）
//
// 上游两仓（atlas / runos）不归本仓改，也不在 CI 里存在。只有显式给了
// VX_ATLAS_DIR / VX_RUNOS_DIR 才测；没给就标「未测」并**照原样带出快照里的旧值**，
// 同时在输出里点名说这行没复核过——不复核的行绝不冒充复核过。
// 给了但读不到 → 抛错，不兜底。
// ─────────────────────────────────────────────────────────────────────────────

import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const REPO_ROOT = resolve(
  valueOf("--root") ?? fileURLToPath(new URL("../../", import.meta.url)),
);
const SNAPSHOT = join(
  fileURLToPath(new URL("./", import.meta.url)),
  "conformance.snapshot.json",
);

// ── 范围 ────────────────────────────────────────────────────────────────────
// 每个面写清「它是什么」和「凭什么归到这张表里」。上一次数错就错在这里没写下来。
const SURFACES = [
  {
    key: "opera-bff",
    label: "Platform · 管理面",
    dir: "bff/opera-bff/src",
    governed: true, // product_251 的正身。四码与 retryable 都必须在。
    note: "product_251 管的就是这个面",
    // 封套形状按声明判，不按出现次数判——次数说明不了字段在不在类型上。
    envelope: {
      file: "bff/opera-bff/src/errors/api-error.ts",
      iface: "ErrorEnvelope",
      required: ["code", "message", "retryable"],
      optional: ["field"],
    },
  },
  {
    key: "admin-bff",
    label: "Platform · 运营后台",
    dir: "bff/admin-bff/src",
    governed: false, // 自有面，不受管理面词表约束；atlas-contract.ts 是代理回显。
    note: "自有面，只透传 atlas 契约",
  },
  {
    key: "console-bff",
    label: "Platform · 租户台",
    dir: "bff/console-bff/src",
    governed: false,
    note: "自有面，用 shared 的通用信封",
  },
  {
    key: "shared",
    label: "Platform · 公共信封",
    dir: "packages/shared/shared/src/errors",
    governed: false, // 通用错误类型，与管理面封套是两套，别混着数。
    note: "通用信封，非管理面封套",
  },
];

const UPSTREAMS = [
  { key: "atlas", label: "Atlas", env: "VX_ATLAS_DIR", dir: "service" },
  { key: "runos", label: "Runos", env: "VX_RUNOS_DIR", dir: "service" },
];

/** 拒绝词表（X-1）。三方共用，不带模块前缀。 */
const REJECTION_CODES = [
  "NOT_ENTITLED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "QUOTA_EXCEEDED",
];

/**
 * 小写码的已登记豁免。
 * atlas 把 QUOTA_EXCEEDED 转小写当 Prometheus 标签用
 * （`model_requests_total{status=...}`）——那是指标词表，不是拒绝码词表，
 * 两套刻意分开。改标签名会打断跨部署的时间序列，且没有收益。
 */
const LOWERCASE_EXEMPT = new Set(["quota_exceeded"]);

// ── 词法扫描：剥注释，只留代码 ──────────────────────────────────────────────
/**
 * 按 JS/TS 词法走一遍，产出「去掉注释的源码」（注释位置以空格填充，行号不变）。
 *
 * 不用正则的原因很具体：本仓的守卫脚本自己就写着 `/"/` 这类含引号的正则字面量，
 * 拿正则剥注释会在那里把引号当成字符串起点，之后整段错位。所以这里按 token
 * 走，并用「上一个有意义的字符」判 `/` 是除号还是正则起点——这是标准判法。
 *
 * 扫完必须停在 normal 态。停不下来说明这个判法在这份文件上不成立，
 * 那就抛——读不出来就别给数字。
 */
function stripComments(src, fileLabel) {
  const out = new Array(src.length);
  let state = "normal"; // normal | line | block | sq | dq | tpl | regex
  let prevSignificant = "";

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    let keep = true;

    switch (state) {
      case "normal":
        if (c === "/" && n === "/") {
          state = "line";
          keep = false;
        } else if (c === "/" && n === "*") {
          state = "block";
          keep = false;
        } else if (c === "'") state = "sq";
        else if (c === '"') state = "dq";
        else if (c === "`") state = "tpl";
        else if (c === "/" && regexCanStart(prevSignificant)) state = "regex";
        break;
      case "line":
        keep = false;
        if (c === "\n") {
          state = "normal";
          keep = true;
        }
        break;
      case "block":
        keep = false;
        if (c === "\n")
          keep = true; // 保住行号
        else if (c === "*" && n === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i++;
          state = "normal";
          continue;
        }
        break;
      case "sq":
      case "dq":
      case "tpl":
      case "regex":
        if (c === "\\") {
          out[i] = c;
          out[i + 1] = src[i + 1] ?? "";
          i++;
          continue;
        }
        if (state === "sq" && c === "'") state = "normal";
        else if (state === "dq" && c === '"') state = "normal";
        else if (state === "tpl" && c === "`") state = "normal";
        else if (state === "regex" && (c === "/" || c === "\n"))
          state = "normal";
        break;
    }

    out[i] = keep ? c : c === "\n" ? "\n" : " ";
    if (state === "normal" && !/\s/.test(c)) prevSignificant = c;
  }

  if (state !== "normal") {
    throw new Error(
      `词法扫描在 ${fileLabel} 结束时停在 "${state}" 态——这份文件上判法不成立，` +
        `不给数字。修扫描器，别改这里的判定。`,
    );
  }
  return out.join("");
}

/** `/` 能不能是正则起点：看上一个有意义的字符。 */
function regexCanStart(prev) {
  if (prev === "") return true;
  return !/[A-Za-z0-9_$)\]}'"`]/.test(prev);
}

// ── 采集 ────────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name))
      out.push(full);
  }
  return out;
}

function measure(absDir, label) {
  const files = walk(absDir);
  const counts = { files: files.length, retryable: 0, lowercase: [] };
  for (const c of REJECTION_CODES) counts[c] = 0;

  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"), file);

    // retryable 作为标识符或属性名出现的次数（形状另由 checkEnvelope 按声明判）
    counts.retryable += (code.match(/\bretryable\b/g) ?? []).length;

    // 拒绝码：只认字符串字面量里的整词
    for (const c of REJECTION_CODES) {
      counts[c] += (
        code.match(new RegExp(`["'\`]${c}["'\`]`, "g")) ?? []
      ).length;
    }

    // 小写变体：违规信号（豁免的除外）
    for (const c of REJECTION_CODES) {
      const lc = c.toLowerCase();
      if (LOWERCASE_EXEMPT.has(lc)) continue;
      if (new RegExp(`["'\`]${lc}["'\`]`).test(code)) {
        counts.lowercase.push({
          code: lc,
          file: file.slice(absDir.length + 1).replace(/\\/g, "/"),
        });
      }
    }
  }
  void label;
  return counts;
}

// ── 跑 ──────────────────────────────────────────────────────────────────────
const measured = {};
const problems = [];

for (const s of SURFACES) {
  const abs = join(REPO_ROOT, s.dir);
  if (!existsSync(abs)) {
    // 本仓自己的路径读不到 = 范围定义已经和仓库对不上了。抛。
    throw new Error(
      `范围 ${s.key} 指向 ${s.dir}，但这个目录不存在——范围定义已过期，先改 SURFACES。`,
    );
  }
  measured[s.key] = {
    ...measure(abs, s.key),
    verified: true,
    label: s.label,
    note: s.note,
  };
}

const unverified = [];
for (const u of UPSTREAMS) {
  const configured = process.env[u.env];
  if (!configured) {
    unverified.push(u.key);
    measured[u.key] = { verified: false, label: u.label };
    continue;
  }
  const abs = join(resolve(configured), u.dir);
  if (!existsSync(abs)) {
    throw new Error(
      `${u.env}=${configured} 已给出，但 ${abs} 读不到——给了就得能测，不兜底。`,
    );
  }
  measured[u.key] = { ...measure(abs, u.key), verified: true, label: u.label };
}

// ── 受治理面的硬断言 ────────────────────────────────────────────────────────
for (const s of SURFACES.filter((x) => x.governed)) {
  const m = measured[s.key];
  if (m.retryable === 0) {
    problems.push(
      `${s.label}：封套里一个 retryable 都没有——${s.note}，这条是必备`,
    );
  }
  for (const c of REJECTION_CODES) {
    if (m[c] === 0) {
      problems.push(`${s.label}：拒绝词表缺 \`${c}\`（0 处）`);
    }
  }
  if (s.envelope) problems.push(...checkEnvelope(s));
}

/**
 * 封套形状：从声明里读，不数出现次数。
 * 读不到接口就抛——「这个面没有封套」和「本脚本找不到封套」是两回事，
 * 后者冒充前者会让守卫在重构后静静地变成永远通过。
 */
function checkEnvelope(surface) {
  const { file, iface, required, optional } = surface.envelope;
  const abs = join(REPO_ROOT, file);
  if (!existsSync(abs)) {
    throw new Error(`封套文件 ${file} 不存在——范围定义已过期，先改 SURFACES。`);
  }
  const src = stripComments(readFileSync(abs, "utf8"), abs);
  const block = src.match(
    new RegExp(String.raw`interface\s+${iface}\s*\{([\s\S]*?)\n\}`),
  )?.[1];
  if (!block) {
    throw new Error(
      `在 ${file} 里找不到 interface ${iface}——本检测器靠它判封套，找不到就不给结论。`,
    );
  }
  const declared = new Map(
    [...block.matchAll(/^\s*([a-zA-Z][\w]*)(\??)\s*:/gm)].map((m) => [
      m[1],
      m[2] === "?",
    ]),
  );
  const out = [];
  for (const f of required) {
    if (!declared.has(f))
      out.push(`${surface.label}：封套 ${iface} 缺必备字段 \`${f}\``);
    else if (declared.get(f))
      out.push(
        `${surface.label}：封套 ${iface} 的 \`${f}\` 是可选的——必备字段不能可选，调用方会读到 undefined`,
      );
  }
  for (const f of optional) {
    if (!declared.has(f))
      out.push(
        `${surface.label}：封套 ${iface} 缺 \`${f}\`——校验类错误没法指向具体入参`,
      );
  }
  return out;
}

for (const [key, m] of Object.entries(measured)) {
  for (const bad of m.lowercase ?? []) {
    problems.push(
      `${m.label}：\`${bad.code}\` 小写出现在 ${bad.file}——拒绝码一律大写，指标标签要豁免请写进 LOWERCASE_EXEMPT 并说明理由`,
    );
  }
  void key;
}

// ── 快照比对 ────────────────────────────────────────────────────────────────
const shape = (m) =>
  m.verified
    ? Object.fromEntries(
        ["files", "retryable", ...REJECTION_CODES].map((k) => [k, m[k]]),
      )
    : null;

const current = Object.fromEntries(
  Object.entries(measured).map(([k, m]) => [k, shape(m)]),
);

if (has("--update")) {
  const prior = existsSync(SNAPSHOT)
    ? JSON.parse(readFileSync(SNAPSHOT, "utf8"))
    : { surfaces: {} };
  // 未测的行不写空——保留上一次测到的值，并记下它是哪次测的。
  const merged = { ...prior.surfaces };
  for (const [k, v] of Object.entries(current)) if (v) merged[k] = v;
  writeFileSync(
    SNAPSHOT,
    JSON.stringify(
      {
        note: "由 check-conformance-matrix.mjs --update 生成，勿手改",
        surfaces: merged,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ 快照已重写：${SNAPSHOT}`);
  if (unverified.length)
    console.log(`  未测（保留旧值）：${unverified.join(" / ")}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error("✗ 找不到 conformance.snapshot.json——先跑一次 --update 立基线");
  process.exit(1);
}
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")).surfaces;

const drift = [];
for (const [k, v] of Object.entries(current)) {
  if (!v) continue; // 未测的不比，也不算过
  const was = snap[k];
  if (!was) {
    drift.push(`${k}：快照里没有这个面`);
    continue;
  }
  for (const field of Object.keys(v)) {
    if (was[field] !== v[field])
      drift.push(`${k}.${field}：快照 ${was[field]} → 实测 ${v[field]}`);
  }
}

// ── HTML 片段 ───────────────────────────────────────────────────────────────
if (has("--emit-html")) {
  const cell = (m, k) =>
    !m || !m.verified
      ? `<td><span class="tag t-low">未测</span></td>`
      : m[k] > 0
        ? `<td class="ok">${m[k]} 处</td>`
        : `<td><span class="tag t-req">0 处</span></td>`;
  const cols = ["opera-bff", "atlas", "runos"];
  const rows = ["retryable", ...REJECTION_CODES]
    .map(
      (k) =>
        `          <tr><td><code>${k}</code></td>${cols.map((c) => cell(measured[c], k)).join("")}</tr>`,
    )
    .join("\n");
  console.log(`    <div class="tw">
      <table>
        <thead><tr><th>项</th><th>Platform · 管理面</th><th>Atlas</th><th>Runos</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`);
}

// ── 报告 ────────────────────────────────────────────────────────────────────
const fatal = problems.length + drift.length;

if (unverified.length) {
  console.error(
    `⚠ 未复核：${unverified.map((k) => measured[k].label).join(" / ")}`,
  );
  console.error(`  这几行的数字来自上一次测量，本次没有验证。要复核：`);
  for (const u of UPSTREAMS.filter((x) => unverified.includes(x.key))) {
    console.error(
      `    ${u.env}=<path-to-${u.key}-repo> node scripts/guardrails/check-conformance-matrix.mjs`,
    );
  }
}

if (fatal === 0) {
  const n = Object.values(measured).filter((m) => m.verified).length;
  console.log(`✓ 符合性矩阵：${n} 个面实测，与快照一致`);
  process.exit(0);
}

if (problems.length) {
  console.error(`\n✗ 契约违规 ${problems.length} 处：`);
  for (const p of problems) console.error(`  · ${p}`);
}
if (drift.length) {
  console.error(`\n✗ 与快照漂移 ${drift.length} 处：`);
  for (const d of drift) console.error(`  · ${d}`);
  console.error(`\n  数字变了不一定是坏事，但必须是**有人看着**变的。`);
  console.error(
    `  确认无误后：node scripts/guardrails/check-conformance-matrix.mjs --update`,
  );
}
process.exit(1);
