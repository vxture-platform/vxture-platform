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
  USERNAME_CHANGE_COOLDOWN_DAYS,
} from "./service/account.service";
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
} from "./types/account.types";
