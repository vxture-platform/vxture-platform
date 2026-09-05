# 用户认证标签三态设计（FB-002 设计稿）

> 状态：设计稿（v0.1，2026-07-06）· 来源 = feature-backlog FB-002 · 依据 = 首用户核验时 owner 提出的"已认证"语义澄清
> 决策原则：认证**三态、且与邮箱无关**（owner 定案）。
> **UI 载体澄清（owner 2026-07-06）**：当前"已认证"是**用户名后的标签(tag)**(如 `StoneSmoker [已认证]`),**不是徽章(badge)**;徽章暂未放认证态。本稿三态针对**这个用户名后标签**;徽章若将来要放认证态,复用同一 `verificationTier` 枚举即可。

## 0. 背景与问题

首用户（feishu）用户名后标签显示"已认证",但库里 `kyc.user_kycs=0`、tenant `verification_status=unverified`——即**"手机已验证"被笼统显示成"已认证"**,易被误解为已实名。现状实现还不一致:

- 旧 `ProfilePage.tsx:931`（批 5a 重排前；现为 `modules/account/profile/ProfilePage.tsx`）硬编码渲染 `verification.unverified`（永远"未认证"占位）;
- 用户名后标签又按 `phone_verified` 显示"已认证";
- 二者都是**二态**(verified / unverified),语义模糊。

**根因**:认证只有二态且判据不清,把"手机验证"与"实名认证"混为一谈。

## 1. 三态模型（authoritative）

| 态             | 文案         | 判据（数据源）                                                    | 语义                            |
| -------------- | ------------ | ----------------------------------------------------------------- | ------------------------------- |
| **已实名认证** | `已实名认证` | `kyc.user_kycs.status = 'verified'`                               | 完成实名 KYC（真名 + 证件核验） |
| **手机已验证** | `手机已验证` | 上一态不成立 **且** `account.users.phone_verified_at IS NOT NULL` | 手机号可信锚点已验证            |
| **未认证**     | `未认证`     | 以上都不成立                                                      | 无任何验证                      |

- **严格降级优先**:实名 > 手机 > 无。有实名则显示实名(不因手机态回退)。
- **与邮箱完全无关**:`email_verified` 不参与此徽章(owner 定案)。邮箱验证态若要展示,是**另一个**独立标记,不进认证徽章。
- **KYC 中间态**:`status='pending'`（审核中）/ `'rejected'`（驳回）→ 归入"手机已验证"或"未认证"(取决于手机态),徽章不单列 pending/rejected;审核过程态在实名认证页内展示,不污染顶层徽章。

## 2. 与"成长等级"的区分（重要:命名冲突）

平台有一套**独立的成长等级**(`loyalty.level_policies`, level_no 1–5),与认证徽章是**两个正交维度**,不可混:

| 维度     | 数据源               | 现状问题 |
| -------- | -------------------- | -------- |
| 认证徽章 | kyc + phone_verified | 本设计修 |
| 成长等级 | loyalty.level_no     | 见下 ⚠️  |

⚠️ **顺带暴露的两个既有问题**(不属本 FB,登记留痕):

1. **等级名前后端分叉**:DB `level_policies.level_name` = `Starter/Bronze/Silver/Gold/Platinum`(seed #624),而前端 `TemplateHeader.USER_LEVELS` **硬编码** `普通用户/认证用户/高级用户/管理员/超级管理员`——前端根本没读 DB。属 FB-005 范畴,应改为读 `level_name`/`level_name_key`。
2. **等级名"认证用户"与认证徽章语义撞车**:成长 level 2 硬编码叫"认证用户",与本徽章的"已实名认证/手机已验证"是两回事,用户极易混淆。**建议成长等级名避开"认证"字样**(随问题 1 一起在 FB-005 重定)。

## 3. 数据契约（后端 → 前端）

会话/profile 聚合返回一个**派生枚举字段**,前端不自己拼判据:

```
verificationTier: 'real_name' | 'phone_verified' | 'none'
```

- 后端 `session.aggregator` / account profile 读 `kyc.user_kycs.status` + `account.users.phone_verified_at`,按 §1 降级规则算出 `verificationTier`,前端仅按枚举渲染文案。
- i18n 键(§3.2.5 规范):`account.verification.tier.real_name` / `.phone_verified` / `.none`。

## 4. 落地清单（实现阶段）

- 后端:profile/session 聚合加 `verificationTier` 派生(纯读,无 schema 改动——kyc/phone 字段已存在);
- 前端:**用户名后标签(tag)** 改渲染三态 `verificationTier`（当前"已认证"二态标签替换为三态文案);`ProfilePage` 去掉硬编码 `verification.unverified` 同步三态;点击"去认证"跳 `/profile/verification`(已存在)不变;
- **徽章(badge)本轮不动**（暂未放认证态;将来要放复用同一枚举);
- i18n:三态文案键入 console messages(zh/en);
- **不动 schema**(无 DDL 变更,不需要 reset 窗口)。

## 5. 开放问题（待 owner 确认后进实现）

1. KYC `pending`（审核中）在顶层徽章里归"手机已验证"还是单列一个"审核中"次态?本稿建议归手机态(徽章只三态),审核态在认证页内。
2. tenant（组织）也有一套 `verification_status`（`/tenant` 的 `TenantPage`，批 5c 合并后）,是**组织实名** vs 本稿的**用户实名**——两者是否用同一套三态文案/图标?建议同构但数据源分开(user kyc vs tenant verification)。
3. "去认证"入口 `/profile/verification` 目前是 skeleton(`VerificationSkeleton.tsx`),实名 KYC 流程本身未接线(铁律四预留)——徽章三态可先上,实名流程另立项。
