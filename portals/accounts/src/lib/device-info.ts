/**
 * Derive display-only client information from a recorded user agent.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-07
 */

/** Parse common browser and OS signatures without treating them as identity evidence. */
export function deviceInfo(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  const ua = userAgent ?? "";
  const browsers: [RegExp, string][] = [
    [/Edg(?:A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/MicroMessenger\/([\d.]+)/, "WeChat"],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari\//, "Safari"],
  ];
  let browser: string | null = null;
  for (const [pattern, name] of browsers) {
    const match = ua.match(pattern);
    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }
  let os: string | null = null;
  const ios = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/);
  const android = ua.match(/Android ([\d.]+)/);
  const mac = ua.match(/Mac OS X ([\d_]+)/);
  if (ios)
    os = `${/iPad/.test(ua) ? "iPadOS" : "iOS"} ${ios[1]?.replaceAll("_", ".")}`;
  else if (android) os = `Android ${android[1]}`;
  // Modern user agents cannot reliably distinguish Windows 10 from Windows 11.
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (mac) os = `macOS ${mac[1]?.replaceAll("_", ".")}`;
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}
