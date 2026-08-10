#!/usr/bin/env node
/**
 * hash-sample-password.mjs — Argon2id PHC hash for the LOCAL sample user.
 *
 * Runs inside the throwaway node container (see db-local.mjs `sample-user`), so
 * the host needs no crypto dependency. Parameters match what the seed documents
 * and what the platform hasher uses: m=65536, t=3, p=1, 32-byte output.
 *
 * Local only. The production path takes its hash from a runtime secret and the
 * seed refuses the default-password route when NODE_ENV=production.
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { argon2id } = require("hash-wasm");

const password = process.env["SAMPLE_PW"] ?? "Dev@2026";

const hash = await argon2id({
  password,
  salt: randomBytes(16),
  parallelism: 1,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
  outputType: "encoded",
});

process.stdout.write(hash + "\n");
