/**
 * Durable health-monitor wire and subject types.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category types
 * @author AI-Generated
 * @date 2026-10-20
 */
export interface HealthEvent {
  id: string;
  createdAt: string;
  subjectKind: "model" | "route" | "vendor" | "atlas";
  subjectKey: string;
  providerCode: string | null;
  from: string;
  to: string;
  severity: "info" | "warning" | "critical";
  upstreamStatus: number | null;
  detail: string | null;
  affectedRoutes: string[];
}

export interface HealthEventPage {
  items: HealthEvent[];
  nextCursor: string | null;
}

export interface HealthSubject {
  kind: string;
  key: string;
  state: string;
  severity: "info" | "warning" | "critical";
  detail: string;
  /** Stable configuration facts, independent of poll time and balance readings. */
  configuration?: string;
}
