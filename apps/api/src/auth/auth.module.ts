import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AccessAuthGuard } from './access-auth.guard';
import { AdminGuard } from './admin.guard';
import { BrowserOriginGuard } from './browser-origin.guard';
import { BrowserPrincipalGuard } from './browser-principal.guard';
import { BrowserSessionService } from './browser-session.service';
import { PasswordService } from './password.service';
import { PatService } from './pat.service';
import { PatScopeGuard } from './pat-scope.guard';
import { SessionTokenService } from './session-token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AccessAuthGuard,
    AdminGuard,
    BrowserOriginGuard,
    BrowserPrincipalGuard,
    BrowserSessionService,
    PasswordService,
    PatService,
    PatScopeGuard,
    SessionTokenService,
  ],
  exports: [AccessAuthGuard, AdminGuard, PatScopeGuard, PasswordService, PatService],
})
export class AuthModule {}
