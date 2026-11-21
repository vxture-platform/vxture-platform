/**
 * voucher-console-ui.mjs - Offline Console voucher UI typing, DOM and bundle acceptance.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  readdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// No inherited secrets, upstreams, service connections or dependency installation.
// ============================================================================
const root = fileURLToPath(new URL("../../", import.meta.url));
const portal = join(root, "portals/console");
const require = createRequire(join(root, "bff/admin-bff/package.json"));
const portalRequire = createRequire(join(portal, "package.json"));
const ts = require("typescript");
const esbuild = require("esbuild");
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const id =
  new Date().toISOString().replaceAll(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const output = join(root, "output/voucher-console-ui", id);
mkdirSync(output, { recursive: true });
const files = [
  "portals/console/src/api/console-bff.ts",
  "portals/console/src/modules/commerce/VouchersPage.tsx",
  "portals/console/src/modules/commerce/VoucherClaimDialog.tsx",
  "portals/console/src/modules/commerce/SubscriptionRedemptionDialog.tsx",
  "portals/console/src/modules/commerce/SubscriptionExtensionDialog.tsx",
  "portals/console/src/modules/commerce/RechargeCardDialog.tsx",
  "portals/console/src/modules/commerce/SubscribePage.tsx",
  "portals/console/src/modules/commerce/components/OrdersSection.tsx",
  "portals/console/src/modules/commerce/components/OrderDetailPanel.tsx",
  "portals/console/messages/zh-CN.json",
  "portals/console/messages/en-US.json",
  "portals/console/src/api/voucher-operations.test.ts",
  "portals/console/src/modules/commerce/voucher-management.ui.test.tsx",
  "scripts/tests/voucher-console-ui.mjs",
];
const fingerprint = () =>
  Object.fromEntries(
    files.map((p) => [
      p,
      existsSync(join(root, p))
        ? createHash("sha256")
            .update(readFileSync(join(root, p)))
            .digest("hex")
        : null,
    ]),
  );
const report = {
  batch: "S07-R4b",
  runId: id,
  startedAt: new Date().toISOString(),
  sourceBefore: fingerprint(),
  checks: [],
  groups: [],
  limitations: [
    "All HTTP is mocked; rendered DOM tests use real business components with substituted design-system primitives; one recharge dialog is separately rendered with installed primitives. No real BFF, database, Redis, products, messages or login.",
    "Local lint resolves the installed React Hooks and Next plugins from the pnpm store using an output-only loader; rules remain unchanged. Missing generated identity-sdk and core-utils dist prerequisites are mapped to their public sources in output-only configs. The browser bundle separately resolves real installed design-system components. DOM checks do not prove browser layout, product entry integration, Next production startup or online behavior.",
    "Browser assembly prunes unused Node crypto imports from the broad public core-utils index without stubbing functions; any retained crypto external fails the gate. Uses existing dependency files only. The standard frozen-lock build and clean checkout gates remain in S07-R5; no deployment or Git mutation.",
  ],
};
const env = { NODE_ENV: "test", TZ: "UTC", NO_COLOR: "1" };
for (const [k, v] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(
      k,
    )
  )
    env[k] = v;
async function run(name, args, cwd = root, extra = {}) {
  const log = createWriteStream(join(output, name + ".log"));
  try {
    return await new Promise((accept, reject) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env: { ...env, ...extra },
        windowsHide: true,
        timeout: 240000,
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.once("error", reject);
      child.once("close", (code) => accept(code ?? 1));
    });
  } finally {
    await new Promise((done) => log.end(done));
  }
}
function check(name, ok, evidence = {}) {
  report.checks.push({ name, ok, ...evidence });
  console.log(JSON.stringify(report.checks.at(-1)));
}

// ============================================================================
// Retain the complete strict Console configuration, with output-only artifacts.
// ============================================================================
let failure;
try {
  const original = ts.readConfigFile(
    join(portal, "tsconfig.json"),
    ts.sys.readFile,
  ).config;
  const paths = Object.fromEntries(
    Object.entries(original.compilerOptions.paths).map(([key, values]) => [
      key,
      values.map((value) => resolve(portal, value)),
    ]),
  );
  // Public-source aliases replace absent local dist files without changing package configs.
  for (const [name, source] of Object.entries({
    "@vxture/core-identity-sdk": "packages/core/identity-sdk/src/index.ts",
    "@vxture/core-identity-sdk/edge": "packages/core/identity-sdk/src/edge.ts",
    "@vxture/core-utils": "packages/core/utils/src/index.ts",
    "@vxture/core-utils/phone": "packages/core/utils/src/utils/phone.utils.ts",
  }))
    paths[name] = [join(root, source)];
  paths["@vxture/core-locale"] = [
    join(root, "packages/core/locale/src/index.ts"),
  ];
  paths.vitest = [
    join(dirname(require.resolve("vitest/package.json")), "dist/index.d.ts"),
  ];
  const config = join(output, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify(
      {
        extends: join(portal, "tsconfig.json"),
        compilerOptions: { paths, incremental: false, noEmit: true },
        include: [join(portal, "next-env.d.ts"), join(portal, "src/**/*")],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
  );
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  const strict =
    parsed?.options.strict === true &&
    parsed.options.exactOptionalPropertyTypes === true &&
    parsed.options.noUncheckedIndexedAccess === true;
  if (!strict) throw new Error("Strict Console configuration was weakened");
  check(
    "full-console-strict-typecheck",
    (await run("typecheck", [
      require.resolve("typescript/bin/tsc"),
      "--project",
      config,
      "--pretty",
      "false",
    ])) === 0,
    { files: parsed.fileNames.length, strict },
  );

  // Load the installed Hooks plugin from its pnpm store; do not install or weaken rules.
  const store = join(root, "node_modules/.pnpm");
  const pluginPaths = {};
  for (const [name, prefix] of [
    ["eslint-plugin-react-hooks", "eslint-plugin-react-hooks@"],
    ["@next/eslint-plugin-next", "@next+eslint-plugin-next@"],
  ]) {
    const folder = readdirSync(store).find((item) => item.startsWith(prefix));
    if (!folder) throw new Error("Existing lint plugin missing: " + name);
    pluginPaths[name] = join(store, folder, "node_modules", name);
  }
  const preload = join(output, "lint-resolution.cjs");
  writeFileSync(
    preload,
    `const Module=require('node:module');const paths=${JSON.stringify(pluginPaths)};const resolve=Module._resolveFilename;Module._resolveFilename=function(request,...args){return resolve.call(this,paths[request]??request,...args)};`,
  );
  check(
    "changed-console-source-lint",
    (await run(
      "lint",
      [
        "--require",
        preload,
        join(dirname(require.resolve("eslint/package.json")), "bin/eslint.js"),
        ...files
          .filter((p) => p.startsWith("portals/console/src/"))
          .map((p) => p.slice("portals/console/".length)),
        "--no-cache",
        "--max-warnings=0",
      ],
      portal,
    )) === 0,
  );

  // Set up a local DOM without allowing jsdom resources or a real fetch fallback.
  const jsdomFolder = readdirSync(join(root, "node_modules/.pnpm")).find(
    (name) => name.startsWith("jsdom@"),
  );
  if (!jsdomFolder)
    throw new Error(
      "Existing jsdom runtime missing; installation is not allowed",
    );
  const jsdom = join(
    root,
    "node_modules/.pnpm",
    jsdomFolder,
    "node_modules/jsdom/lib/api.js",
  );
  const setup = join(output, "dom-setup.mjs");
  writeFileSync(
    setup,
    `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {JSDOM}=require(${JSON.stringify(jsdom)});const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://voucher-ui.invalid',pretendToBeVisual:true});for(const key of ['window','document','navigator','Element','Node','NodeFilter','DocumentFragment','HTMLElement','HTMLInputElement','HTMLSelectElement','Event','MouseEvent','CustomEvent','MutationObserver','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.fetch=()=>{throw new Error('Real network forbidden in voucher UI acceptance')};`,
  );
  const testConfig = join(output, "vitest.config.mjs");
  writeFileSync(
    testConfig,
    `export default {cacheDir:${JSON.stringify(join(output, "vite-cache"))},resolve:{alias:{'@vxture/core-utils/phone':${JSON.stringify(join(root, "packages/core/utils/src/utils/phone.utils.ts"))},'@vxture/core-utils':${JSON.stringify(join(root, "packages/core/utils/src/index.ts"))},'@vxture-platform/shared':${JSON.stringify(join(root, "packages/shared/shared/src/index.ts"))},'@':${JSON.stringify(join(portal, "src"))},react:${JSON.stringify(dirname(portalRequire.resolve("react/package.json")))}},dedupe:['react','react-dom']},esbuild:{jsx:'automatic'},test:{environment:'node',setupFiles:[${JSON.stringify(setup)}],include:['src/**/*.test.ts','src/**/*.test.tsx'],testTimeout:15000}};`,
  );
  const selected = [
    "src/api/voucher-operations.test.ts",
    "src/modules/commerce/voucher-management.ui.test.tsx",
    "src/modules/commerce/subscription-purchase.test.ts",
    "src/modules/commerce/subscription-visibility.test.ts",
  ];

  const resultFile = join(output, "dom-tests.json");
  const code = await run(
    "dom-tests",
    [
      vitest,
      "run",
      ...selected,
      "--config",
      testConfig,
      "--maxWorkers=1",
      "--reporter=default",
      "--reporter=json",
      "--outputFile",
      resultFile,
    ],
    portal,
    { VOUCHER_UI_RENDER_DIR: join(output, "render") },
  );
  const result = existsSync(resultFile)
    ? JSON.parse(readFileSync(resultFile, "utf8"))
    : null;
  const present = selected.every((f) =>
    result?.testResults.some(
      (s) =>
        s.name.replaceAll("\\", "/").endsWith(f) &&
        s.assertionResults.length > 0,
    ),
  );
  report.groups.push({
    name: "api-and-rendered-dom",
    ok:
      code === 0 &&
      result?.success === true &&
      present &&
      result.numPendingTests === 0 &&
      result.testResults.every((s) =>
        s.assertionResults.every((a) => a.status === "passed"),
      ),
    exitCode: code,
    passed: result?.numPassedTests ?? 0,
    failed: result?.numFailedTests ?? null,
    skipped: result?.numPendingTests ?? null,
    selectedFilesPresent: present,
  });
  console.log(JSON.stringify(report.groups.at(-1)));

  const render = join(output, "render/recharge-preview.html");
  check(
    "real-design-system-recharge-render",
    existsSync(render) &&
      readFileSync(render, "utf8").includes("Platform tenant"),
    { artifact: "render/recharge-preview.html" },
  );

  // Resolve the real published design system and every changed UI entry together.
  const entries = [
    "modules/commerce/VouchersPage.tsx",
    "modules/commerce/VoucherClaimDialog.tsx",
    "modules/commerce/SubscriptionRedemptionDialog.tsx",
    "modules/commerce/SubscriptionExtensionDialog.tsx",
    "modules/commerce/RechargeCardDialog.tsx",
    "modules/commerce/SubscribePage.tsx",
    "modules/commerce/components/OrdersSection.tsx",
    "modules/commerce/components/OrderDetailPanel.tsx",
  ];

  const build = await esbuild.build({
    stdin: {
      contents: entries
        .map(
          (p, i) =>
            `export * as entry${i} from ${JSON.stringify(join(portal, "src", p))};`,
        )
        .join("\n"),
      resolveDir: portal,
      sourcefile: "voucher-console-entry.ts",
    },
    plugins: [
      {
        name: "prune-unused-node-crypto",
        setup(build) {
          // The public utils index reexports Node-only helpers; retained crypto usage still fails the external gate below.
          build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
            path: "node:crypto",
            external: true,
            sideEffects: false,
          }));
        },
      },
    ],
    bundle: true,
    write: true,
    outdir: join(output, "browser"),
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    target: "es2023",
    tsconfig: config,
    metafile: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_CONSOLE_BFF_URL": '"https://voucher-ui.invalid"',
      "process.env.NEXT_PUBLIC_API_URL": '""',
    },
    loader: {
      ".woff2": "file",
      ".woff": "file",
      ".ttf": "file",
      ".svg": "file",
    },
    logLevel: "silent",
  });
  writeFileSync(
    join(output, "browser-metafile.json"),
    JSON.stringify(build.metafile, null, 2),
  );
  const realDs = Object.keys(build.metafile.inputs).some(
    (p) => p.includes("@vxture/design-ui/") || p.includes("@vxture+design-ui@"),
  );
  const externals = Object.values(build.metafile.outputs).flatMap((item) =>
    item.imports.filter((i) => i.external),
  );
  check(
    "real-design-system-browser-assembly",
    realDs && externals.length === 0,
    {
      inputs: Object.keys(build.metafile.inputs).length,
      unresolvedExternals: externals.length,
      realDesignSystem: realDs,
    },
  );
  check(
    "sources-unchanged-during-acceptance",
    JSON.stringify(report.sourceBefore) === JSON.stringify(fingerprint()),
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}
report.finishedAt = new Date().toISOString();
report.sourceAfter = fingerprint();
report.ok =
  !failure &&
  report.checks.length >= 5 &&
  report.checks.every((x) => x.ok) &&
  report.groups.length === 1 &&
  report.groups.every((x) => x.ok);
if (failure) report.failure = failure;
writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    ok: report.ok,
    report: join(output, "report.json"),
    ...(failure ? { failure } : {}),
  }),
);
if (!report.ok) process.exitCode = 1;
