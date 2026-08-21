/**
 * auth.api.ts - 认证 API 层
 * @package @vxture/website
 * @layer Presentation
 * @category API
 *
 * Post-OIDC surface only: the RP login/logout entries (build*Url) + the
 * RP-backed session/profile reads on website-bff's MeRouter (/api/me*). The
 * legacy HS256 /api/auth/* seam (login/signup/logout/reset/phone/bind) was
 * retired once login/register/reset/social moved to the central accounts page.
 */

import { apiClient, API_BASE_URL } from "./client";
import { AUTH_CONSTANTS } from "@vxture-platform/shared";

/**
 * Absolute URL of the RP login entry on website-bff. It 302s to the IdP
 * authorize endpoint and on to the central accounts login surface; on success
 * the callback sets the opaque RP session cookie and redirects to `returnTo`.
 * Lives at the BFF root (outside the legacy /api/auth/* seam). The browser must
 * top-level-navigate here so the central vx_sid is reachable (SSO).
 * See docs/design/identity-platform-implementation.md §3 (16a).
 */
export function buildRpLoginUrl(
  returnTo?: string,
  opts?: { prompt?: string },
): string {
  const base = `${API_BASE_URL}/auth/login`;
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (opts?.prompt) params.set("prompt", opts.prompt);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Absolute URL of the RP logout entry on website-bff (top-level GET). It drops
 * the local RP session, then redirects to the IdP end_session (single-logout) →
 * unified post-logout page. The browser must top-level-navigate here (not fetch)
 * so vx_sid reaches the IdP. See identity-platform-access-topology.md §5.
 */
export function buildLogoutUrl(): string {
  return `${API_BASE_URL}/auth/logout`;
}

/**
 * Absolute URL of the RP switch-user entry (top-level GET). Ends the central
 * session like logout, but lands the user on the accounts login form (a fresh
 * authorize) so they can sign in as a different account. See identity-access-
 * topology.md §5 and the accounts post-logout router.
 */
export function buildSwitchUserUrl(): string {
  return `${API_BASE_URL}/auth/switch`;
}

export interface AuthUserDto {
  id: string;
  name: string;
  displayName?: string | null;
  username?: string;
  /** Platform avatar URL (versioned); null/absent → default silhouette. */
  picture?: string | null;
  avatarUrl?: string | null;
  email: string;
  phone?: string | null;
  role: string;
  roleLabel?: string;
  personalVerified?: boolean | null;
  organizationVerified?: boolean | null;
  organizationName?: string | null;
  tenantType?: "individual" | "company" | "organization" | string | null;
  /** Whether this login/signup auto-created the account; frontend may prompt for a nickname. */
  isNewAccount?: boolean;
}

export interface AccountProfileDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
}

export interface UpdateProfileRequest {
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  timezone?: string | null;
  language?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  nextPassword: string;
}

/** Current user (RP session → website-bff MeRouter, DB-real-time). */
export async function getProfile(): Promise<AuthUserDto> {
  const response = await apiClient.get(AUTH_CONSTANTS.API_ENDPOINTS.ME);
  return response.data;
}

export async function getUserProfile(): Promise<AccountProfileDto> {
  const response = await apiClient.get<AccountProfileDto>("/api/me/profile");
  return response.data;
}

export async function updateUserProfile(
  data: UpdateProfileRequest,
): Promise<AccountProfileDto> {
  const response = await apiClient.put<AccountProfileDto>(
    "/api/me/profile",
    data,
  );
  return response.data;
}

export async function changeUserPassword(
  data: ChangePasswordRequest,
): Promise<void> {
  await apiClient.put("/api/me/password", data);
}
