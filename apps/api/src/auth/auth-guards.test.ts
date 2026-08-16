import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthPrincipal } from './auth.types';
import { BrowserPrincipalGuard } from './browser-principal.guard';
import { PatScopeGuard } from './pat-scope.guard';

function contextFor(principal: AuthPrincipal): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
    getHandler: () => contextFor,
    getClass: () => BrowserPrincipalGuard,
  } as unknown as ExecutionContext;
}

const browser: AuthPrincipal = {
  sub: 'browser-user',
  username: 'browser',
  role: UserRole.USER,
  authVersion: 0,
  kind: 'browser',
  scopes: [],
};

const pat: AuthPrincipal = {
  ...browser,
  sub: 'pat-user',
  username: 'pat',
  kind: 'pat',
  scopes: ['import:read'],
};

void test('browser-only guard rejects PAT principals', () => {
  const guard = new BrowserPrincipalGuard();
  assert.equal(guard.canActivate(contextFor(browser)), true);
  assert.throws(() => guard.canActivate(contextFor(pat)));
});

void test('PAT scope guard allows browser sessions and matching PAT scopes', () => {
  const reflector = new Reflector();
  Reflect.defineMetadata('sekereagle:required-pat-scopes', ['import:read'], contextFor);
  const guard = new PatScopeGuard(reflector);
  assert.equal(guard.canActivate(contextFor(browser)), true);
  assert.equal(guard.canActivate(contextFor(pat)), true);
});

void test('PAT scope guard rejects missing scopes', () => {
  const reflector = new Reflector();
  Reflect.defineMetadata('sekereagle:required-pat-scopes', ['asset:write'], contextFor);
  const guard = new PatScopeGuard(reflector);
  assert.throws(() => guard.canActivate(contextFor(pat)));
});
