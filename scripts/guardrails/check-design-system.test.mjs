/**
 * check-design-system.test.mjs - Exercise real design guard boundaries with isolated fixtures.
 * @package vxture-platform
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

// ============================================================================
// Fixtures never modify the checkout or its dependencies and contain no env files.
// ============================================================================
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const guard = join(root, "scripts/guardrails/check-design-system.mjs");
const baseline = join(root, "scripts/guardrails/design-system-baseline.json");
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const baselineBefore = hash(baseline);
const parent = join(root, "output/design-guard-regression");
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, "run-"));
const require = createRequire(join(root, "portals/admin/package.json"));
let designRoot = dirname(require.resolve("@vxture/design-system"));
while (!existsSync(join(designRoot, "package.json"))) {
  const next = dirname(designRoot);
  assert.notEqual(
    next,
    designRoot,
    "Installed design-system manifest must exist",
  );
  designRoot = next;
}
assert.equal(
  JSON.parse(readFileSync(join(designRoot, "package.json"), "utf8")).name,
  "@vxture/design-system",
);
const env = { CI: "1", NO_COLOR: "1", NEXT_TELEMETRY_DISABLED: "1" };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|NODE_OPTIONS)$/i.test(
      key,
    )
  )
    env[key] = value;
const results = [];

/** Run the actual CLI against a miniature workspace. @param name - Fixture name. @param filename - Scanned module name. @param content - Source under test. @returns CLI status and complete diagnostic text. */
function inspect(name, filename, content) {
  const directory = join(output, name);
  const write = (file, value) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), value);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "design-guard-regression",
      private: true,
      type: "module",
    }),
  );
  write(
    "scripts/guardrails/design-system-baseline.json",
    JSON.stringify({ version: 1, allowed: [] }),
  );
  for (const file of [
    "portals/admin/src/app/globals.css",
    "portals/console/src/app/globals.css",
    "portals/console/src/styles/console-template.css",
    "portals/website/src/app/globals.css",
    "portals/website/src/styles/website-legal.css",
    "portals/website/src/styles/website-marketing.css",
  ])
    write(file, "");
  write(
    "portals/console/src/app/globals.css",
    '@import "../styles/console-template.css";',
  );
  write(
    "portals/website/src/app/globals.css",
    '@import "../styles/website-legal.css";\n@import "../styles/website-marketing.css";',
  );
  write("portals/admin/src/" + filename, content);
  mkdirSync(join(directory, "node_modules/@vxture"), { recursive: true });
  symlinkSync(
    designRoot,
    join(directory, "node_modules/@vxture/design-system"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = spawnSync(process.execPath, [guard], {
    cwd: directory,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.ifError(result.error);
  const text = result.stdout + result.stderr;
  write("guard.log", text);
  results.push({ name, filename, code: result.status });
  return { code: result.status, text };
}

// ============================================================================
// A mock exemption is bounded by module kind, imported identity and factory body.
// ============================================================================
test("real primitives in business modules remain rejected", () => {
  const result = inspect(
    "business",
    "View.tsx",
    "export const View = () => <button>save</button>;",
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("inline imported Vitest mock factories may substitute primitives", () => {
  const result = inspect(
    "mock",
    "View.test.tsx",
    'import { vi } from "vitest";\nvi.mock("@vxture/design-system", () => ({ Button: () => <button>save</button>, Input: () => <input />, Select: () => <select />, Textarea: () => <textarea /> }));',
  );
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /guardrails passed/);
});

test("aliased import and function factories are recognized in spec files", () => {
  const result = inspect(
    "alias",
    "View.spec.tsx",
    'import { vi as mockApi } from "vitest";\nmockApi.mock("visual-component", function () { return { Button: () => <button /> }; });',
  );
  assert.equal(result.code, 0, result.text);
});

test("native test JSX outside factories is still rejected at its original line", () => {
  const result = inspect(
    "outside",
    "View.test.tsx",
    'import { vi } from "vitest";\nvi.mock("visual", () => ({ Button: () => <button /> }));\nexport const Outside = () => <input />;',
  );
  assert.equal(result.code, 1);
  assert.match(
    result.text,
    /ds\/no-native-primitive: portals\/admin\/src\/View\.test\.tsx:3/,
  );
  assert.doesNotMatch(result.text, /View\.test\.tsx:2/);
});

test("business files cannot claim a test mock exemption", () => {
  const result = inspect(
    "business-mock",
    "View.tsx",
    'import { vi } from "vitest";\nvi.mock("visual", () => ({ Button: () => <button /> }));',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("a similarly named mock object is not a Vitest import", () => {
  const result = inspect(
    "fake-binding",
    "View.test.tsx",
    'const vi = { mock() {} };\nvi.mock("visual", () => ({ Button: () => <button /> }));',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("a binding imported from another module receives no exemption", () => {
  const result = inspect(
    "wrong-import",
    "View.test.tsx",
    'import { vi } from "other-runner";\nvi.mock("visual", () => ({ Button: () => <button /> }));',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("shadowed Vitest bindings receive no exemption", () => {
  const result = inspect(
    "shadow",
    "View.test.tsx",
    'import { vi } from "vitest";\nfunction example(vi) { vi.mock("visual", () => ({ Button: () => <button /> })); }',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("separately declared factory helpers remain checked", () => {
  const result = inspect(
    "helper",
    "View.test.tsx",
    'import { vi } from "vitest";\nconst factory = () => ({ Button: () => <button /> });\nvi.mock("visual", factory);',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("malformed test modules fail closed", () => {
  const result = inspect(
    "malformed",
    "View.test.tsx",
    'import { vi } from "vitest";\nvi.mock("visual", () => ({ Button: () => <button /> }));\nconst broken = (',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/no-native-primitive/);
});

test("mock factories remain subject to the other design rules", () => {
  const result = inspect(
    "overlay",
    "View.test.tsx",
    'import { vi } from "vitest";\nvi.mock("visual", () => ({ Panel: () => <DialogForm size="md" /> }));',
  );
  assert.equal(result.code, 1);
  assert.match(result.text, /ds\/overlay-panel-preset/);
});

test("all existing supported dialog sizes remain accepted", () => {
  const result = inspect(
    "presets",
    "View.tsx",
    'export const View = () => <><DialogForm size="sm" /><DialogForm size="lg" /><DialogForm size="xl" /></>;',
  );
  assert.equal(result.code, 0, result.text);
});

after(() => {
  assert.equal(
    hash(baseline),
    baselineBefore,
    "The repository baseline must remain unchanged",
  );
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify({ cases: results, baselineUnchanged: true }, null, 2),
  );
  console.log("Design guard regression artifacts: " + output);
});
