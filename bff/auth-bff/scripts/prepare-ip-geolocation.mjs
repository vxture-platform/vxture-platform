/**
 * Prepare pinned, integrity-checked offline IP databases for the auth image.
 * @package @vxture/bff-auth
 * @layer Application
 * @category build
 * @author AI-Generated
 * @date 2026-11-09
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// ============================================================================
// Immutable upstream revision and independently checked file digests
// ============================================================================

const REVISION = "f8410adb250b075c20f4c6f463c4b52b821a7970";
const FILES = [
  {
    name: "ip2region_v4.xdb",
    source: "data/ip2region_v4.xdb",
    size: 11122742,
    sha256: "a12ad5aca1277d67e525efcda531a20cc0d654ff4f087150d45bc17fca4bc260",
  },
  {
    name: "ip2region_v6.xdb",
    source: "data/ip2region_v6.xdb",
    size: 37277813,
    sha256: "939f6b46bd2b8bec3cf7c5ceb8ba782266ae9b1f35b5ba7916700dec0b7506ed",
  },
  {
    name: "LICENSE",
    source: "LICENSE.md",
    size: 12976,
    sha256: "fe01f2f8fcaafac539154e6aa80b0b7f8af54e01dc4d52322f72971991c6280e",
  },
];
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/assets/ip-geolocation",
);

// ============================================================================
// Streaming verification and bounded downloads
// ============================================================================

async function verified(path, file) {
  try {
    if ((await stat(path)).size !== file.size) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === file.sha256;
  } catch {
    return false;
  }
}

async function download(file, path, attempt) {
  const source =
    attempt % 2 === 0
      ? `https://raw.githubusercontent.com/lionsoul2014/ip2region/${REVISION}/${file.source}`
      : `https://api.github.com/repos/lionsoul2014/ip2region/contents/${file.source}?ref=${REVISION}`;
  const response = await fetch(source, {
    signal: AbortSignal.timeout(120000),
    headers: { Accept: "application/vnd.github.raw+json" },
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error(`IP database download failed: HTTP ${response.status}`);
  let received = 0;
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      callback(
        received > file.size
          ? new Error("IP database exceeds pinned size")
          : null,
        chunk,
      );
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    createWriteStream(path, { flags: "w" }),
  );
  if (!(await verified(path, file)))
    throw new Error(`IP database integrity mismatch: ${file.name}`);
}

await mkdir(output, { recursive: true });
for (const file of FILES) {
  const target = join(output, file.name);
  if (await verified(target, file)) {
    console.info(`Verified cached IP asset: ${file.name}`);
    continue;
  }
  const temporary = `${target}.download`;
  for (let attempt = 0; ; attempt++) {
    try {
      await download(file, temporary, attempt);
      await rename(temporary, target);
      console.info(`Prepared pinned IP asset: ${file.name}`);
      break;
    } catch (error) {
      await rm(temporary, { force: true });
      if (attempt >= 2) throw error;
      console.warn(`Retrying pinned IP asset: ${file.name}`);
    }
  }
}
