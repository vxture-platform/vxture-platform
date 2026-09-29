import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PasswordHasher } from "../password/password-hasher";
import { USER_REPOSITORY } from "../tokens";
import { SECURITY_ACTORS } from "./customer-notifier";
import type {
  AccountNotificationTemplate,
  CustomerNotifier,
  CustomerNotifyInput,
} from "./customer-notifier";
import {
  UNSEEN_DEVICE_LOOKBACK_DAYS,
  deviceFingerprint,
  isUnseenDevice,
  securityNotice,
  type SecurityNotifyExtras,
} from "./security-notifications";
import type {
  AvatarRecord,
  BackfillProfileInput,
  BindIdentityInput,
  AuthSessionRecord,
  CreateUserInput,
  IdentityRecord,
  LastLoginRecord,
  LoginHistoryEntry,
  SetAvatarInput,
  UpdateProfileInput,
  UserReadRepository,
  UserView,
} from "../types/account.types";

/**
 * User-chosen username (account) format. First char MUST be an ASCII letter so a
 * user-chosen name can never collide with a system default (`_{user_no}`, which
 * starts with `_`) nor be confused with the numeric `user_no`. Charset
 * [A-Za-z0-9_], total length 3–24. See identity-platform-account.md §4.2.
 */
const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

/** Username (account) may be changed at most once per this many days (§1.1). */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const USERNAME_CHANGE_COOLDOWN_MS =
  USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/**
 * 自助删除的保留期(050-account §7,owner 2026-09-04):申请后 30 天内重新登录可撤销,
 * 到期由 platform-api 的 account-deletion-purge 清扫。
 */
export const ACCOUNT_DELETION_RETENTION_DAYS = 30;

export interface DeletionRequestResult {
  deletionRequestedAt: string;
  /** 保留期到期、可被清扫的时刻(ISO)。 */
  purgeAt: string;
  revokedSessions: number;
  unboundIdentities: number;
}

/** 保留期到期时刻 = 申请时刻 + 30 天。 */
export function accountPurgeAt(deletionRequestedAt: string): string {
  return new Date(
    new Date(deletionRequestedAt).getTime() +
      ACCOUNT_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Throw 400 if a user-supplied account does not meet the format rules (§4.2). */
export function assertValidAccount(account: string): void {
  if (!ACCOUNT_RE.test(account)) {
    throw new BadRequestException(
      "account must start with a letter, contain only letters/digits/underscore, and be 3–24 chars",
    );
  }
}

/**
 * 口令写入的**来由**。四条路各有自己的说法,所以写口令时必须说清是哪一条。
 *
 * 为什么做成必填参数而不是给个默认值:调用方分属三个进程(console 自助改密 / 首次设密、
 * 组织管理员代设、auth-bff 的邮件重置令牌),给了默认值就等于让最要紧的那一条
 * (`reset_by_email`——今天既不落审计也不通知)静默落到「自助改密」的说法上,而客户读到的
 * 将是一句与事实不符的话。必填时编译器会当场点名每一个没交代来由的调用方。
 */
export type PasswordWriteCause =
  | "self_change"
  | "initial_set"
  | "reset_by_email"
  | "reset_by_admin";

export interface PasswordWriteContext {
  cause: PasswordWriteCause;
}

/**
 * 来由 → 模板码 + 操作者码。穷尽映射:加一种来由不给映射就编译不过。
 *
 * **四条来由只落到两个模板码**,这是权威那份码表的形状(dispatch 的
 * `NotificationTemplateCode`,`account.*` 一共十四条),不是这里偷工:
 *   · `password_changed` 的正文写着「由{{actorLabel}}修改」——「谁做的」由参数承担,
 *     所以自助改密与组织管理员代设是**同一条模板、不同操作者码**;
 *   · `password_reset` 单独一条,因为那句话不同:「通过发往你邮箱的重置链接重新设置」。
 * 首次设密没有自己的模板码,落 `password_changed` + `self`——代价是正文说「修改」而不是
 * 「设置」(此前没有密码)。这是权威码表的取舍,已在交付说明里点名给那一侧。
 */
const PASSWORD_NOTICE_OF: Readonly<
  Record<
    PasswordWriteCause,
    { code: AccountNotificationTemplate; actor: string }
  >
> = {
  self_change: {
    code: "account.password_changed",
    actor: SECURITY_ACTORS.self,
  },
  initial_set: {
    code: "account.password_changed",
    actor: SECURITY_ACTORS.self,
  },
  reset_by_admin: {
    code: "account.password_changed",
    actor: SECURITY_ACTORS.tenantAdmin,
  },
  reset_by_email: {
    code: "account.password_reset",
    actor: SECURITY_ACTORS.self,
  },
};

/**
 * 一次登录是否要发「未见过的设备」。`null` = 不发。
 *
 * 它是**两步之间的凭据**:判据必须在本次登录尝试写进 `session.login_attempts` **之前**
 * 取(否则本次那一行自己就成了「这台设备我见过」的证据,判据恒为假),而通知要在写完之后
 * 才发。所以取事实与投递分成两个方法,中间用这个值串起来。
 */
export interface PendingSignInNotice {
  readonly userId: string;
}

/**
 * AccountService — identity-core user lifecycle (User + Identities + credentials).
 * Composes the user repository with the Argon2id PasswordHasher. Owns NO
 * org/workspace/membership logic (that is @vxture/service-organization) and NO
 * login/session/token flows (those land in the identity-server, Batch 4).
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserReadRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  /**
   * 客户通知（账号安全事件，2026-09-29）：装配处 `setCustomerNotifier` 注入；
   * **未注入 = 一条都不发**，而且为了凑参数而多做的那些读查询**一次都不发生**
   * （下面每处都是 `this.notifier ? await … : null`）。此时本服务的行为与加这段之前
   * 逐字相同——这是这段代码的验收条件，不是顺带的优化。
   */
  private notifier: CustomerNotifier | null = null;

  setCustomerNotifier(notifier: CustomerNotifier | null): void {
    this.notifier = notifier;
  }

  /**
   * 通知一律 best-effort：业务写**已经提交**，通知失败只记日志、不抛、不回滚。
   * build 延迟求值（与 subscription / organization / order 的 emit 同形，这条纪律不该
   * 有第五种写法）。
   */
  private async emit(
    label: string,
    build: () => Promise<CustomerNotifyInput | null>,
  ): Promise<boolean> {
    if (!this.notifier) return false;
    try {
      const input = await build();
      if (!input) return false;
      await this.notifier.notify(input);
      return true;
    } catch (err) {
      this.logger.warn(`notify ${label} failed — ${String(err)}`);
      return false;
    }
  }

  /**
   * 一条账号安全通知。取两件公共事实（可视码 + 个人租户），组装，投递。
   *
   * **取事实的两次读整个在 `emit` 的闭包里面。** 这不是排版：`emit` 的 try 只罩得住它自己
   * 调的那个 build，读一旦被提到闭包外面，一次库抖动（连接被掐、语句超时）就会从这里抛回
   * 业务调用方——客户的密码明明已经改成了，页面上收到的却是「改密失败」。也就是说一条
   * 通知的失败反过来把它观察的那件安全操作判成失败，而这是 best-effort 这个词的反面。
   * organization 那侧的 emit 是同一个形状：能抛的东西全在 build 里，docstring 说的「延迟
   * 求值」才是真的。
   *
   * 取可视码走 `findUserForAdmin` 而不是 `getUserById`：被锁定的账号在后者的读谓词里
   * 恒为 null，而「你的账号被锁定了」恰恰是最该发出去的那一条。
   *
   * 发不出去的情形**记一行日志**，不静默返回——否则「没发」和「发了」在日志里一样。
   * 日志里放 user_no 不放账号 uuid：那一列是 uuid，日志也是人在读。
   */
  private async notifySecurity(
    templateCode: AccountNotificationTemplate,
    userId: string,
    extra: SecurityNotifyExtras = {},
  ): Promise<boolean> {
    if (!this.notifier) return false;
    return this.emit(`security ${templateCode}`, async () => {
      const [user, personalTenantId] = await Promise.all([
        this.users.findUserForAdmin(userId),
        this.users.findPersonalTenantId(userId),
      ]);
      const outcome = securityNotice(templateCode, {
        accountId: userId,
        userNo: user?.userNo,
        personalTenantId,
        occurredAt: new Date(),
        ...extra,
      });
      if (!outcome.ok) {
        this.logger.log(
          `security ${templateCode} not notified (${outcome.gap}) — ` +
            `user_no ${user?.userNo ?? "unknown"}`,
        );
        return null;
      }
      return outcome.input;
    });
  }

  /**
   * 「这次登录的设备见过吗」——**必须在本次尝试写进 login_attempts 之前**调用，
   * 理由见 PendingSignInNotice。返回 null = 不发（首次登录 / 认不出设备 / 见过）。
   */
  async detectUnseenDevice(
    userId: string,
    userAgent: string | null,
  ): Promise<PendingSignInNotice | null> {
    if (!this.notifier) return null;
    const fingerprint = deviceFingerprint(userAgent);
    if (!fingerprint) return null;
    let history;
    try {
      history = await this.users.listRecentSignInDevices(
        userId,
        UNSEEN_DEVICE_LOOKBACK_DAYS,
      );
    } catch (err) {
      /* 判据读不到时**不发**，并留一行：默认「没见过」会把每次登录都变成一条警报。 */
      this.logger.warn(`unseen-device history read failed — ${String(err)}`);
      return null;
    }
    const fingerprints = history.userAgents
      .map((ua) => deviceFingerprint(ua))
      .filter((fp): fp is string => fp !== null);
    if (!isUnseenDevice(fingerprint, { ...history, fingerprints })) return null;
    return { userId };
  }

  /** 第二步：流水写完之后投递。`null` 直接过——调用方不必自己判。 */
  async notifyUnseenDevice(pending: PendingSignInNotice | null): Promise<void> {
    if (!pending) return;
    await this.notifySecurity("account.new_device_signin", pending.userId);
  }

  /** Create a user; hashes the password (Argon2id) when provided. */
  async createUser(input: CreateUserInput): Promise<UserView> {
    // Account is optional: when the caller supplies one it must pass the format
    // rules; when absent the repo assigns the default `_{user_no}`.
    const account = input.account?.trim() || null;
    if (account) assertValidAccount(account);
    const passwordHash = input.password
      ? await this.hasher.hash(input.password)
      : null;
    return this.users.createUser({
      account,
      email: input.email ? input.email.toLowerCase().trim() : null,
      emailVerified: input.emailVerified ?? false,
      phone: input.phone,
      phoneVerified: input.phoneVerified ?? true,
      name: input.name ?? null,
      passwordHash,
    });
  }

  /**
   * Fill empty name/email on an existing user from a federated provider. Phone
   * already anchored the account; this only populates blanks (never overwrites,
   * never merges). A colliding email is skipped silently. See §6.
   */
  /** Idempotent growth-baseline heal (loyalty.user_points; onboarding item 10). */
  ensureUserPoints(userId: string): Promise<void> {
    return this.users.ensureUserPoints(userId);
  }

  backfillProfile(userId: string, input: BackfillProfileInput): Promise<void> {
    return this.users.backfillProfile(userId, input);
  }

  getUserById(userId: string): Promise<UserView | null> {
    return this.users.getUserById(userId);
  }

  findUserByIdentifier(identifier: string) {
    return this.users.findUserByIdentifier(identifier);
  }

  /**
   * 按**平台用户号**找人（按 ID 邀请用）。与 `findUserByIdentifier` 刻意分开：
   * 那一个是登录凭据查询，把用户号加进去等于让一个**公开的可视码**变成登录标识。
   */
  findUserByUserNo(userNo: string): Promise<{
    id: string;
    userNo: string;
    name: string | null;
    account: string | null;
    email: string | null;
    phone: string | null;
  } | null> {
    return this.users.findUserByUserNo(userNo);
  }

  /**
   * Verify an identifier (account|email|phone) + password. Returns the user on
   * success, null otherwise. Constant-ish: a missing user still runs a verify to
   * blunt user-enumeration timing (only meaningful once a dummy hash is used;
   * acceptable for MVP). No side effects (login auditing lives in identity-server).
   */
  async verifyCredential(
    identifier: string,
    password: string,
  ): Promise<UserView | null> {
    const record = await this.users.findUserByIdentifier(identifier);
    if (!record || !record.passwordHash) return null;
    const ok = await this.hasher.verify(password, record.passwordHash);
    if (!ok) return null;
    // Checked AFTER the password verifies so a disabled account can't be probed
    // via this flag. Username+password login is off; phone/email/social still work.
    if (record.accountLoginDisabled) {
      throw new UnauthorizedException("account_login_disabled");
    }
    return {
      id: record.id,
      account: record.account,
      email: record.email,
      phone: record.phone,
      name: record.name,
      status: record.status,
      avatarHash: record.avatarHash,
    };
  }

  /** Load a user's custom avatar bytes; null when none (caller serves default). */
  getAvatar(userId: string): Promise<AvatarRecord | null> {
    return this.users.getAvatar(userId);
  }

  /** Store/replace a user's custom avatar; mirrors the hash onto the user row. */
  setAvatar(userId: string, input: SetAvatarInput): Promise<void> {
    return this.users.setAvatar(userId, input);
  }

  /** Remove a user's custom avatar (falls back to the frontend default). */
  deleteAvatar(userId: string): Promise<void> {
    return this.users.deleteAvatar(userId);
  }

  /**
   * Set or change a user's password (hashes plaintext with Argon2id).
   *
   * **口令的唯一写路径**（2026-09-29）：四条路都收口到这里，通知也只长在这一处。
   * 补这条通知时最要紧的一条是 `reset_by_email`——auth-bff 的邮件重置令牌路径今天既不
   * 落审计行也不发任何消息，而它正是账号被接管时真正会被走的那一条。所以判据不能建在
   * 审计行上（那会静默漏掉恰好最要紧的两条），只能长在写路径本身。
   */
  async setPassword(
    userId: string,
    password: string,
    context: PasswordWriteContext,
  ): Promise<void> {
    const hash = await this.hasher.hash(password);
    await this.users.setPassword(userId, hash);
    const notice = PASSWORD_NOTICE_OF[context.cause];
    await this.notifySecurity(notice.code, userId, { actor: notice.actor });
  }

  /**
   * Self-service initial password setup, for a user who registered via
   * phone/social login and has no credential row yet (no old password to
   * verify). Refuses (400) if a password is already set — those users must go
   * through `changePassword` instead.
   */
  async setInitialPassword(userId: string, password: string): Promise<void> {
    const record = await this.users.findCredentialById(userId);
    if (!record) throw new NotFoundException("account_not_found");
    if (record.passwordHash) {
      throw new BadRequestException("password_already_set");
    }
    await this.setPassword(userId, password, { cause: "initial_set" });
  }

  /** Update mutable profile fields (name/email/bio/timezone/language). */
  updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null> {
    return this.users.updateProfile(userId, input);
  }

  /** 注册补齐是否已完成（记下来的事实，不是从用户名长相推断的）。 */
  isProfileCompleted(userId: string): Promise<boolean> {
    return this.users.isProfileCompleted(userId);
  }

  /**
   * 注册补齐（owner 2026-09-08：三项必填）。用户名、显示名、邮箱一起落，
   * 全部成功才标记完成。
   *
   * **顺序是有讲究的**：用户名先改。它是唯一会 409 的一项里最可能撞的
   * （短、好记、先到先得），先做能在冲突时少写两张表；邮箱也唯一，撞了同样抛
   * ConflictException，调用方按字段回报，不要整张表单只说一句"失败"。
   *
   * 这里刻意不开事务：三步分属 users / user_profiles 两张表且各自幂等，
   * 中途失败重新提交即可（用户名已改成功的话第二次是 no-op）；为它引一层跨仓储事务
   * 反而要把 changeUsername 的冷却校验也拖进去。补齐标记放最后——它是"三项都落了"
   * 的凭据，早标一步就会让一个只改了用户名的人被当作已完成。
   */
  async completeProfile(
    userId: string,
    input: { account: string; displayName: string; email: string },
  ): Promise<UserView | null> {
    await this.changeUsername(userId, input.account);
    const view = await this.users.updateProfile(userId, {
      name: input.displayName,
      email: input.email,
    });
    await this.users.markProfileCompleted(userId);
    return view;
  }

  /**
   * Change password after verifying the current one. Returns false if the user
   * has no credential or the current password is wrong (caller maps to 400/403).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const record = await this.users.findCredentialById(userId);
    if (!record?.passwordHash) return false;
    if (!(await this.hasher.verify(currentPassword, record.passwordHash))) {
      return false;
    }
    /* 走 setPassword 而不是直连仓储：通知只长在一处。此前这里是直连的，于是 console 与
       website 两条自助改密路径会从口令写路径的任何加强底下一起绕过去。 */
    await this.setPassword(userId, newPassword, { cause: "self_change" });
    return true;
  }

  /** Atomically update the user's verified phone anchor. Throws ConflictException if taken. */
  async changePhone(
    userId: string,
    newPhone: string,
  ): Promise<UserView | null> {
    const before = this.notifier ? await this.users.getUserById(userId) : null;
    const user = await this.users.changePhone(userId, newPhone);
    /* 号码没变（提交了同一个号）⇒ 这一趟什么都没改 ⇒ 不发。比对用仓储**规范化之后**的值
       （toE164），不用入参：+8613800138000 与 13800138000 是同一个号。 */
    if (user && (!before || before.phone !== user.phone)) {
      await this.notifySecurity("account.phone_changed", userId);
    }
    return user;
  }

  /**
   * Atomically replace the email + mark it verified. Throws ConflictException if taken.
   *
   * **两个地址都发**（owner 2026-09-29 裁定第 4 条）。只通知新地址的话，账号被接管之后那句
   * 警告正好送到接管者手上，而本人一个字都收不到——这条通知存在的理由就是这一种情形。
   *
   * 三件事的顺序是判据本身，改动其中任何一件都会让这一半静默失效：
   *   ① **旧地址在写之前取**。写一提交，`account.users.email` 就是新地址了，而分发器按
   *      account_id 回查的正是那一列——写完再取只会拿到新地址，然后把「这个邮箱已经不再
   *      收到通知」这句话发给那个刚刚开始收通知的地址。
   *   ② **发在写之后**。不用「写之前先发一条」凑数：邮箱唯一键撞了会抛 409，那时信已经发
   *      出去了，一句假话进了旧信箱。
   *   ③ **没有旧地址就一条都不发**。手机号注册、从没绑过邮箱的账号，`before.email` 是
   *      null——往空地址发不是「发了」，是把信丢掉，而且会在日志里伪装成已送达。
   *
   * 旧地址靠 `emailTo` 带给分发器（站内那一半不变，照旧落在本人收件箱里）。
   */
  async changeEmail(
    userId: string,
    newEmail: string,
  ): Promise<UserView | null> {
    const before = this.notifier ? await this.users.getUserById(userId) : null;
    /* ① 写之前捕获。`before` 只在挂了 notifier 时才读 ⇒ 未注入时这一趟与从前逐字相同。 */
    const previousEmail = before?.email?.trim() || null;
    const user = await this.users.changeEmail(userId, newEmail);
    if (user && (!before || before.email !== user.email)) {
      await this.notifySecurity("account.email_changed_new", userId);
      /* ②③ 写提交之后，且只在真有旧地址时。 */
      if (previousEmail) {
        await this.notifySecurity("account.email_changed_old", userId, {
          emailTo: previousEmail,
        });
      }
    }
    return user;
  }

  /** Mark the user's current email verified (verify-current flow). */
  markEmailVerified(userId: string): Promise<UserView | null> {
    return this.users.markEmailVerified(userId);
  }

  /** Mark the user's current phone verified (verify-current flow). */
  markPhoneVerified(userId: string): Promise<UserView | null> {
    return this.users.markPhoneVerified(userId);
  }

  /**
   * Enable/disable username+password login. Refuses to disable the last usable
   * login path — the user must keep a verified phone OR verified email OR a bound
   * social identity, so they can never lock themselves out.
   */
  async setAccountLoginEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<UserView | null> {
    /* 关的那一档本来就要读一次（防锁死）；开的那一档只在挂了 notifier 时才多读一次，
       为的是判「开关真的翻了吗」。未注入 notifier ⇒ 两条路与此前逐字相同。 */
    const before =
      !enabled || this.notifier ? await this.users.getUserById(userId) : null;
    if (!enabled) {
      if (!before) return null;
      const identities = await this.users.listIdentitiesByUser(userId);
      const hasOtherPath =
        (before.phoneVerified ?? false) ||
        (before.emailVerified ?? false) ||
        identities.length > 0;
      if (!hasOtherPath) {
        throw new BadRequestException("cannot_disable_last_login_method");
      }
    }
    const user = await this.users.setAccountLoginDisabled(userId, !enabled);
    /* 翻转前的 disabled 与本次的 enabled 相等 ⇒ 状态确实变了（开 ⇔ 原本是关）。 */
    if (user && before && (before.accountLoginDisabled ?? false) === enabled) {
      await this.notifySecurity(
        enabled
          ? "account.password_login_enabled"
          : "account.password_login_disabled",
        userId,
      );
    }
    return user;
  }

  /**
   * Change the username (account). Enforces format (§4.2), the once-per-30-days
   * cooldown (§1.1), and uniqueness (ConflictException from the repo). A no-op
   * when the username is unchanged. Throws BadRequestException when the cooldown
   * has not elapsed.
   */
  async changeUsername(
    userId: string,
    newAccount: string,
  ): Promise<UserView | null> {
    const account = newAccount.trim();
    assertValidAccount(account);
    const user = await this.users.getUserById(userId);
    if (!user) return null;
    if (user.account.toLowerCase() === account.toLowerCase()) return user;
    if (user.accountChangedAt) {
      const elapsed = Date.now() - new Date(user.accountChangedAt).getTime();
      if (elapsed < USERNAME_CHANGE_COOLDOWN_MS) {
        const nextAt = new Date(
          new Date(user.accountChangedAt).getTime() +
            USERNAME_CHANGE_COOLDOWN_MS,
        ).toISOString();
        throw new BadRequestException(
          `username can only be changed once every ${USERNAME_CHANGE_COOLDOWN_DAYS} days; next change allowed after ${nextAt}`,
        );
      }
    }
    return this.users.changeAccount(userId, account);
  }

  /**
   * 绑定一个第三方身份。**只有真的插了一行才通知**：社交登录每次都会走到这里，而 SQL 是
   * `on conflict do nothing`，不看返回值就会每次登录都发一条「你绑定了新的第三方账号」。
   *
   * 社交注册那条尾巴此刻个人租户可能还没开通，那一趟会落在 `no_personal_tenant` 上并记
   * 一行日志——那是对的：租户还不存在时收件箱无处可落，而它必须留下痕迹。
   */
  async bindIdentity(input: BindIdentityInput): Promise<boolean> {
    const bound = await this.users.bindIdentity(input);
    if (bound) {
      await this.notifySecurity("account.identity_linked", input.userId, {
        provider: input.provider,
      });
    }
    return bound;
  }

  /** Unbind a federated identity (by provider) from the user. 真删了一行才通知。 */
  async removeIdentity(userId: string, provider: string): Promise<boolean> {
    const removed = await this.users.removeIdentity(userId, provider);
    if (removed) {
      await this.notifySecurity("account.identity_unlinked", userId, {
        provider,
      });
    }
    return removed;
  }

  findUserByProviderSubject(provider: string, providerSubject: string) {
    return this.users.findUserByProviderSubject(provider, providerSubject);
  }

  listIdentitiesByUser(userId: string): Promise<IdentityRecord[]> {
    return this.users.listIdentitiesByUser(userId);
  }

  getLastLogin(userId: string): Promise<LastLoginRecord | null> {
    return this.users.getLastLogin(userId);
  }

  /** Recent login attempts (success + failed), newest first. */
  listLoginHistory(userId: string, limit = 20): Promise<LoginHistoryEntry[]> {
    return this.users.listLoginHistory(userId, limit);
  }

  /** Active central sessions for the user (device management, §1.5). */
  listSessions(userId: string): Promise<AuthSessionRecord[]> {
    return this.users.listSessions(userId);
  }

  /**
   * Remote-logout one of the user's sessions; true when revoked.
   *
   * 只有**真的吊掉了一条**才通知（仓储按 `status = 'active'` 取档，重复点同一条回 false）。
   * 正文里不带设备名：权威那十四条模板的正文一个设备参数都没有，写的是「你于 … 把一台设备
   * 从账号中下线」——这条消息的价值在「有一台设备被登出了，如果不是你点的，这是你唯一的
   * 线索」，设备串反而是一行客户读不出所以然的技术噪音。
   */
  async revokeSession(userId: string, sid: string): Promise<boolean> {
    const revoked = await this.users.revokeSession(userId, sid);
    if (revoked) {
      await this.notifySecurity("account.session_ended_by_self", userId);
    }
    return revoked;
  }

  // ── Admin-delegated actions (C12) — an operator acting on a customer account.
  //   Unlike the self-service methods above, these have no anti-lockout guard: a
  //   platform operator may fully disable an account. Callers (auth-bff internal
  //   router) enforce realm isolation (target must be a customer, else 404).

  /**
   * Full-disable a customer account (status='disabled') and revoke all its sessions.
   *
   * `reason` 是运营在 admin 弹窗里填的那一句，**原样进客户正文**（owner 2026-09-29 裁定
   * 第 3 条：那个字段改必填，并照搬给客户）。这里不给默认值也不自己编一句：编出来的
   * 「因违反平台规则」既是假话，又会把「运营没填」这个缺陷永久盖住。空原因 ⇒ 那一条
   * 整条不发并记一行 `no_reason`（守在端点上的 400 见 auth-bff 的内部路由）。
   */
  async adminDisableAccount(
    userId: string,
    reason: string,
  ): Promise<{ user: UserView; revoked: number }> {
    const changed = await this.users.adminSetAccountStatus(userId, "disabled");
    if (!changed) {
      throw new NotFoundException("account_not_found");
    }
    const revoked = await this.users.revokeAllSessions(userId);
    /* 本来就是 disabled ⇒ 这一趟什么都没改 ⇒ 不发第二条（运营双击、admin 重放）。
       靠不了收件箱的唯一键：安全事件的去重锚按设计带时刻，两次锁定是两条。 */
    if (changed.changed) {
      await this.notifySecurity("account.locked", userId, { reason });
    }
    return { user: changed.user, revoked };
  }

  /** Re-enable a disabled customer account (status='active'). `reason` 同上。 */
  async adminEnableAccount(userId: string, reason: string): Promise<UserView> {
    const changed = await this.users.adminSetAccountStatus(userId, "active");
    if (!changed) {
      throw new NotFoundException("account_not_found");
    }
    if (changed.changed) {
      await this.notifySecurity("account.unlocked", userId, { reason });
    }
    return changed.user;
  }

  /**
   * Force-logout: revoke all of the customer's active sessions; returns the count.
   *
   * 存在性门走 `findUserForAdmin` 而不是 `getUserById`：后者的读谓词只放行
   * active / deleting，于是**已锁定的账号根本强制不了下线**（锁定那条路正好会把它置成
   * disabled）。realm 隔离不变——只读 account.users，运营 id 照旧落空回 404。
   */
  async adminForceLogout(
    userId: string,
    reason: string,
  ): Promise<{ revoked: number }> {
    const user = await this.users.findUserForAdmin(userId);
    if (!user) {
      throw new NotFoundException("account_not_found");
    }
    const revoked = await this.users.revokeAllSessions(userId);
    /* 一条会话都没吊掉 ⇒ 这一趟什么都没改 ⇒ 不发。客户此刻本来就没在任何地方登录着，
       发一条「你的全部登录已被结束」只会让他去找一件没发生的事。 */
    if (revoked > 0) {
      await this.notifySecurity("account.sessions_ended_by_operator", userId, {
        reason,
      });
    }
    return { revoked };
  }

  // ── Self-service deletion (050-account §7) ──────────────────────────────
  //   资格判定(组织 owner / 未清账单 / 付费余额 / 在途退款开票 / 有钱在途的订单)不在
  //   这里——那些事实分属 organization / billing / subscription,由 console-bff 的
  //   AccountDeletionAggregator 汇总后才调本方法。本方法只管账号自己这一段:状态、
  //   会话、刷新令牌、三方绑定。

  /**
   * Enter the retention window: active → deleting, revoke every session and
   * refresh token, unbind all federated identities. 404 when gone, 409 when
   * already deleting or otherwise not active.
   */
  async requestDeletion(userId: string): Promise<DeletionRequestResult> {
    const user = await this.users.getUserById(userId);
    if (!user) throw new NotFoundException("account_not_found");
    if (user.status === "deleting") {
      throw new ConflictException("account_already_deleting");
    }
    if (user.status !== "active") {
      throw new ConflictException("account_not_active");
    }
    const updated = await this.users.requestDeletion(userId);
    if (!updated?.deletionRequestedAt) {
      throw new ConflictException("account_not_active");
    }
    const revokedSessions = await this.users.revokeAllSessions(userId);
    await this.users.revokeAllRefreshTokens(userId);
    const unboundIdentities = await this.users.removeAllIdentities(userId);
    return {
      deletionRequestedAt: updated.deletionRequestedAt,
      purgeAt: accountPurgeAt(updated.deletionRequestedAt),
      revokedSessions,
      unboundIdentities,
    };
  }

  /** Undo within the retention window: deleting → active. 409 when not deleting. */
  async cancelDeletion(userId: string): Promise<UserView> {
    const user = await this.users.cancelDeletion(userId);
    if (!user) throw new ConflictException("account_not_deleting");
    return user;
  }

  /** Users whose 30-day window has elapsed and that still await the purge. */
  listDeletionDue(limit = 50): Promise<string[]> {
    return this.users.listDeletionDue(ACCOUNT_DELETION_RETENTION_DAYS, limit);
  }

  /** Anonymise + soft-delete one due user; true when this call did the work. */
  purgeUser(userId: string): Promise<boolean> {
    return this.users.purgeUser(userId);
  }
}
