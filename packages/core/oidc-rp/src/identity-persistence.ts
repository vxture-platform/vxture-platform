/**
 * Structural PostgreSQL ports for host-owned identity protocol persistence.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category types
 * @author AI-Generated
 * @date 2026-11-24
 */
export interface IdentitySql {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface IdentitySqlTransaction extends IdentitySql {
  release(): void;
}

export interface IdentitySqlPool extends IdentitySql {
  connect(): Promise<IdentitySqlTransaction>;
  end(): Promise<void>;
}

export interface IdentityNotification {
  channel: string;
  payload?: string | undefined;
}

export interface IdentityNotificationClient extends IdentitySql {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  onNotification(listener: (value: IdentityNotification) => void): void;
  onDisconnect(listener: () => void): void;
}
