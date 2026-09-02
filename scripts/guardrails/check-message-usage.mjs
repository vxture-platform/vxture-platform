// ═══════════════════════════════════════════════════════════════════════════
// check-message-usage.mjs — 代码里用到的 next-intl 键必须在 message 目录里存在。
//
// ── 补的是哪个盲区 ──
// next-intl 缺键不抛,各门户的 fallback 直接把键路径当文案渲染出来(见各
// `lib/intl.ts` 的 messageFallback)。于是 `tShared("filters.allKinds")` 引用一个
// 目录里没有的键,界面上就出现字面「filters.allKinds」——难看,且没有任何检查拦它。
// 2026-09-02 实测:arche 三页共 5 个这类空洞(filters.allKinds / actions.pause /
// actions.viewDetail / columns.updatedAt / common.clearFilters)一路进了生产,
// 筛选下拉直接显示键名。`check-message-catalogs` 只对 zh/en 两本做键对齐,管不到
// 「代码用了、两本都没有」这一层。本检查器补这一层。
//
// ── 判定范围:只查根译器 `tShared` ──
// 各门户约定 `const tShared = useTranslations()`(无命名空间,根译器),所以
// `tShared("a.b.c")` 的实参就是从根起的完整键路径,可直接比对目录。命名空间译器
// (`useTranslations("ns")` 后 `t("x")` → 真键 "ns.x")的相对键无法靠静态正则可靠
// 还原,不在本检查器范围内——只查 tShared 已零误报覆盖住实际踩到的那类缺口。
// 动态键(含 `${` / `{` / `*`)与无点的短键(多为命名空间相对键)跳过。
//
// 运行:pnpm lint:message-usage(node scripts/guardrails/check-message-usage.mjs)
// ═══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";

const PORTALS_DIR = path.join(process.cwd(), "portals");
const KEY_RE = /\btShared\(\s*"([^"]+)"/g;
// tShared 约定是根译器,但个别文件写成 `const tShared = useTranslations("ns")`
// (命名空间译器)。逐文件解析它的命名空间前缀,键=ns?`${ns}.${key}`:key。
const TSHARED_NS_RE = /const\s+tShared\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/;

function flatten(obj, pre, out) {
  for (const k in obj) {
    const v = obj[k];
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === "object") flatten(v, p, out);
    else out.add(p);
  }
}

function walk(dir, files) {
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    const s = fs.statSync(f);
    if (s.isDirectory()) walk(f, files);
    else if (/\.(tsx?|jsx?)$/.test(e)) files.push(f);
  }
}

const errors = [];
let scannedPortals = 0;

for (const portal of fs.readdirSync(PORTALS_DIR)) {
  const catFile = path.join(PORTALS_DIR, portal, "messages", "zh-CN.json");
  const srcDir = path.join(PORTALS_DIR, portal, "src");
  if (!fs.existsSync(catFile) || !fs.existsSync(srcDir)) continue;

  const cat = JSON.parse(fs.readFileSync(catFile, "utf8"));
  // 分片目录门户(如 website)的 zh-CN.json 只是个把命名空间指向 `./zh-CN/*.json`
  // 的存根,真词条在分片文件里。本检查器的单文件读法覆盖不了它们(会误报),显式跳过:
  // 只查单文件全量目录的门户(运营三平面 admin/opera/arche)。
  const isStub = Object.values(cat).some(
    (v) => typeof v === "string" && v.startsWith("./"),
  );
  if (isStub) continue;
  scannedPortals++;

  const keys = new Set();
  flatten(cat, "", keys);

  const files = [];
  walk(srcDir, files);

  const missing = new Map(); // key -> Set<file>
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const ns = src.match(TSHARED_NS_RE)?.[1]; // 该文件 tShared 的命名空间前缀(可空)
    let m;
    while ((m = KEY_RE.exec(src))) {
      const rel = m[1];
      if (/[{$*]/.test(rel)) continue; // 动态键,跳过
      if (!ns && !rel.includes(".")) continue; // 根译器下无点短键,当命名空间相对键跳过
      const key = ns ? `${ns}.${rel}` : rel;
      if (keys.has(key)) continue;
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(path.relative(process.cwd(), f));
    }
  }

  for (const [key, fset] of [...missing].sort()) {
    errors.push(
      `  ERROR [${portal}]  tShared("${key}") 在 messages 目录里不存在 —— 界面会渲染出字面键名。补进 zh/en 两本,或改用正确的键。\n           ← ${[...fset].join(", ")}`,
    );
  }
}

console.log("══ i18n 用键存在性检查（check-message-usage）══");
console.log(`扫描门户 ${scannedPortals} 个(portals/*/messages 存在者)。`);
if (errors.length) {
  for (const e of errors) console.log(e);
  console.log("\n── 汇总 ──");
  console.log(`error: ${errors.length}`);
  process.exit(1);
}
console.log("✓ 所有 tShared 根键均在对应门户目录里存在。");
console.log("\n── 汇总 ──");
console.log("error: 0");
