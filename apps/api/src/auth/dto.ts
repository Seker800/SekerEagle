import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PAT_SCOPES, type PatScope } from './auth.types';

function normalizeLowercaseString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function normalizeString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class LoginDto {
  @ApiProperty({ example: 'seker@example.com', format: 'email' })
  @Transform(({ value }: { value: unknown }) => normalizeLowercaseString(value))
  @IsString()
  @IsEmail({}, { message: '请输入有效的邮箱地址。' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class SetUserDisabledDto {
  @ApiProperty()
  @IsBoolean()
  disabled!: boolean;
}

export class CreateUserDto {
  @ApiProperty({ example: 'new-user@example.com', format: 'email' })
  @Transform(({ value }: { value: unknown }) => normalizeLowercaseString(value))
  @IsString()
  @IsEmail({}, { message: '请输入有效的邮箱地址。' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.USER })
  @IsOptional()
  @IsEnum(UserRole)
  role: UserRole = UserRole.USER;
}

export class CreatePatDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: PAT_SCOPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAT_SCOPES.length)
  @IsEnum(PAT_SCOPES, { each: true })
  scopes!: PatScope[];

  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays = 90;
}
