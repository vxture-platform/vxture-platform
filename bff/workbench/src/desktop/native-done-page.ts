/**
 * Static, branded browser handoff after native authentication.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category view
 * @author AI-Generated
 * @date 2026-11-23
 */
import { createHash } from "node:crypto";
import { PLATFORM_COPYRIGHT_OWNER } from "@vxture-platform/shared";
import {
  NATIVE_WORDMARK_FONT,
  NATIVE_LABEL_FONT,
  NATIVE_BRAND_MARK,
} from "./native-done-assets";

// ============================================================================
// Fixed layout shared with the approved Workbench design
// ============================================================================
const STYLES = `
@font-face { font-family: "Funnel Display"; font-style: normal; font-weight: 700; font-display: swap; src: url("data:font/woff2;base64,${NATIVE_WORDMARK_FONT}") format("woff2"); }
@font-face { font-family: Inter; font-style: normal; font-weight: 400; font-display: swap; src: url("data:font/woff2;base64,${NATIVE_LABEL_FONT}") format("woff2"); }
:root { font-family: Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
* { box-sizing: border-box; }
body {
  --page: #fff; --ink: #202631; --muted: #687282; --quiet: #6f7784;
  --line: #cbd3df; --line-faint: #e4e9f0; --accent: #0052d9; --brand-ink: oklch(20.5% 0 0); --brand-accent: #1740d4; --brand-primary: #1e51ff;
  --accent-soft: #edf3ff; --accent-line: #a8bfee; --button-text: #fff;
  --legal-ink: #737373; --tag-ink: oklch(55.6% 0 0); --tag-surface: #fff;
  --shell-measure: 96rem; --shell-pad: 32px;
  color-scheme: light; background: var(--page); color: var(--ink);
  display: grid; grid-template-rows: auto 1fr auto;
  margin: 0; min-height: 100svh;
}
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.product-header { min-height: 64px; padding-inline: max(var(--shell-pad), calc((100% - var(--shell-measure)) / 2)); display: flex; align-items: center; }
.brand { display: inline-flex; align-items: center; gap: .5rem; min-height: 32px; color: var(--brand-ink); text-decoration: none; border-radius: 3px; }
.brand img { display: block; flex: none; height: 24px; width: 24px; }
.brand-name { flex: none; font-family: "Funnel Display", Inter, "Noto Sans SC", sans-serif; font-size: 1.5rem; font-weight: 700; letter-spacing: -.025em; line-height: 1; white-space: nowrap; }
.brand-accent { color: var(--brand-accent); }
.desktop-badge { flex: none; margin-inline-start: .5rem; padding: .25rem .625rem; border: 1px solid color-mix(in srgb, var(--brand-primary) 8%, transparent); border-radius: .375rem; color: var(--tag-ink); background: color-mix(in srgb, var(--tag-surface) 32%, transparent); font: 400 .75rem/1 Inter, "Noto Sans SC", sans-serif; letter-spacing: normal; white-space: nowrap; }
.product-main { padding: 32px 24px 88px; display: grid; place-items: center; }
.result { width: min(100%, 420px); text-align: center; }
.status-art { display: block; width: 184px; height: 128px; margin: 0 auto 30px; overflow: visible; }
.art-ink { stroke: var(--line); }
.art-faint { stroke: var(--line-faint); }
.art-accent { stroke: var(--accent); }
.art-soft { fill: var(--accent-soft); }
.art-accent-line { stroke: var(--accent-line); }
.result h1 { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.5; letter-spacing: .025em; text-wrap: balance; }
.result-description { margin: 13px 0 0; color: var(--muted); font-size: 14px; line-height: 1.9; text-wrap: pretty; }
.close-note { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 34px 0 0; color: var(--quiet); font-size: 12px; line-height: 1.7; }
.close-note svg { flex: none; }
.product-footer { color: var(--legal-ink); }
.legal-row { width: 100%; max-width: var(--shell-measure); min-height: 48px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 16px; padding: 8px var(--shell-pad); font-size: 12px; line-height: 1.5; }
.legal-row > span { white-space: nowrap; }
.legal-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px 16px; margin-inline-start: auto; }
.legal-nav a { display: inline-flex; align-items: center; min-height: 32px; border-radius: 3px; color: inherit; text-decoration: none; white-space: nowrap; }
.legal-nav a:hover { color: var(--ink); }
@media (max-width: 1023px) { body { --shell-pad: 24px; } }
@media (max-width: 639px) { body { --shell-pad: 16px; } }
@media (max-width: 560px) {
  .product-main { padding: 24px 24px 66px; }
  .status-art { width: 170px; height: 118px; margin-bottom: 26px; }
  .result h1 { font-size: 24px; }
}
@media (prefers-color-scheme: dark) {
  body {
    --page: #13161c; --ink: #e9edf5; --muted: #a6afbd; --quiet: #8a95a7;
    --line: #465166; --line-faint: #2c3544; --accent: #91b3ff; --brand-ink: oklch(98.5% 0 0); --brand-accent: #5a72ff;
    --accent-soft: #1c2a43; --accent-line: #436397; --button-text: #14223d;
    --legal-ink: #a1a1a1; --tag-ink: oklch(87% 0 0); --tag-surface: oklch(26.9% 0 0);
    color-scheme: dark;
  }
}
`;

// ============================================================================
// Constant response and exact stylesheet policy
// ============================================================================
/** Browser-only handoff view; no identity, approval handle or session is rendered. */
export const NATIVE_DONE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>验证完成 · Ruyin Work</title>
<style>${STYLES}</style>
</head>
<body>
  <header class="product-header">
    <a class="brand" href="https://ruyin.work/" target="_blank" rel="noopener noreferrer">
      <img src="data:image/png;base64,${NATIVE_BRAND_MARK}" alt="" width="24" height="24" draggable="false">
      <span class="brand-name"><span class="brand-accent">Ruyin</span> Work</span>
      <span id="desktop-badge" class="desktop-badge">DESKTOP</span>
    </a>
  </header>
  <main class="product-main">
    <section class="result" aria-labelledby="completion-title" aria-describedby="result-description">
      <svg id="status-art" class="status-art" viewBox="0 0 184 128" fill="none" aria-hidden="true">
        <path class="art-faint" d="M22 109.5h140" stroke-width="1.2" stroke-linecap="round"/>
        <rect class="art-soft" x="49" y="23" width="99" height="64" rx="6"/>
        <rect class="art-ink" x="44" y="18" width="99" height="64" rx="6" stroke-width="1.5"/>
        <path class="art-faint" d="M44 34h99M84 83v13m19-13v13M75 97h37" stroke-width="1.5" stroke-linecap="round"/>
        <circle class="art-ink" cx="53" cy="26" r="1.1" stroke-width="1.1"/>
        <circle class="art-ink" cx="59" cy="26" r="1.1" stroke-width="1.1"/>
        <path class="art-accent-line" d="M58 46h24m-24 8h44m-44 8h18" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="139" cy="80" r="20" fill="var(--page)"/>
        <circle class="art-soft art-accent-line" cx="139" cy="80" r="16" stroke-width="1.2"/>
        <g id="status-symbol" class="art-accent" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m131.5 80 5 5 10-10"/></g>
        <path class="art-faint" d="M29 63h-6m3-3v6m131-25h6m-3-3v6" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <h1 id="completion-title">验证完成</h1>
      <p id="result-description" class="result-description">请返回 RUYIN 桌面应用继续使用。</p>
      <p class="close-note"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.15"/><path d="m6 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>现在可以关闭此页面</p>
    </section>
  </main>
  <footer class="product-footer">
    <div class="legal-row">
      <span>© ${new Date().getFullYear()} ${PLATFORM_COPYRIGHT_OWNER}</span>
      <nav class="legal-nav" aria-label="法律信息">
        <a href="https://vxture.com/zh-CN/legal/terms" target="_blank" rel="noopener noreferrer">服务条款</a>
        <a href="https://vxture.com/zh-CN/legal/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>
        <a href="https://vxture.com/zh-CN/legal/copyright" target="_blank" rel="noopener noreferrer">版权声明</a>
      </nav>
    </div>
  </footer>
</body>
</html>`;

/** Permit the hashed style and embedded assets; deny scripts, remote resources and framing. */
export const NATIVE_DONE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(STYLES).digest("base64")}'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
