/**
 * Server-only runtime and editable copy loading, without leaking upstream URLs.
 * @package @vxture/workbench
 * @layer Presentation
 * @category config
 * @author AI-Generated
 * @date 2026-11-05
 */
import { readFile } from "node:fs/promises";
import copy from "../../config/home-copy.json";
import { parseHomeCopy } from "./presentation";
import { safeHttpUrl } from "./api";

/**
 * Read public portal configuration on each document request.
 * @returns Validated copy and explicit backend readiness flags.
 */
export async function loadRuntime() {
  let configuredCopy: unknown = copy;
  if (process.env.WORKBENCH_HOME_COPY_FILE) {
    try {
      configuredCopy = JSON.parse(
        await readFile(process.env.WORKBENCH_HOME_COPY_FILE, "utf8"),
      ) as unknown;
    } catch {
      console.error(
        "[workbench] Home copy configuration could not be read; using bundled copy.",
      );
    }
  }
  return {
    initialTime: new Date().toISOString(),
    copy: parseHomeCopy(configuredCopy),
    runtime: {
      authConfigured:
        Boolean(process.env.WORKBENCH_BFF_PROXY_URL) ||
        process.env.WORKBENCH_SAME_ORIGIN_BFF === "1",
      catalogConfigured:
        Boolean(process.env.WORKBENCH_CATALOG_PROXY_URL) ||
        process.env.WORKBENCH_SAME_ORIGIN_CATALOG === "1",
      websiteUrl:
        safeHttpUrl(process.env.WORKBENCH_WEBSITE_URL) ?? "https://vxture.com",
      consoleUrl:
        safeHttpUrl(process.env.WORKBENCH_CONSOLE_URL) ??
        "https://console.vxture.com",
    },
  };
}
