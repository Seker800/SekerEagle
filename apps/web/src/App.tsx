import { t } from './i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import sekerEagleLogo from './assets/seker-eagle-logo.svg';
import { AccountHome } from './components/account/AccountHome';
import { DesktopConnectionButton } from './components/desktop/DesktopConnectionButton';
import modeStyles from './components/eagle/LibraryModeSwitcher.module.css';
import { SekerEaglePage } from './components/eagle/SekerEaglePage';
import { LibraryWorkspaceProvider } from './lib/library-workspace';
import { createPrivacyVisibilityApi } from './lib/privacy-visibility-api';
import type { LibraryMode } from './lib/library-api-scope';
import { request } from './lib/api-client';
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
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('MATERIAL');
  const modeRef = useRef(libraryMode);
  modeRef.current = libraryMode;
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [privacyVisibility, setPrivacyVisibility] = useState<PrivacyVisibilityState>(
    DEFAULT_PRIVACY_VISIBILITY,
  );
  const [privacyRulesRevision, setPrivacyRulesRevision] = useState(0);
  useEffect(() => {
    request<{
      user: User;
    }>('/api/auth/me')
      .then(({ user: current }) => setUser(current))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);
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
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setUser(null);
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
            <nav aria-label={t('图库模式')} className={modeStyles.switcher}>
              <button
                type="button"
                className={modeStyles.option}
                aria-pressed={libraryMode === 'MATERIAL'}
                onClick={() => {
                  setPrivacyVisibility(DEFAULT_PRIVACY_VISIBILITY);
                  setLibraryMode('MATERIAL');
                }}
              >
                {t('素材')}
              </button>
              <button
                type="button"
                className={modeStyles.option}
                aria-pressed={libraryMode === 'PHOTO'}
                onClick={() => {
                  setPrivacyVisibility(DEFAULT_PRIVACY_VISIBILITY);
                  setLibraryMode('PHOTO');
                }}
              >
                {t('照片')}
              </button>
            </nav>
          }
          ownerId={user.id}
          canManageProcessing={user.role === 'ADMIN'}
          privacyVisibility={privacyVisibility}
          privacyRulesRevision={privacyRulesRevision}
          accountView={
            <AccountHome
              user={user}
              onPasswordChanged={() => logout(t('密码已修改，请使用新密码重新登录。'))}
              onLogout={() => void logout()}
              privacyVisibility={privacyVisibility}
              onPrivacyVisibilityChange={(value) => {
                if (modeRef.current === libraryMode) setPrivacyVisibility(value);
              }}
              onPrivacyRulesChange={() => setPrivacyRulesRevision((revision) => revision + 1)}
            />
          }
        />
      </div>
    </LibraryWorkspaceProvider>
  );
}
