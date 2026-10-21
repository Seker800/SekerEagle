import { PhotoPrivatePeopleSettings } from './components/photos/PhotoPrivatePeopleSettings';
import { useQueryClient } from '@tanstack/react-query';
import { t } from './i18n';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import sekerEagleLogo from './assets/seker-eagle-logo.svg';
import { AccountHome } from './components/account/AccountHome';
import { DesktopConnectionButton } from './components/desktop/DesktopConnectionButton';
import { LibraryModeControl } from './components/eagle/LibraryModeControl';
import { SekerEaglePage } from './components/eagle/SekerEaglePage';
import { LibraryWorkspaceProvider } from './lib/library-workspace';
import { createPrivacyVisibilityApi } from './lib/privacy-visibility-api';
import type { LibraryMode } from './lib/library-api-scope';
import { request } from './lib/api-client';
import { ApiError } from './lib/api-error';
import {
  DEFAULT_PRIVACY_VISIBILITY,
  type PrivacyVisibilityState,
} from './lib/privacy-visibility-api';
export interface User {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}
export function App() {
  const queryClient = useQueryClient();
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(() =>
    window.matchMedia?.('(max-width: 720px)').matches ? 'PHOTO' : 'MATERIAL',
  );
  const modeRef = useRef(libraryMode);
  modeRef.current = libraryMode;
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const checkInFlight = useRef(false);
  const sessionEpoch = useRef(0);
  const mounted = useRef(false);
  const [privacyVisibility, setPrivacyVisibility] = useState<PrivacyVisibilityState>(
    DEFAULT_PRIVACY_VISIBILITY,
  );
  const [privacyRulesRevision, setPrivacyRulesRevision] = useState(0);
  const checkSession = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    const epoch = sessionEpoch.current;
    setCheckingConnection(true);
    try {
      const { user: current } = await request<{ user: User }>('/api/auth/me');
      if (mounted.current && epoch === sessionEpoch.current) {
        setUser((previous) =>
          previous?.id === current.id &&
          previous.email === current.email &&
          previous.role === current.role
            ? previous
            : current,
        );
        setConnectionUnavailable(false);
      }
    } catch (cause) {
      if (mounted.current && epoch === sessionEpoch.current) {
        if (
          cause instanceof ApiError &&
          (cause.status === 401 || (cause.status === 403 && cause.code !== 'ORIGIN_REJECTED'))
        ) {
          setUser(null);
          setConnectionUnavailable(false);
        } else {
          setConnectionUnavailable(true);
        }
      }
    } finally {
      checkInFlight.current = false;
      if (mounted.current && epoch === sessionEpoch.current) {
        setLoading(false);
        setCheckingConnection(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void checkSession();
    return () => {
      mounted.current = false;
    };
  }, [checkSession]);
  useEffect(() => {
    const timer =
      connectionUnavailable || user
        ? window.setInterval(() => void checkSession(), connectionUnavailable ? 5000 : 30000)
        : null;
    const onOnline = () => void checkSession();
    window.addEventListener('online', onOnline);
    const onOffline = () => setConnectionUnavailable(true);
    window.addEventListener('offline', onOffline);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [checkSession, connectionUnavailable, user]);
  useEffect(() => {
    if (!user) {
      setPrivacyVisibility(DEFAULT_PRIVACY_VISIBILITY);
      return;
    }
    let active = true;
    void createPrivacyVisibilityApi(libraryMode)
      .getPrivacyVisibility()
      .then((value) => {
        if (active) setPrivacyVisibility(value);
      })
      .catch(() => {
        if (active) setPrivacyVisibility(DEFAULT_PRIVACY_VISIBILITY);
      });
    return () => {
      active = false;
    };
  }, [user, libraryMode]);
  useEffect(() => {
    if (!privacyVisibility.enabled || !privacyVisibility.expiresAt) return;
    const delay = new Date(privacyVisibility.expiresAt).getTime() - Date.now();
    if (delay <= 0) {
      setPrivacyVisibility((current) => ({ ...current, enabled: false, expiresAt: null }));
      return;
    }
    const timer = window.setTimeout(
      () => setPrivacyVisibility((current) => ({ ...current, enabled: false, expiresAt: null })),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [privacyVisibility.enabled, privacyVisibility.expiresAt]);
  async function login(event: FormEvent) {
    event.preventDefault();
    sessionEpoch.current++;
    setError('');
    setNotice('');
    try {
      const result = await request<{
        user: User;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setUser(result.user);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('登录失败'));
    }
  }
  async function logout(noticeAfterLogout = '') {
    sessionEpoch.current++;
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      await queryClient.cancelQueries();
      queryClient.clear();
      setUser(null);
      setConnectionUnavailable(false);
      setCheckingConnection(false);
      setPassword('');
      setNotice(noticeAfterLogout);
    }
  }
  const connectionButton = <DesktopConnectionButton />;
  if (loading) {
    return (
      <main className="auth-loading">
        {connectionButton}
        <img src={sekerEagleLogo} alt="" />
        <span>{t('正在连接 SekerEagle…')}</span>
      </main>
    );
  }
  if (connectionUnavailable) {
    return (
      <main className="auth-shell auth-offline-shell">
        {connectionButton}
        <section className="auth-card auth-offline-card" role="status">
          <img src={sekerEagleLogo} alt="" />
          <h1>{t('无法连接素材库')}</h1>
          <p>{t('正在自动重试，网络恢复后会继续打开图库。')}</p>
          <button
            className="primary-button"
            type="button"
            disabled={checkingConnection}
            onClick={() => void checkSession()}
          >
            {checkingConnection ? t('正在重试…') : t('立即重试')}
          </button>
        </section>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="auth-shell">
        {connectionButton}
        <section className="auth-intro" aria-label={t('SekerEagle 介绍')}>
          <div className="auth-brand">
            <span className="auth-brand-mark">
              <img src={sekerEagleLogo} alt="" />
            </span>
            <span>SekerEagle</span>
          </div>
          <div>
            <p className="auth-eyebrow">PERSONAL ASSET LIBRARY</p>
            <h1>{t('让灵感，各归其位。')}</h1>
            <p>{t('独立、安全的个人素材库。收集、整理并快速找回每一份视觉灵感。')}</p>
          </div>
        </section>
        <form className="auth-card" onSubmit={(event) => void login(event)}>
          <header>
            <p className="auth-eyebrow">{t('欢迎回来')}</p>
            <h2>{t('登录素材库')}</h2>
            <p>{t('使用你的 SekerEagle 独立账号继续。')}</p>
          </header>
          <label>
            {' ' + t('邮箱') + ' '}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
              autoFocus
              required
            />
          </label>
          <label>
            {' ' + t('密码') + ' '}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder={t('输入密码')}
              required
            />
          </label>
          {notice ? <p className="auth-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button" type="submit">
            {' ' + t('登录') + ' '}
            <IconArrowRight size={17} />
          </button>
        </form>
      </main>
    );
  }
  return (
    <LibraryWorkspaceProvider
      key={`${user.id}:${libraryMode}`}
      libraryMode={libraryMode}
      ownerId={user.id}
    >
      <div className="standalone-eagle-shell">
        {connectionButton}
        <SekerEaglePage
          modeSwitcher={
            <LibraryModeControl
              value={libraryMode}
              onChange={(mode) => {
                setPrivacyVisibility(DEFAULT_PRIVACY_VISIBILITY);
                setLibraryMode(mode);
              }}
            />
          }
          accountSummary={{ email: user.email, onLogout: () => void logout() }}
          ownerId={user.id}
          canManageProcessing={user.role === 'ADMIN'}
          privacyVisibility={privacyVisibility}
          privacyRulesRevision={privacyRulesRevision}
          onPrivacyRulesChange={() => setPrivacyRulesRevision((revision) => revision + 1)}
          accountView={
            <AccountHome
              user={user}
              onPasswordChanged={() => logout(t('密码已修改，请使用新密码重新登录。'))}
              onLogout={() => void logout()}
              privacyVisibility={privacyVisibility}
              onPrivacyVisibilityChange={(value) => {
                if (modeRef.current === libraryMode) setPrivacyVisibility(value);
              }}
              privacyExtras={
                libraryMode === 'PHOTO' ? (
                  <PhotoPrivatePeopleSettings
                    includePrivate={privacyVisibility?.enabled === true}
                    onRulesChange={() => setPrivacyRulesRevision((revision) => revision + 1)}
                  />
                ) : undefined
              }
              onPrivacyRulesChange={() => setPrivacyRulesRevision((revision) => revision + 1)}
            />
          }
        />
      </div>
    </LibraryWorkspaceProvider>
  );
}
