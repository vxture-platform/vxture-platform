/**
 * Validated, bounded customer portal presentation configuration.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category validation
 * @author AI-Generated
 * @date 2026-11-15
 */
import { BadRequestException } from "@nestjs/common";

export interface PortalConfiguration {
  name: string;
  title: string;
  subtitle: string;
  brandColor: string;
  appearance: "light" | "dark";
  density: "comfortable" | "compact";
  logo: string | null;
  favicon: string | null;
  background: string | null;
  applications: { code: string; group: string; hidden: boolean }[];
}

export const DEFAULT_CONFIGURATION: PortalConfiguration = {
  name: "企业智能门户",
  title: "连接智能，开启所能",
  subtitle: "统一入口，连接专业应用与团队工作",
  brandColor: "#3154D9",
  appearance: "light",
  density: "comfortable",
  logo: null,
  favicon: null,
  background: null,
  applications: [],
};

// ============================================================================
// Fixed platform namespace; custom hostnames are deliberately not accepted yet.
// ============================================================================
const RESERVED = new Set([
  // Platform identity, authentication and management surfaces.
  "www",
  "ruyin",
  "vxture",
  "official",
  "platform",
  "system",
  "root",
  "admin",
  "admins",
  "console",
  "opera",
  "arche",
  "portal",
  "workbench",
  "account",
  "accounts",
  "auth",
  "oauth",
  "oidc",
  "sso",
  "saml",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "password",
  "passwd",
  "reset",
  "verify",
  "identity",
  "session",
  "token",
  "tokens",
  "callback",
  "consent",
  // Infrastructure, delivery, storage and internal environments.
  "api",
  "apis",
  "gateway",
  "backend",
  "frontend",
  "internal",
  "private",
  "public",
  "service",
  "services",
  "server",
  "servers",
  "proxy",
  "edge",
  "origin",
  "cdn",
  "static",
  "assets",
  "images",
  "img",
  "files",
  "upload",
  "uploads",
  "download",
  "storage",
  "media",
  "content",
  "data",
  "database",
  "postgres",
  "mysql",
  "redis",
  "cache",
  "backup",
  "backups",
  "logs",
  "audit",
  "metrics",
  "monitor",
  "health",
  "healthz",
  "status",
  "trace",
  "tracing",
  "dev",
  "develop",
  "test",
  "testing",
  "qa",
  "uat",
  "stage",
  "staging",
  "beta",
  "alpha",
  "canary",
  "preview",
  "prod",
  "live",
  "demo",
  "sandbox",
  "debug",
  "local",
  "intranet",
  "docker",
  "registry",
  "git",
  "gitlab",
  "ci",
  "cd",
  // Messaging, security, support and commercial trust names.
  "mail",
  "email",
  "webmail",
  "smtp",
  "imap",
  "pop",
  "pop3",
  "mx",
  "dns",
  "ns",
  "ns1",
  "ns2",
  "ftp",
  "sftp",
  "ssh",
  "vpn",
  "wpad",
  "autoconf",
  "autodiscover",
  "support",
  "help",
  "helpdesk",
  "contact",
  "abuse",
  "noc",
  "security",
  "trust",
  "privacy",
  "legal",
  "terms",
  "policy",
  "policies",
  "cert",
  "acme",
  "ssl",
  "tls",
  "billing",
  "payment",
  "payments",
  "pay",
  "invoice",
  "invoices",
  "order",
  "orders",
  "checkout",
  "wallet",
  "finance",
  "license",
  "pricing",
  "sales",
  "partner",
  "partners",
  "customer",
  "tenant",
  "tenants",
  "user",
  "users",
  "member",
  "members",
  "staff",
  "employee",
  "operator",
  "owner",
  "manager",
  "super",
  "adminapi",
  "sysadmin",
  // Existing product brands and official information surfaces.
  "atlas",
  "runos",
  "arda",
  "karda",
  "umbra",
  "vxtpl",
  "varda",
  "ontos",
  "terra",
  "raven",
  "anlan",
  "forge",
  "xuanzhen",
  "nocus",
  "runa",
  "app",
  "apps",
  "web",
  "www1",
  "www2",
  "mobile",
  "desktop",
  "client",
  "docs",
  "doc",
  "wiki",
  "blog",
  "news",
  "about",
  "home",
  "index",
  "search",
]);
const RESERVED_FAMILY =
  /^(?:www|api|admin|auth|login|sso|oidc|oauth|mail|smtp|imap|pop|ns|dns|cdn|static|status|dev|test|stage|staging|prod|beta|canary|system|ruyin|vxture)[0-9]*$/;

export function portalHostname(
  prefix: unknown,
  platformReserved = false,
): string {
  // Only an organization-verified platform caller may use the initial reserved host.
  if (platformReserved && prefix === "a") return "a.ruyin.work";
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9]{2,7}$/.test(prefix))
    throw new BadRequestException(
      "域名前缀须为 3–8 位小写字母或数字，且以字母开头",
    );
  if (RESERVED.has(prefix) || RESERVED_FAMILY.test(prefix))
    throw new BadRequestException("该域名前缀为平台保留名称，请更换");
  return `${prefix}.ruyin.work`;
}

function text(value: unknown, limit: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
    (required && !value.trim())
  )
    throw new BadRequestException("门户文本格式或长度不正确");
  return value.trim();
}

function asset(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new BadRequestException("素材必须使用已上传的固定内容引用");
  return value;
}

// ============================================================================
// Only structured presentation fields enter snapshots; no executable markup.
// ============================================================================
export function parseConfiguration(input: unknown): PortalConfiguration {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new BadRequestException("门户配置无效");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((key) => !(key in DEFAULT_CONFIGURATION)))
    throw new BadRequestException("门户配置包含不支持的字段");
  if (
    typeof v.brandColor !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(v.brandColor) ||
    !["light", "dark"].includes(String(v.appearance)) ||
    !["comfortable", "compact"].includes(String(v.density)) ||
    !Array.isArray(v.applications) ||
    v.applications.length > 100
  )
    throw new BadRequestException("门户样式或应用配置无效");
  const seen = new Set<string>();
  const applications = v.applications.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new BadRequestException("应用配置无效");
    const a = item as Record<string, unknown>;
    const code = text(a.code, 64, true);
    if (
      !/^[a-z][a-z0-9-]*$/.test(code) ||
      seen.has(code) ||
      typeof a.hidden !== "boolean" ||
      Object.keys(a).some((key) => !["code", "group", "hidden"].includes(key))
    )
      throw new BadRequestException("应用代码重复或格式不正确");
    seen.add(code);
    return { code, group: text(a.group, 40), hidden: a.hidden };
  });
  return {
    name: text(v.name, 96, true),
    title: text(v.title, 100, true),
    subtitle: text(v.subtitle, 240),
    brandColor: v.brandColor,
    appearance: v.appearance as PortalConfiguration["appearance"],
    density: v.density as PortalConfiguration["density"],
    logo: asset(v.logo),
    favicon: asset(v.favicon),
    background: asset(v.background),
    applications,
  };
}
