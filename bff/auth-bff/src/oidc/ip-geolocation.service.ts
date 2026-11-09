/**
 * Offline location enrichment for authenticated account activity.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-09
 */
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { existsSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import {
  IPv4,
  IPv6,
  newWithFileOnly,
  parseIP,
  ipToString,
  type Searcher,
} from "ip2region.js";

// ============================================================================
// Address classification and projection
// ============================================================================

export interface LoginLocation {
  kind: "public" | "private" | "unknown";
  country: string | null;
  region: string | null;
  city: string | null;
  countryCode: string | null;
}

const PRIVATE = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE.addSubnet(address, prefix, "ipv4");
}
// Keep the published RFC 6598 allocation as CIDR, rather than a host identifier.
const [sharedAddress, sharedPrefix] = "100.64.0.0/10".split("/");
PRIVATE.addSubnet(sharedAddress!, Number(sharedPrefix), "ipv4");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
const RESERVED = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  RESERVED.addSubnet(address, prefix, "ipv4");
}
RESERVED.addSubnet("2001:db8::", 32, "ipv6");
RESERVED.addSubnet("2001:2::", 48, "ipv6");
const UNKNOWN: LoginLocation = Object.freeze({
  kind: "unknown",
  country: null,
  region: null,
  city: null,
  countryCode: null,
});
const PRIVATE_LOCATION: LoginLocation = Object.freeze({
  ...UNKNOWN,
  kind: "private",
});
const CACHE_LIMIT = 512;

function text(value: string | undefined): string | null {
  const clean = value?.trim();
  return clean && clean !== "0" && clean !== "-" ? clean : null;
}

// ============================================================================
// File-backed lookup with bounded process resources
// ============================================================================

@Injectable()
export class IpGeolocationService implements OnModuleDestroy {
  private readonly logger = new Logger(IpGeolocationService.name);
  private readonly readers = new Map<4 | 6, Searcher | null>();
  private readonly cache = new Map<string, LoginLocation>();

  /**
   * Resolve only an IP from a stored, authenticated activity projection.
   * @param address - Stored client address, never a URL or filesystem path.
   * @returns Approximate country, region and city, or an explicit fallback.
   */
  async locate(address: string | null): Promise<LoginLocation> {
    if (!address || address.length > 64 || !isIP(address)) return UNKNOWN;
    // The upstream parser expects hexadecimal IPv6 tails, not embedded dotted IPv4.
    let canonicalInput = address;
    if (address.includes(":") && address.includes(".")) {
      const separator = address.lastIndexOf(":");
      const octets = address
        .slice(separator + 1)
        .split(".")
        .map(Number);
      canonicalInput = `${address.slice(0, separator + 1)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
    }
    let bytes = parseIP(canonicalInput);
    if (
      bytes.length === 16 &&
      bytes.subarray(0, 10).every((byte) => byte === 0) &&
      bytes[10] === 255 &&
      bytes[11] === 255
    )
      bytes = bytes.subarray(12);
    const ip = ipToString(bytes);
    const version = bytes.length === 4 ? 4 : 6;
    const family = version === 4 ? "ipv4" : "ipv6";
    if (PRIVATE.check(ip, family)) return PRIVATE_LOCATION;
    if (
      RESERVED.check(ip, family) ||
      (version === 6 && (bytes[0]! & 0xe0) !== 0x20)
    )
      return UNKNOWN;
    const cached = this.cache.get(ip);
    if (cached) {
      this.cache.delete(ip);
      this.cache.set(ip, cached);
      return cached;
    }
    let location = UNKNOWN;
    try {
      const reader = this.reader(version);
      const result = await reader?.search(ip);
      if (result) {
        const [country, region, city, , code] = result.split("|");
        const countryCode = text(code);
        location = Object.freeze({
          kind: "public",
          country: text(country),
          region: text(region),
          city: text(city),
          countryCode:
            countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
        });
        if (!location.country && !location.region && !location.city)
          location = UNKNOWN;
      }
    } catch {
      // Location availability must never prevent the account activity from loading.
      this.logger.warn("Offline IP location query failed");
    }
    if (this.cache.size >= CACHE_LIMIT)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(ip, location);
    return location;
  }

  private reader(version: 4 | 6): Searcher | null {
    if (this.readers.has(version)) return this.readers.get(version) ?? null;
    const directories = [
      join(process.cwd(), "assets", "ip-geolocation"),
      join(process.cwd(), "dist", "assets", "ip-geolocation"),
      join(
        process.cwd(),
        "bff",
        "auth-bff",
        "dist",
        "assets",
        "ip-geolocation",
      ),
    ];
    const path = directories
      .map((directory) => join(directory, `ip2region_v${version}.xdb`))
      .find(existsSync);
    let reader: Searcher | null = null;
    try {
      if (path) reader = newWithFileOnly(version === 4 ? IPv4 : IPv6, path);
      else
        this.logger.warn(`Offline IPv${version} location database unavailable`);
    } catch {
      this.logger.warn(
        `Offline IPv${version} location database could not be opened`,
      );
    }
    this.readers.set(version, reader);
    return reader;
  }

  /** Close the at-most-two database handles when the application stops. */
  onModuleDestroy(): void {
    for (const reader of this.readers.values()) reader?.close();
    this.readers.clear();
    this.cache.clear();
  }
}
