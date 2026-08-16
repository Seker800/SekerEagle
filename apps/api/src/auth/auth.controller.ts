import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AccessAuthGuard } from './access-auth.guard';
import { AdminGuard } from './admin.guard';
import { BrowserOriginGuard } from './browser-origin.guard';
import { BrowserPrincipalGuard } from './browser-principal.guard';
import { BrowserSessionService } from './browser-session.service';
import { CurrentPrincipal } from './current-principal.decorator';
import {
  ChangePasswordDto,
  CreatePatDto,
  CreateUserDto,
  LoginDto,
  ResetPasswordDto,
  SetUserDisabledDto,
} from './dto';
import { PasswordService } from './password.service';
import { PatService } from './pat.service';
import { SessionTokenService } from './session-token.service';
import type { AuthPrincipal } from './auth.types';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly passwords: PasswordService,
    private readonly tokens: SessionTokenService,
    private readonly browser: BrowserSessionService,
    private readonly pats: PatService,
  ) {}

  @Post('auth/login')
  @UseGuards(BrowserOriginGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.passwords.login(dto.email, dto.password);
    const session = await this.tokens.createSession(user);
    this.browser.write(response, session);
    return { user: session.user };
  }

  @Post('auth/refresh')
  @UseGuards(BrowserOriginGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = this.browser.refreshToken(request);
    if (!token) throw new UnauthorizedException('缺少刷新令牌。');
    const session = await this.tokens.refreshSession(token);
    this.browser.write(response, session);
    return { user: session.user };
  }

  @Post('auth/logout')
  @UseGuards(BrowserOriginGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.tokens.revoke(this.browser.refreshToken(request));
    this.browser.clear(response);
    return { ok: true };
  }

  @Get('auth/me')
  @UseGuards(AccessAuthGuard)
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return { user: { id: principal.sub, email: principal.email, role: principal.role } };
  }

  @Patch('auth/me/password')
  @UseGuards(AccessAuthGuard, BrowserPrincipalGuard, BrowserOriginGuard)
  async changePassword(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.passwords.changePassword(principal.sub, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @Post('admin/users')
  @UseGuards(AccessAuthGuard, AdminGuard, BrowserOriginGuard)
  async createUser(@Body() dto: CreateUserDto) {
    const user = await this.passwords.createUser(dto.email, dto.password, dto.role);
    return { user: { id: user.id, email: user.email, role: user.role } };
  }

  @Patch('admin/users/:userId/password')
  @UseGuards(AccessAuthGuard, AdminGuard, BrowserOriginGuard)
  async resetPassword(@Param('userId') userId: string, @Body() dto: ResetPasswordDto) {
    await this.passwords.resetPassword(userId, dto.newPassword);
    return { ok: true };
  }

  @Patch('admin/users/:userId/disabled')
  @UseGuards(AccessAuthGuard, AdminGuard, BrowserOriginGuard)
  async setUserDisabled(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('userId') userId: string,
    @Body() dto: SetUserDisabledDto,
  ) {
    if (principal.sub === userId && dto.disabled) {
      throw new BadRequestException('不能停用当前管理员账号。');
    }
    await this.passwords.setDisabled(userId, dto.disabled);
    return { ok: true };
  }

  @Get('tokens')
  @UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
  listTokens(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.pats.list(principal.sub);
  }

  @Post('tokens')
  @UseGuards(AccessAuthGuard, BrowserPrincipalGuard, BrowserOriginGuard)
  createToken(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: CreatePatDto) {
    return this.pats.create(principal.sub, dto.name, dto.scopes, dto.expiresInDays);
  }

  @Delete('tokens/:tokenId')
  @UseGuards(AccessAuthGuard, BrowserPrincipalGuard, BrowserOriginGuard)
  async revokeToken(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tokenId') tokenId: string,
  ) {
    await this.pats.revoke(principal.sub, tokenId);
    return { ok: true };
  }
}
