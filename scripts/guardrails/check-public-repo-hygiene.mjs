#!/usr/bin/env node
/**
 * check-public-repo-hygiene.mjs — keep infrastructure identifiers out of a
 * repository that is deliberately public.
 *
 * This repo is public by owner decision, and the edge deliberately serves a
 * wildcard certificate (`*.vxture.com`) so that individual hostnames never
 * reach Certificate Transparency logs. That design is only worth anything if
 * the same names are not committed here in plain text — a real hostname or a
 * tailnet address in git undoes the wildcard cert for free.
 *
 * Scope is deliberately narrow. Customer-facing hostnames (accounts / console
 * / api / www) are advertised to users and are NOT policed here; redacting a
 * name customers are told to type is theatre. What this guardrail enforces:
 *
 *   tailnet-ip     Tailscale CGNAT addresses (100.64.0.0/10) identify hosts
 *                  and, with the port, the internal service map. CIDR ranges
 *                  (`100.64.0.0/10`) are fine — those are the published
 *                  Tailscale/Aliyun allocations, not a host.
 *   ops-hostname   admin / opera are high-privilege operator surfaces; the
 *                  management-plane contract (product_250) requires the
 *                  placeholders `y.vxture.com` (admin) and `x.vxture.com`
 *                  (opera) in-repo, with the real name rendered at deploy
 *                  time from host runtime env.
 *   mail-host      the mail relay hostname, incl. addresses built on it.
 *
 * Run: node scripts/guardrails/check-public-repo-hygiene.mjs  (pnpm lint:public-hygiene)
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const RULES = [
  {
    id: "tailnet-ip",
    // 100.64.0.0/10. A trailing `/<digits>` means it is a CIDR range, not a host.
    test: (line) =>
      [...line.matchAll(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b(\/\d{1,2})?/g)]
        .filter((m) => !m[1])
        .map((m) => m[0]),
    fix: "use a placeholder such as <worker-01-tailnet-ip>, or render the address at deploy time from host runtime env",
  },
  {
    id: "ops-hostname",
    test: (line) => [...line.matchAll(/\b(?:admin|opera)\.vxture\.com\b/g)].map((m) => m[0]),
    fix: "use the contracted placeholder — y.vxture.com for admin, x.vxture.com for opera (product_250 §2)",
  },
  {
    id: "mail-host",
    test: (line) => [...line.matchAll(/\bmail\.vxture\.com\b/g)].map((m) => m[0]),
    fix: "use <mail-host>; the real relay is supplied via deploy/secrets/platform-mail.env",
  },
  {
    id: "aliyun-account-endpoint",
    // The ACR instance id and the mirror accelerator id are per-account and
    // identify the tenancy. Aliyun's shared service endpoints (dysmsapi,
    // dypnsapi, dashscope) are the same for everyone and are not matched.
    // Placeholders like <acr-instance> or crpi-* fail these patterns by design.
    test: (line) =>
      [
        ...line.matchAll(/\bcrpi-[a-z0-9]+\.[a-z0-9-]+\.personal\.cr\.aliyuncs\.com\b/g),
        ...line.matchAll(/\b[a-z0-9]{6,}\.mirror\.aliyuncs\.com\b/g),
      ].map((m) => m[0]),
    fix: "use a placeholder (<acr-instance>, <id>.mirror.aliyuncs.com) and supply the real endpoint from host runtime env",
  },
];

/**
 * Known-pending exceptions, as [file, rule] pairs. Empty, and meant to stay that
 * way: an entry here is debt, not a blessing. The nine deploy-time nginx and
 * compose files that used to sit in this list now interpolate
 * VX_WORKER0x_TAILNET_IP instead — compose from the exported process env,
 * nginx from an envsubst pass in 20-sync-nginx-config.sh. Add an entry only when
 * a file genuinely cannot take a placeholder yet, and delete it in the same PR
 * that fixes the file.
 */
const ALLOW = [];
const allowed = new Set(ALLOW.map(([f, r]) => `${f} ${r}`));

// This file states the very patterns it forbids, so it cannot police itself.
const SELF = "scripts/guardrails/check-public-repo-hygiene.mjs";

const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((f) => f !== SELF && !/\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|zip|lock)$/i.test(f));

const findings = [];
let allowHits = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    continue; // unreadable / binary — nothing to police
  }
  if (text.includes("\0")) continue;
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    if (allowed.has(`${file} ${rule.id}`)) {
      if (lines.some((l) => rule.test(l).length)) allowHits += 1;
      continue;
    }
    lines.forEach((line, i) => {
      for (const hit of rule.test(line)) {
        findings.push({ file, line: i + 1, rule: rule.id, hit, fix: rule.fix });
      }
    });
  }
}

if (findings.length) {
  console.error(`✗ public-repo hygiene: ${findings.length} infrastructure identifier(s) committed\n`);
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const [rule, list] of byRule) {
    console.error(`  [${rule}] ${list[0].fix}`);
    for (const f of list) console.error(`    ${f.file}:${f.line}  ${f.hit}`);
    console.error("");
  }
  process.exit(1);
}

console.log(
  `✓ public-repo hygiene: ${files.length} tracked files clean` +
    (allowHits ? ` (${allowHits} known-pending exception${allowHits > 1 ? "s" : ""} in ALLOW — see the list in this script)` : ""),
);
