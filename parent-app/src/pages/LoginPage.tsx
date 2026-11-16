import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Hand, Languages, ShieldCheck, Sparkles, UserRoundPlus } from 'lucide-react';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button } from '../ui';

export function LoginPage() {
  const { status, login, register, demoLogin } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    if (status === 'authed') navigate(from, { replace: true });
  }, [status, navigate, from]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy('form');
    try {
      if (mode === 'login') {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register({
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone.trim() || undefined,
          locale,
          acceptTerms,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.error'));
    } finally {
      setBusy(null);
    }
  };

  const tryDemo = async () => {
    setError(null);
    setBusy('demo');
    try {
      await demoLogin();
    } catch {
      setError('Demo mode is not available. Start the server with DEMO_MODE=1.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="hero-top">
          <span className="brand-mark large">
            <ShieldCheck size={30} />
          </span>
          <span className="hero-brand">Suraksha</span>
        </div>
        <div className="hero-copy">
          <h1>{t('auth.tagline')}</h1>
          <p>{t('auth.subtitle')}</p>
          <ul className="hero-points">
            <li>
              <span className="hero-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>Visible by design</strong>
                <span>Camera, mic and screen sessions always show an indicator.</span>
              </div>
            </li>
            <li>
              <span className="hero-icon">
                <Hand size={18} />
              </span>
              <div>
                <strong>Approved every time</strong>
                <span>Your child approves each session and can stop it instantly.</span>
              </div>
            </li>
            <li>
              <span className="hero-icon">
                <Languages size={18} />
              </span>
              <div>
                <strong>English &amp; ગુજરાતી</strong>
                <span>Use the language that feels comfortable at home.</span>
              </div>
            </li>
          </ul>
        </div>
        <div className="hero-foot">
          <span>Ahmedabad · Built for families</span>
          <Link to="/privacy">Privacy policy</Link>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark">
              <ShieldCheck size={22} />
            </span>
            <span>Suraksha</span>
          </div>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              {t('auth.login')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
            >
              {t('auth.signup')}
            </button>
          </div>

          <div className="auth-heading">
            <h2>{mode === 'login' ? t('auth.loginTitle') : t('auth.signupTitle')}</h2>
            <p>{mode === 'login' ? t('auth.loginSubtitle') : t('auth.signupSubtitle')}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' ? (
              <label className="field">
                <span className="field-label">{t('auth.name')}</span>
                <input
                  className="input"
                  value={displayName}
                  required
                  minLength={2}
                  maxLength={60}
                  autoComplete="name"
                  placeholder="Meera Shah"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            ) : null}

            <label className="field">
              <span className="field-label">{t('auth.email')}</span>
              <input
                className="input"
                type="email"
                value={email}
                required
                autoComplete="email"
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">{t('auth.password')}</span>
              <span className="password-wrap">
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  required
                  minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="password-eye"
                  aria-label={showPassword ? t('common.hide') : t('common.show')}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {mode === 'signup' ? <span className="field-hint">{t('auth.passwordHint')}</span> : null}
            </label>

            {mode === 'signup' ? (
              <>
                <label className="field">
                  <span className="field-label">{t('auth.phone')}</span>
                  <input
                    className="input"
                    type="tel"
                    value={phone}
                    autoComplete="tel"
                    placeholder="+91 98••• •••••"
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} required />
                  <span>
                    {t('auth.terms')} <Link to="/privacy">Read the policy</Link>
                  </span>
                </label>
              </>
            ) : null}

            {error ? <div className="form-error" role="alert">{error}</div> : null}

            <Button type="submit" block size="lg" loading={busy === 'form'} icon={<UserRoundPlus size={18} />}>
              {busy === 'form' ? t('auth.signingIn') : mode === 'login' ? t('auth.login') : t('auth.signup')}
            </Button>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <Button variant="soft" block onClick={() => void tryDemo()} loading={busy === 'demo'} icon={<Sparkles size={17} />}>
            {t('auth.demo')}
          </Button>
          <p className="demo-hint">
            {t('auth.demoHint')} <span className="demo-cred">demo@suraksha.app · Demo1234!</span>
          </p>

          <p className="auth-privacy">
            <ShieldCheck size={15} /> {t('auth.privacyNote')}
          </p>
        </div>

        <button type="button" className="auth-lang" onClick={() => setLocale(locale === 'en' ? 'gu' : 'en')}>
          <Languages size={15} /> {locale === 'en' ? 'ગુજરાતીમાં જુઓ' : 'View in English'}
        </button>
      </section>
    </div>
  );
}
