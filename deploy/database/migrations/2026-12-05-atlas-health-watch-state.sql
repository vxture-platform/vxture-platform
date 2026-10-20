-- #562: additive durable Atlas health watcher state and recovery permission.
-- Apply before deploying the event-consuming platform-api. Safe to reapply.
BEGIN;

-- Durable state for the Atlas watcher; no credentials or user identifiers.
CREATE TABLE IF NOT EXISTS provisioning.health_watch_state (
    watcher               varchar(32) PRIMARY KEY,
    event_cursor          text,
    initialized           boolean NOT NULL DEFAULT false,
    consecutive_failures  int NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 3),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provisioning.health_watch_events (
    event_id              varchar(128) PRIMARY KEY,
    created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provisioning.health_watch_subjects (
    subject_kind          varchar(32) NOT NULL,
    subject_key           varchar(256) NOT NULL,
    fingerprint           varchar(64) NOT NULL,
    state                 varchar(64) NOT NULL,
    episode               int NOT NULL CHECK (episode >= 1),
    notice_reference      varchar(256),
    last_source           varchar(256) NOT NULL,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_kind, subject_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON provisioning.health_watch_state, provisioning.health_watch_subjects TO svc_platform_api, platform_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON provisioning.health_watch_events TO svc_platform_api, platform_svc;

-- Health watcher anchors remain immutable under the shared application role.
REVOKE UPDATE ON provisioning.health_watch_state FROM platform_svc;
GRANT UPDATE (event_cursor, initialized, consecutive_failures, updated_at) ON provisioning.health_watch_state TO platform_svc;
REVOKE UPDATE ON provisioning.health_watch_events FROM platform_svc;
REVOKE UPDATE ON provisioning.health_watch_subjects FROM platform_svc;
GRANT UPDATE (fingerprint, state, episode, notice_reference, last_source, updated_at) ON provisioning.health_watch_subjects TO platform_svc;

-- Recovery may end only system notices through the producer's exact reference.
GRANT UPDATE (expires_at, updated_at) ON admin.operator_notices TO svc_platform_api;

COMMIT;
