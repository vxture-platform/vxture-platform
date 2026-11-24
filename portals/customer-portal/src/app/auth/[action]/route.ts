/**
 * Same-origin browser bridge for the private tenant BFF.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category route
 * @author AI-Generated
 * @date 2026-11-15
 */
import { portalRequest } from "../../../lib/runtime";

const BROWSER_ACTIONS = new Set([
  "login",
  "callback",
  "logout",
  "session",
  "events",
]);

function browserResponse(response: Response): Response {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of response.headers.getSetCookie())
    headers.append("set-cookie", cookie);
  const location = response.headers.get("location");
  if (location) headers.set("location", location);
  for (const key of [
    "x-vxture-session-sync",
    "x-accel-buffering",
    "retry-after",
  ]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  const type = response.headers.get("content-type");
  if (type) headers.set("content-type", type);
  return new Response(response.body, { status: response.status, headers });
}

export async function GET(
  request: Request,
  route: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await route.params;
  if (!BROWSER_ACTIONS.has(action)) return new Response(null, { status: 404 });
  const response = await portalRequest(
    `/auth/${action}${new URL(request.url).search}`,
    { signal: request.signal },
    action === "events",
  );
  if (action === "callback" && response.status === 403) {
    const headers = new Headers({
      location: "/?access=denied",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    });
    for (const cookie of response.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    await response.body?.cancel();
    return new Response(null, { status: 303, headers });
  }
  return browserResponse(response);
}

/** Relay the IdP's signed logout event; no browser session is required. */
export async function POST(
  request: Request,
  route: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await route.params;
  if (!["backchannel-logout", "identity-events"].includes(action))
    return new Response(null, { status: 404 });
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !(
      action === "identity-events"
        ? /^application\/jwt(?:;|$)/i
        : /^application\/x-www-form-urlencoded(?:;|$)/i
    ).test(contentType)
  )
    return new Response(null, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const decoder = new TextDecoder();
  let size = 0,
    body = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > (action === "identity-events" ? 65536 : 16384)) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  return browserResponse(
    await portalRequest(`/auth/${action}`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }),
  );
}
