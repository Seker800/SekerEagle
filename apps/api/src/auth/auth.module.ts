import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AccessAuthGuard } from './access-auth.guard';
import { AdminGuard } from './admin.guard';
import { BrowserOriginGuard } from './browser-origin.guard';
import { BrowserOrPatOriginGuard } from './browser-or-pat-origin.guard';
import { BrowserPrincipalGuard } from './browser-principal.guard';
import { BrowserSessionService } from './browser-session.service';
import { PasswordService } from './password.service';
import { PatService } from './pat.service';
import { PatScopeGuard } from './pat-scope.guard';
import { PrivacyVisibilityService } from './privacy-visibility.service';
import { SessionTokenService } from './session-token.service';
import { DeploymentIdentityService } from './deployment-identity.service';
import { DesktopBootstrapController } from './desktop-bootstrap.controller';

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
  controllers: [AuthController, DesktopBootstrapController],
  providers: [
    AccessAuthGuard,
    AdminGuard,
    BrowserOriginGuard,
    BrowserOrPatOriginGuard,
    BrowserPrincipalGuard,
    BrowserSessionService,
    PasswordService,
    PatService,
    PatScopeGuard,
    PrivacyVisibilityService,
    SessionTokenService,
    DeploymentIdentityService,
  ],
  exports: [
    AccessAuthGuard,
    AdminGuard,
    BrowserOriginGuard,
    BrowserOrPatOriginGuard,
    BrowserPrincipalGuard,
    PatScopeGuard,
    PrivacyVisibilityService,
    PasswordService,
    PatService,
    SessionTokenService,
  ],
})
export class AuthModule {}
