/**
 * Static, branded browser handoff after native authentication.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category view
 * @author AI-Generated
 * @date 2026-11-23
 */
import { createHash } from "node:crypto";

// ============================================================================
// Fixed presentation only; no request data, remote assets or executable content
// ============================================================================
const STYLES = `
:root {
  color-scheme: light dark;
  --page: #f7f8fa;
  --surface: #fff;
  --ink: #172033;
  --muted: #667085;
  --line: #e8ebf0;
  --accent: #0052d9;
  --tint: #edf3ff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100svh;
  background: var(--page);
  color: var(--ink);
  font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.shell {
  width: min(100% - 48px, 960px);
  margin: auto;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}
header {
  height: 100px;
  display: flex;
  align-items: center;
  gap: 11px;
  flex-shrink: 0;
}
.wordmark { font-size: 18px; font-weight: 650; letter-spacing: .1em; }
.product {
  border-left: 1px solid var(--line);
  padding-left: 13px;
  margin-left: 3px;
  font-size: 12px;
  line-height: 20px;
  color: var(--muted);
}
main {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 12px 0 110px;
}
.completion {
  width: 100%;
  max-width: 408px;
  padding: 40px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 12px 36px -24px #17203326;
}
.status {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--tint);
  color: var(--accent);
  margin-bottom: 26px;
}
h1 {
  font-size: 25px;
  line-height: 1.4;
  letter-spacing: -.025em;
  font-weight: 600;
  margin: 0 0 12px;
}
.message { font-size: 14px; line-height: 1.8; color: var(--muted); margin: 0; }
.note {
  border-top: 1px solid var(--line);
  padding-top: 22px;
  margin: 30px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 20px;
}
@media (max-width: 480px) {
  .shell { width: calc(100% - 40px); }
  header { height: 84px; }
  main { padding-bottom: 96px; }
  .completion { padding: 32px 28px; border-radius: 16px; }
  .product { font-size: 11px; }
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #12151b;
    --surface: #1a1f28;
    --ink: #edf1f7;
    --muted: #a5afbd;
    --line: #2b3340;
    --accent: #87aaff;
    --tint: #202f4a;
  }
  .completion { box-shadow: none; }
}
`;

// Existing RUYIN desktop mark, embedded to keep the completion route self-contained.
const BRAND_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="28" height="28" role="img" aria-label="RUYIN">
<defs>
  <clipPath id="xL"><path d="M59.4 89.2L26.8 121.8L65.0 159.9L97.6 127.2Z"/></clipPath>
  <clipPath id="xR"><path d="M196.6 166.8L229.2 134.2L191.1 96.1L158.4 128.8Z"/></clipPath>
</defs>
<path fill="#0052D9" fill-rule="evenodd" d="M143.3 19.3L19.3 143.3A66 66 0 0 0 112.7 236.7L236.7 112.7A66 66 0 0 0 143.3 19.3ZM174.4 50.4L50.4 174.4A22 22 0 0 0 81.6 205.6L205.6 81.6A22 22 0 0 0 174.4 50.4Z"/>
<path fill="#B5C7FF" fill-rule="evenodd" d="M19.3 112.7L143.3 236.7A66 66 0 0 0 236.7 143.3L112.7 19.3A66 66 0 0 0 19.3 112.7ZM50.4 81.6L174.4 205.6A22 22 0 0 0 205.6 174.4L81.6 50.4A22 22 0 0 0 50.4 81.6Z"/>
<path fill="#0052D9" fill-rule="evenodd" clip-path="url(#xL)" d="M143.3 19.3L19.3 143.3A66 66 0 0 0 112.7 236.7L236.7 112.7A66 66 0 0 0 143.3 19.3ZM174.4 50.4L50.4 174.4A22 22 0 0 0 81.6 205.6L205.6 81.6A22 22 0 0 0 174.4 50.4Z"/>
<path fill="#0052D9" fill-rule="evenodd" clip-path="url(#xR)" d="M143.3 19.3L19.3 143.3A66 66 0 0 0 112.7 236.7L236.7 112.7A66 66 0 0 0 143.3 19.3ZM174.4 50.4L50.4 174.4A22 22 0 0 0 81.6 205.6L205.6 81.6A22 22 0 0 0 174.4 50.4Z"/>
</svg>`;

// ============================================================================
// Constant response and exact stylesheet policy
// ============================================================================
/** Browser-only handoff view; no identity, approval handle or session is rendered. */
export const NATIVE_DONE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录完成 · RUYIN</title>
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
  <header>${BRAND_MARK}<span class="wordmark">RUYIN</span><span class="product">桌面应用</span></header>
  <main>
    <section class="completion" aria-labelledby="completion-title">
      <div class="status" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="m6.5 12 3.6 3.6 7.4-7.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h1 id="completion-title">登录完成</h1>
      <p class="message">请返回 RUYIN 桌面应用继续。</p>
      <p class="note">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor"/><path d="M6 6l4 4m0-4-4 4" stroke="currentColor" stroke-linecap="round"/></svg>
        现在可以关闭此页面
      </p>
    </section>
  </main>
</div>
</body>
</html>`;

/** Allow only these fixed style bytes while retaining the existing content denies. */
export const NATIVE_DONE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(STYLES).digest("base64")}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
