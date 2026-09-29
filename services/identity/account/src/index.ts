/**
 * @vxture/service-account — Identity core account service.
 * User + Identities (federation) + credentials (Argon2id).
 * docs/design/identity-platform-architecture.md §2 (身份模型/包结构)；数据模型见 platform-data-architecture-schema.md §4.
 */

export {
  PasswordHasher,
  hashPassword,
  verifyPassword,
  ARGON2ID_PARAMS,
} from "./password/password-hasher";

export { AccountModule } from "./module/account.module";
export { FavoritesService } from "./favorites/favorites.service";
export {
  NotificationPreferencesService,
  NOTIFICATION_TOPICS,
  NOTIFICATION_CHANNELS,
} from "./notification-preferences/notification-preferences.service";
export type {
  NotificationPreferences,
  NotificationTopic,
  NotificationChannel,
  NotificationChannelState,
} from "./notification-preferences/notification-preferences.service";
export {
  AccountService,
  assertValidAccount,
  accountPurgeAt,
  ACCOUNT_DELETION_RETENTION_DAYS,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  type DeletionRequestResult,
  type PasswordWriteCause,
  type PasswordWriteContext,
  type PendingSignInNotice,
} from "./service/account.service";

/**
 * 账号安全事件的客户通知契约（2026-09-29）。装配处（console-bff / auth-bff）拿
 * `CustomerNotifier` 把 NotificationDispatcher 注进 AccountService——**结构兼容，不引包**。
 */
export {
  ACTOR_PARAM,
  PROVIDER_PARAM,
  SECURITY_ACTORS,
  SECURITY_NOTIFICATION_TEMPLATES,
  SECURITY_REFERENCE_TYPE,
  formatOccurredAt,
  securityEventOf,
  securityReferenceId,
  type AccountNotificationTemplate,
  type CustomerNotifier,
  type CustomerNotifyInput,
} from "./service/customer-notifier";
export {
  UNSEEN_DEVICE_LOOKBACK_DAYS,
  deviceFingerprint,
  isUnseenDevice,
  securityNotice,
  type SecurityNotifyExtras,
  type SecurityNotifyFacts,
  type SecurityNotifyGap,
  type SecurityNotifyOutcome,
} from "./service/security-notifications";
export { PgUserRepository, MockUserRepository } from "./repository";
export { ACCOUNT_PG_POOL, USER_REPOSITORY } from "./tokens";

export {
  sniffImageType,
  AVATAR_MAX_BYTES,
  type AvatarMime,
} from "./avatar/image-sniff";

export type {
  UserView,
  UserCredentialRecord,
  CreateUserInput,
  CreateUserRecord,
  BackfillProfileInput,
  BindIdentityInput,
  UpdateProfileInput,
  UserReadRepository,
  AvatarRecord,
  SetAvatarInput,
  IdentityRecord,
  LastLoginRecord,
  LoginHistoryEntry,
  AuthSessionRecord,
  AdminStatusChange,
  SignInDeviceHistory,
} from "./types/account.types";
