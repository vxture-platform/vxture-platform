/**
 * Localized API errors outside React render and hook contexts.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-08
 */
import zh from "../../messages/zh-CN.json";
import en from "../../messages/en-US.json";

/** Use the rendered document locale for asynchronous browser error messages. */
export function apiMessage(key: keyof typeof zh.accountsApi): string {
  const english =
    typeof document !== "undefined" &&
    document.documentElement.lang === "en-US";
  return (english ? en : zh).accountsApi[key];
}
