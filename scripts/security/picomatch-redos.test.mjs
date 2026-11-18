/**
 * Regression coverage for the local repeated-extglob mitigation.
 * @package vxture
 * @layer Infrastructure
 * @category security-test
 * @author AI-Generated
 * @date 2026-11-18
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Run matching in a separate process so a regression cannot hang the test runner.
const root = fileURLToPath(new URL("../../", import.meta.url));
const store = resolve(root, "node_modules/.pnpm");
const versions = ["2.3.2", "4.0.5", "4.0.7"];
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const lockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
const worker = `
  const pm = require(process.argv[1]);
  const [pattern, input, options] = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(pm.isMatch(input, pattern, options)));
`;

function matches(packagePath, pattern, input, options = {}) {
  const result = spawnSync(
    process.execPath,
    ["-e", worker, packagePath, JSON.stringify([pattern, input, options])],
    { timeout: 2000, encoding: "utf8", windowsHide: true },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Exercise the hash-addressed resolutions installed from the patched lockfile.
for (const version of versions) {
  test(`picomatch ${version}: installed patch carries the mitigation`, () => {
    assert.equal(
      manifest.pnpm.patchedDependencies[`picomatch@${version}`],
      `patches/picomatch@${version}.patch`,
    );
    assert.ok(lockfile.includes(`path: patches/picomatch@${version}.patch`));
    assert.ok(
      !lockfile.includes(`picomatch: ${version}\n`),
      "Unpatched dependency edge",
    );
    assert.ok(
      !lockfile.includes(`picomatch@${version}: {}`),
      "Unpatched snapshot",
    );
    const entries = readdirSync(store).filter(
      (name) =>
        name === `picomatch@${version}` ||
        name.startsWith(`picomatch@${version}_patch_hash=`),
    );
    assert.ok(entries.length > 0, `Missing installed picomatch ${version}`);
    for (const entry of entries) {
      const packagePath = resolve(store, entry, "node_modules/picomatch");
      const source = readFileSync(resolve(packagePath, "lib/parse.js"), "utf8");
      // Unused unpatched store entries may remain after pnpm applies a patch.
      // Exercise the hash-addressed resolution selected by the current lockfile.
      if (!entry.includes("patch_hash=")) continue;
      assert.match(source, /if \(hasRepeatedGlobStar\(body\)\)/);
    }
    assert.ok(
      entries.some((entry) => entry.includes("patch_hash=")),
      "Patch was not installed",
    );
  });

  const entry = readdirSync(store).find((name) =>
    name.startsWith(`picomatch@${version}_patch_hash=`),
  );
  const packagePath = entry
    ? resolve(store, entry, "node_modules/picomatch")
    : "";

  // Cover both outer quantifiers, nested bodies, prefixes, and the recursion opt-out.
  for (const pattern of [
    "+(*)",
    "*(*)",
    "+(*a)",
    "*(*a)",
    "+(@(*a))",
    "prefix+(*a)",
  ]) {
    for (const options of [{}, { maxExtglobRecursion: false }]) {
      test(`${version}: rejects risky ${pattern} (${JSON.stringify(options)})`, () => {
        assert.ok(packagePath, "Patch was not installed");
        const prefix = pattern.startsWith("prefix") ? "prefix" : "";
        assert.equal(
          matches(packagePath, pattern, `${prefix}${"a".repeat(64)}!`, options),
          false,
        );
        assert.equal(matches(packagePath, pattern, pattern, options), true);
      });
    }
  }

  // Preserve ordinary routing/build globs and finite repeated character patterns.
  for (const [pattern, input, expected] of [
    ["**/*.tsx", "src/pages/index.tsx", true],
    ["**/*.tsx", "src/pages/index.js", false],
    ["src/*.{ts,tsx}", "src/index.ts", true],
    ["**/node_modules/**", "src/node_modules/pkg/index.js", true],
    ["+(ab)", "abab", true],
    ["*(a)", "aaa", true],
    ["+(a|b)", "abba", true],
    ["+([*])", "***", true],
    ['+("*")', "***", true],
    ["+(\\*)", "***", true],
    // Preserve the pre-existing difference between the legacy and modern parsers.
    ["+(*(a)|*(b))", "abba", version !== "2.3.2"],
  ]) {
    test(`${version}: preserves ${pattern} against ${input}`, () => {
      assert.ok(packagePath, "Patch was not installed");
      assert.equal(matches(packagePath, pattern, input), expected);
    });
  }
}
