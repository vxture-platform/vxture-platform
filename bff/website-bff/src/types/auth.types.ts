/**
 * auth.types.ts - Authentication DTO Types
 * @package @vxture/bff-website
 * @description DTO types for authentication APIs (BFF contract to frontend)
 * @author AI-Generated
 * @date 2026-03-15
 * @version 1.0
 * @copyright Vxture Team
 * @layer Application
 * @category Types
 */

import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class LoginDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class SignupDto {
  @IsEmail({}, { message: "请输入有效邮箱" })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: "姓名不能为空" })
  name!: string;

  @IsString()
  @MinLength(8, { message: "密码至少 8 位字符" })
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: "请输入有效邮箱" })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8, { message: "密码至少 8 位字符" })
  newPassword!: string;
}

export class InitTenantDto {
  @IsString()
  @IsIn(["individual", "organization"], { message: "请选择个人或企业" })
  type!: "individual" | "organization";
}

export interface AuthUserDto {
  id: string;
  name: string;
  displayName?: string | null;
  username?: string;
  /** Platform avatar URL (versioned); null/absent → default silhouette. */
  picture?: string | null;
  email: string;
  phone?: string | null;
  role: string;
  roleLabel?: string;
  personalVerified?: boolean | null;
  organizationVerified?: boolean | null;
  organizationName?: string | null;
  tenantType?: string | null;
}

export interface RequestContext {
  user?: AuthUserDto;
  tenantId?: string;
}

// ── 账户 Profile DTO ─────────────────────────────────────────────────────────
// 字段与 account.users / account.user_profiles 真列一一对应。曾有的 headline
// 于 2026-08-30 删除：账户 schema 没有这一列，之前只是恒为 null 的占位。

export interface AccountProfileDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  username?: string | null;

  @IsOptional()
  @IsString()
  displayName?: string | null;

  @IsOptional()
  @IsString()
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  bio?: string | null;

  @IsOptional()
  @IsString()
  timezone?: string | null;

  @IsOptional()
  @IsString()
  language?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: "当前密码不能为空" })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: "新密码至少 8 位字符" })
  nextPassword!: string;
}
