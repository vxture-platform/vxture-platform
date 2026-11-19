/**
 * Public organization image contracts over real HTTP.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  OrganizationService,
  type OrgLogoRecord,
} from "@vxture/service-organization";
import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OrganizationLogoController } from "./organization-logo.controller";

const orgId = "00000000-0000-4000-8000-000000000638";
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const hash = createHash("sha256").update(png).digest("hex");
let logo: OrgLogoRecord | null;
const read = vi.fn(async (_orgId: string, version: string) =>
  logo?.hash === version ? logo : null,
);

@Module({
  controllers: [OrganizationLogoController],
  providers: [
    { provide: OrganizationService, useValue: { getPublicOrgLogo: read } },
  ],
})
class HttpModule {}

// ============================================================================
// Public image responses and cache semantics
// ============================================================================
describe("organization logo HTTP", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create(HttpModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/avatar/organization`;
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    read.mockClear();
    logo = { data: png, hash, contentType: "text/html" };
  });

  it("serves exact image bytes without credentials and derives the MIME from bytes", async () => {
    const response = await fetch(`${base}/${orgId}/${hash}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe(`"${hash}"`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(read).toHaveBeenCalledWith(orgId, hash);
  });

  it("revalidates a live version, then refuses it after removal", async () => {
    const headers = { "If-None-Match": `"other", W/"${hash}"` };
    const cached = await fetch(`${base}/${orgId}/${hash}`, { headers });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    logo = null;
    const removed = await fetch(`${base}/${orgId}/${hash}`, { headers });
    expect(removed.status).toBe(404);
    expect(removed.headers.get("cache-control")).toBe("no-store");
  });

  it("never returns a replacement image at the old version URL", async () => {
    const response = await fetch(`${base}/${orgId}/${"f".repeat(64)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  // ========================================================================
  // Input and stored-content rejection
  // ========================================================================
  it.each([
    ["invalid", hash],
    [orgId, "invalid"],
    [orgId, "A".repeat(64)],
  ])(
    "rejects malformed paths before repository access (%s)",
    async (id, version) => {
      expect((await fetch(`${base}/${id}/${version}`)).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([Buffer.from("<svg onload='alert(1)'></svg>"), Buffer.alloc(0)])(
    "rejects unsafe stored bytes",
    async (data) => {
      const version = createHash("sha256").update(data).digest("hex");
      logo = { data, hash: version, contentType: "image/png" };
      const response = await fetch(`${base}/${orgId}/${version}`);
      expect(response.status).toBe(404);
      expect(response.headers.get("etag")).toBeNull();
    },
  );

  it("rejects a stored hash that does not match its bytes", async () => {
    logo = {
      data: Buffer.concat([png, Buffer.from("changed")]),
      hash,
      contentType: "image/png",
    };
    expect((await fetch(`${base}/${orgId}/${hash}`)).status).toBe(404);
  });
});
