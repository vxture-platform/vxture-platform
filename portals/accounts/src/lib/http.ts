/**
 * Bounded Accounts HTTP requests without automatic mutation retries.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-10
 */

/**
 * Bound network and response-body reads while respecting caller cancellation.
 * @param input - API endpoint selected by the caller.
 * @param init - Fetch options, including an optional caller-owned abort signal.
 * @returns The response with its body still bound to the same request signal.
 * @throws {DOMException} When cancelled or timed out; fetch errors otherwise propagate.
 */
export function accountsFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(15000);
  return fetch(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}
