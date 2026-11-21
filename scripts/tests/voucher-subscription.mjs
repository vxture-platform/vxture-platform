/**
 * voucher-subscription.mjs - Isolated voucher domain and source protection acceptance.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Only basic process settings survive; no existing database, Redis or secrets.
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "bff/admin-bff/package.json"));
const ts = require("typescript");
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const env = { NODE_ENV: "test", TZ: "UTC", NO_COLOR: "1" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      key,
    )
  )
    env[key] = value;
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-subscription", id);
mkdirSync(output, { recursive: true });
const scope = {
  files: [
    {
      path: "services/commerce/subscription/src/index.ts",
    },
    {
      path: "services/commerce/subscription/src/repository/pg-order.repository.ts",
    },
    {
      path: "services/commerce/subscription/src/repository/pg-subscription.repository.ts",
    },
    {
      path: "services/commerce/subscription/src/service/order.service.ts",
    },
    {
      path: "services/commerce/subscription/src/service/order.service.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/service/subscription.service.ts",
    },
    {
      path: "services/commerce/subscription/src/types/subscription.types.ts",
    },
    {
      path: "services/commerce/subscription/src/service/expiry-sweep.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/service/subscription-provisioning.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/money/refund-sources.ts",
    },
    {
      path: "services/commerce/subscription/src/money/refund-sources.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/repository/refund-settlement.ts",
    },
    {
      path: "services/commerce/subscription/src/repository/refund-settlement.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/service/subscription-redemption.ts",
    },
    {
      path: "services/commerce/subscription/src/service/subscription-extension.ts",
    },
    {
      path: "services/commerce/subscription/src/repository/order-purchase-guards.spec.ts",
    },
    {
      path: "services/commerce/subscription/src/service/order-purchase-payment.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/orders.router.ts",
    },
    {
      path: "bff/admin-bff/src/routers/order-wallet-balance.itest.spec.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-subscription.itest.spec.ts",
    },
    {
      path: "scripts/tests/voucher-subscription.mjs",
    },
    {
      path: "services/commerce/promotion/src/repository/refund-compensations.ts",
    },
    {
      path: "bff/admin-bff/src/routers/voucher-promotion.itest.spec.ts",
    },
  ],
};
const fingerprint = () =>
  Object.fromEntries(
    scope.files.map(({ path }) => [
      path,
      existsSync(join(root, path))
        ? createHash("sha256")
            .update(readFileSync(join(root, path)))
            .digest("hex")
        : null,
    ]),
  );
const report = {
  batch: "S07-R2c2",
  runId: id,
  startedAt: new Date().toISOString(),
  groups: [],
  checks: [],
  sourceBefore: fingerprint(),
  containers: [],
  limitations: [
    "Uses synthetic isolated data and restricted console/admin roles; no existing services, authentication ceremony, deployment or product integration.",
    "Full HTTP entry points and recovery job wiring remain S07-R3; production build, delivery and release require later gates.",
  ],
};
const docker = (args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const paths = ts.readConfigFile(
  join(root, "tsconfig.base.json"),
  ts.sys.readFile,
).config.compilerOptions.paths;
// Check workspace sources without requiring unrelated prebuilt dist artifacts.
for (const [name, source] of Object.entries({
  "@vxture/core-mail": "packages/core/mail/src/index.ts",
  "@vxture/core-oidc-rp": "packages/core/oidc-rp/src/index.ts",
  "@vxture/core-identity-sdk": "packages/core/identity-sdk/src/index.ts",
  "@vxture/core-config/openapi": "packages/core/config/src/utils/openapi.ts",
  "@vxture/core-utils/phone": "packages/core/utils/src/utils/phone.utils.ts",
}))
  paths[name] = [source];
const aliases = Object.entries(paths)
  .sort(
    ([left], [right]) =>
      Number(left.endsWith("/*")) - Number(right.endsWith("/*")) ||
      right.length - left.length,
  )
  .map(([name, targets]) => {
    const wildcard = name.endsWith("/*");
    let replacement = resolve(root, targets[0].replace(/\/\*$/, ""));
    if (
      !wildcard &&
      existsSync(replacement) &&
      statSync(replacement).isDirectory()
    )
      replacement = join(replacement, "index.ts");
    const pattern = wildcard
      ? "^" + escaped(name.slice(0, -1))
      : "^" + escaped(name) + "$";
    return `{find:new RegExp(${JSON.stringify(pattern)}),replacement:${JSON.stringify(replacement + (wildcard ? "/" : ""))}}`;
  });
const config = join(output, "vitest.config.mjs");
writeFileSync(
  config,
  `export default {resolve:{alias:[${aliases.join(",")}]},test:{environment:"node",include:["src/**/*.spec.ts"],testTimeout:30000,hookTimeout:60000}};`,
);

/** Run one bounded local command with a complete, sanitized log. */
async function run(name, args, cwd = root, extra = {}) {
  const stream = createWriteStream(join(output, name + ".log"));
  let code;
  try {
    code = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env: { ...env, ...extra },
        windowsHide: true,
        timeout: 240000,
      });
      child.stdout.pipe(stream, { end: false });
      child.stderr.pipe(stream, { end: false });
      child.once("error", reject);
      child.once("close", (c) => accept(c ?? 1));
    });
  } finally {
    await new Promise((done) => stream.end(done));
  }
  return code;
}
/** Each required group must execute every selected file with no skipped tests. */
async function group(name, directory, files, flags = {}) {
  console.log("[S07-R2c2] " + name);
  const resultFile = join(output, name + ".json");
  const code = await run(
    name,
    [
      vitest,
      "run",
      ...files,
      "--config",
      config,
      "--maxWorkers=1",
      "--reporter=default",
      "--reporter=json",
      "--outputFile",
      resultFile,
    ],
    join(root, directory),
    flags,
  );
  let result;
  try {
    result = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch {}
  const present = files.every((file) =>
    result?.testResults?.some((s) =>
      s.name.replaceAll("\\", "/").endsWith(file),
    ),
  );
  const ok =
    code === 0 &&
    result?.success === true &&
    present &&
    result.numPassedTests > 0 &&
    result.numPendingTests === 0;
  report.groups.push({
    name,
    ok,
    exitCode: code,
    passed: result?.numPassedTests ?? 0,
    failed: result?.numFailedTests ?? null,
    skipped: result?.numPendingTests ?? null,
    selectedFilesPresent: present,
  });
  console.log(JSON.stringify(report.groups.at(-1)));
}

// ============================================================================
// Suites own their exact container ID + label; fallback cleanup repeats ownership.
// ============================================================================
let failure;
try {
  await group("promotion", "services/commerce/promotion", [
    "src/management/batch-input.spec.ts",
    "src/management/claim-credentials.spec.ts",
    "src/money/settlement-math.spec.ts",
    "src/repository/pg-promotion.repository.spec.ts",
    "src/service/promotion.service.spec.ts",
  ]);
  await group("subscription", "services/commerce/subscription", [
    "src/money/proration.spec.ts",
    "src/money/refund-sources.spec.ts",
    "src/repository/order-lifecycle.spec.ts",
    "src/repository/order-purchase-guards.spec.ts",
    "src/repository/refund-settlement.spec.ts",
    "src/service/add-cycle.spec.ts",
    "src/service/addon-lifecycle.spec.ts",
    "src/service/addon-notifications.spec.ts",
    "src/service/expiry-sweep.spec.ts",
    "src/service/metering-read.service.spec.ts",
    "src/service/operator-renew-notify.spec.ts",
    "src/service/order-purchase-payment.spec.ts",
    "src/service/order.service.spec.ts",
    "src/service/product-maintenance-sweep.spec.ts",
    "src/service/service-axis-writers.spec.ts",
    "src/service/subscription-provisioning.spec.ts",
    "src/service/suspension-term-extension.spec.ts",
    "src/service/trial-expiry-sweep.spec.ts",
    "src/service/usage-periods.spec.ts",
    "src/types/subscription.types.spec.ts",
  ]);
  await group(
    "voucher-domain",
    "bff/admin-bff",
    ["src/routers/voucher-promotion.itest.spec.ts"],
    { VOUCHER_PROMOTION_ITEST: "1" },
  );
  await group(
    "wallet-regression",
    "bff/admin-bff",
    [
      "src/routers/order-wallet-balance.itest.spec.ts",
      "src/providers/commerce-services.provider.spec.ts",
    ],
    { WALLET_BALANCE_ITEST: "1" },
  );
  await group(
    "voucher-subscription",
    "bff/admin-bff",
    ["src/routers/voucher-subscription.itest.spec.ts"],
    { VOUCHER_SUBSCRIPTION_ITEST: "1" },
  );
  await group(
    "billing",
    "services/commerce/billing",
    [
      "src/repository/wallet-money.spec.ts",
      "src/repository/wallet-ledger.itest.spec.ts",
    ],
    { WALLET_LEDGER_ITEST: "1" },
  );
  await group("console-wiring", "bff/console-bff", [
    "src/services/customer-notifications.wiring.spec.ts",
  ]);
  for (const pkg of [
    "services/commerce/promotion",
    "services/commerce/subscription",
    "bff/admin-bff",
    "bff/console-bff",
  ]) {
    const name = "types-" + pkg.split("/").at(-1);
    const typeConfig = join(output, name + ".tsconfig.json");
    writeFileSync(
      typeConfig,
      JSON.stringify(
        {
          extends: join(root, pkg, "tsconfig.json"),
          // Source-mode checking includes the identity SDK's browser entry points.
          compilerOptions: {
            lib: ["ES2023", "DOM"],
            paths: Object.fromEntries(
              Object.entries(paths).map(([name, targets]) => [
                name,
                targets.map((target) => resolve(root, target)),
              ]),
            ),
          },
        },
        null,
        2,
      ),
    );
    const code = await run(name, [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--project",
      typeConfig,
    ]);
    report.checks.push({ name, ok: code === 0, exitCode: code });
    console.log(name + ": " + code);
  }
} catch (error) {
  failure = String(error);
} finally {
  for (const name of [
    "voucher-domain",
    "wallet-regression",
    "voucher-subscription",
    "billing",
  ]) {
    const log = existsSync(join(output, name + ".log"))
      ? readFileSync(join(output, name + ".log"), "utf8")
      : "";
    const owned = [
      ...log.matchAll(
        /S07_R2(?:C1|C2|A|B)_CONTAINER_OWNERSHIP=(\{[^\r\n]+\})/g,
      ),
    ].map((m) => JSON.parse(m[1]));
    const cleaned = [
      ...log.matchAll(/S07_R2(?:C1|C2|A|B)_CONTAINER_CLEANED=([a-z0-9-]+)/g),
    ].map((m) => m[1]);
    for (const container of owned) {
      const record = {
        ...container,
        cleanedByOwnedSuite: cleaned.includes(container.name),
        fallbackCleaned: false,
        remaining: true,
        error: null,
      };
      try {
        if (
          !/^[a-f0-9]{64}$/.test(container.id) ||
          !/^[a-z0-9-]+$/.test(container.name)
        )
          throw new Error("Malformed container ownership receipt");
        let remaining = docker([
          "ps",
          "-aq",
          "--no-trunc",
          "--filter",
          "name=^/" + container.name + "$",
        ]).trim();
        if (remaining) {
          const info = JSON.parse(docker(["inspect", container.name]))[0];
          if (
            remaining !== container.id ||
            info.Id !== container.id ||
            info.Config.Labels["codex.run"] !== container.runId
          )
            throw new Error("Container ownership changed; cleanup refused");
          docker(["rm", "--force", "--volumes", container.id]);
          record.fallbackCleaned = true;
          remaining = docker([
            "ps",
            "-aq",
            "--no-trunc",
            "--filter",
            "name=^/" + container.name + "$",
          ]).trim();
        }
        record.remaining = remaining !== "";
      } catch (error) {
        record.error = String(error);
      }
      report.containers.push(record);
    }
  }
  report.sourceAfter = fingerprint();
  report.sourceUnchanged =
    JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.error = failure ?? null;
  report.finishedAt = new Date().toISOString();
  report.ok =
    !failure &&
    report.groups.length === 7 &&
    report.groups.every((g) => g.ok) &&
    report.checks.length === 4 &&
    report.checks.every((c) => c.ok) &&
    report.containers.length === 4 &&
    report.containers.every(
      (c) =>
        (c.cleanedByOwnedSuite || c.fallbackCleaned) &&
        !c.remaining &&
        !c.error,
    ) &&
    report.sourceUnchanged;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(root, "output/voucher-subscription-current.json"),
    JSON.stringify({ directory: output, ok: report.ok }, null, 2),
  );
  console.log("REPORT=" + join(output, "report.json"));
  if (!report.ok) process.exitCode = 1;
}
