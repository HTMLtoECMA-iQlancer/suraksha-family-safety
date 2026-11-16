import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronRight,
  Download,
  ExternalLink,
  Globe2,
  HelpCircle,
  Info,
  KeyRound,
  Languages,
  LogOut,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { PolicyMap } from '@suraksha/shared';
import { apiFetch, ApiError, downloadExport, tokenStore, updatePolicy } from '../api';
import type { PoliciesResponse } from '../api';
import { useAuth } from '../auth';
import { useDevices } from '../devices';
import { useI18n } from '../i18n';
import { useTheme, type ThemeMode } from '../theme';
import { useToast } from '../toast';
import {
  Avatar,
  Button,
  Field,
  Modal,
  Notice,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toggle,
} from '../ui';

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { user, family, logout, refreshMe } = useAuth();
  const { selected } = useDevices();
  const { mode, setMode } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notifications, setNotifications] = useState<PolicyMap['notifications'] | null>(null);
  const [quietStart, setQuietStart] = useState('21:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [policyBusy, setPolicyBusy] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  const loadPolicy = useCallback(async () => {
    if (!selected) {
      setNotifications(null);
      return;
    }
    try {
      const data = await apiFetch<PoliciesResponse>(`/devices/${selected.id}/policies`);
      setNotifications(data.policies.notifications);
      setQuietStart(data.policies.notifications.quietHours.start);
      setQuietEnd(data.policies.notifications.quietHours.end);
    } catch {
      setNotifications(null);
    }
  }, [selected]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const saveProfile = async () => {
    setProfileBusy(true);
    try {
      await apiFetch('/me', { method: 'PATCH', body: { displayName: displayName.trim(), phone: phone.trim() || null } });
      await refreshMe();
      toast.success(t('common.done'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setProfileBusy(false);
    }
  };

  const chooseLocale = async (next: 'en' | 'gu') => {
    setLocale(next);
    try {
      await apiFetch('/me', { method: 'PATCH', body: { locale: next } });
    } catch {
      // The local preference still applies if the network write fails.
    }
  };

  const saveNotifications = async (patch: Partial<PolicyMap['notifications']>) => {
    if (!selected || !notifications) return;
    const previous = notifications;
    const next = { ...notifications, ...patch };
    setNotifications(next);
    setPolicyBusy(true);
    try {
      await updatePolicy(selected.id, 'notifications', next);
    } catch (err) {
      setNotifications(previous);
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setPolicyBusy(false);
    }
  };

  const saveQuietHours = async () => {
    if (!notifications) return;
    await saveNotifications({ quietHours: { ...notifications.quietHours, start: quietStart, end: quietEnd } });
    toast.success(t('common.done'));
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await downloadExport();
      toast.success(t('settings.exported'));
    } catch {
      toast.error('Could not export your data');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      await apiFetch('/me', { method: 'DELETE', body: { password: deletePassword } });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!user) return null;

  const themes: { key: ThemeMode; label: string; icon: ReactNode }[] = [
    { key: 'light', label: t('settings.themeLight'), icon: <Sun size={16} /> },
    { key: 'dark', label: t('settings.themeDark'), icon: <Moon size={16} /> },
    { key: 'system', label: t('settings.themeSystem'), icon: <Palette size={16} /> },
  ];

  return (
    <div className="page">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <section className="profile-card card">
        <Avatar name={user.displayName} size={64} />
        <div className="profile-text">
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
          <div className="profile-badges">
            <span className="mini-badge">{family?.role === 'owner' ? t('family.roleOwner') : family?.role === 'parent' ? t('family.roleParent') : t('family.roleCaregiver')}</span>
            <span className="mini-badge">{family?.name}</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" loading={profileBusy} onClick={() => void saveProfile()}>
          {t('common.save')}
        </Button>
      </section>

      <SectionHeader title={t('settings.profile')} />
      <section className="card">
        <div className="form-grid">
          <Field label={t('auth.name')}>
            <input className="input" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label={t('auth.phone')}>
            <input className="input" type="tel" value={phone} maxLength={30} onChange={(event) => setPhone(event.target.value)} placeholder="+91" />
          </Field>
          <Field label={t('auth.email')}>
            <input className="input" value={user.email} disabled />
          </Field>
          <Field label={t('settings.language')} hint={t('settings.languageHint')}>
            <div className="seg">
              <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => void chooseLocale('en')}>
                English
              </button>
              <button type="button" className={locale === 'gu' ? 'active' : ''} onClick={() => void chooseLocale('gu')}>
                ગુજરાતી
              </button>
            </div>
          </Field>
        </div>
      </section>

      <SectionHeader title={t('settings.theme')} />
      <section className="card">
        <div className="theme-options" role="radiogroup" aria-label={t('settings.theme')}>
          {themes.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={mode === option.key}
              className={`theme-option${mode === option.key ? ' selected' : ''}`}
              onClick={() => setMode(option.key)}
            >
              <span className={`theme-swatch swatch-${option.key}`} />
              {option.icon}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      <SectionHeader title={t('settings.security')} />
      <div className="manage-list card">
        <button type="button" className="manage-row" onClick={() => setPasswordOpen(true)}>
          <span className="manage-icon"><KeyRound size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.changePassword')}</strong>
            <small>Scrypt-hashed · all other refresh tokens are revoked</small>
          </span>
          <ChevronRight size={17} className="manage-chevron" />
        </button>
      </div>

      <SectionHeader
        title={t('settings.notifications')}
        action={selected ? <span className="section-note">{selected.childName} · {selected.name}</span> : undefined}
      />
      {notifications ? (
        <section className="card">
          <div className="setting-list">
            <div className="setting-row">
              <div>
                <strong>{t('settings.safetyAlerts')}</strong>
                <small>Geofence, SOS and driving alerts</small>
              </div>
              <Toggle
                label={t('settings.safetyAlerts')}
                checked={notifications.safetyAlerts}
                disabled={policyBusy}
                onChange={(next) => void saveNotifications({ safetyAlerts: next })}
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>{t('settings.sessionRequests')}</strong>
                <small>Child approval and session updates</small>
              </div>
              <Toggle
                label={t('settings.sessionRequests')}
                checked={notifications.sessionRequests}
                disabled={policyBusy}
                onChange={(next) => void saveNotifications({ sessionRequests: next })}
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>{t('settings.dailyDigest')}</strong>
                <small>One summary each evening</small>
              </div>
              <Toggle
                label={t('settings.dailyDigest')}
                checked={notifications.dailyDigest}
                disabled={policyBusy}
                onChange={(next) => void saveNotifications({ dailyDigest: next })}
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>{t('settings.quietHours')}</strong>
                <small>{notifications.quietHours.start} – {notifications.quietHours.end}</small>
              </div>
              <Toggle
                label={t('settings.quietHours')}
                checked={notifications.quietHours.enabled}
                disabled={policyBusy}
                onChange={(next) =>
                  void saveNotifications({ quietHours: { ...notifications.quietHours, enabled: next } })
                }
              />
            </div>
          </div>
          <div className="quiet-hours">
            <label>
              {t('settings.quietStart')}
              <input type="time" className="input" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} />
            </label>
            <label>
              {t('settings.quietEnd')}
              <input type="time" className="input" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} />
            </label>
            <Button size="sm" variant="secondary" loading={policyBusy} onClick={() => void saveQuietHours()}>
              {t('common.save')}
            </Button>
          </div>
          <p className="field-hint">{t('settings.notificationNote')} Push delivery requires FCM configuration.</p>
        </section>
      ) : (
        <section className="card">
          <Skeleton height={18} />
          <Skeleton height={18} width="70%" />
        </section>
      )}

      <SectionHeader title={t('settings.privacy')} />
      <div className="manage-list card">
        <Link to="/privacy" className="manage-row">
          <span className="manage-icon"><ShieldCheck size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.privacyPolicy')}</strong>
            <small>{t('privacy.updated')}</small>
          </span>
          <ChevronRight size={17} className="manage-chevron" />
        </Link>
        <button type="button" className="manage-row" onClick={() => void doExport()} disabled={exporting}>
          <span className="manage-icon"><Download size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.exportData')}</strong>
            <small>JSON with your account, devices, policies and events</small>
          </span>
          <ChevronRight size={17} className="manage-chevron" />
        </button>
        <button type="button" className="manage-row danger-row" onClick={() => setDeleteOpen(true)}>
          <span className="manage-icon"><Trash2 size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.deleteAccount')}</strong>
            <small>{t('settings.deleteWarning')}</small>
          </span>
          <ChevronRight size={17} className="manage-chevron" />
        </button>
      </div>

      <SectionHeader title={t('settings.help')} />
      <div className="manage-list card">
        <Link to="/help" className="manage-row">
          <span className="manage-icon"><HelpCircle size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.help')}</strong>
            <small>{t('settings.helpHint')}</small>
          </span>
          <ChevronRight size={17} className="manage-chevron" />
        </Link>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="manage-row">
          <span className="manage-icon"><Globe2 size={19} /></span>
          <span className="manage-text">
            <strong>Map data</strong>
            <small>OpenStreetMap contributors</small>
          </span>
          <ExternalLink size={16} className="manage-chevron" />
        </a>
        <div className="manage-row static">
          <span className="manage-icon"><Info size={19} /></span>
          <span className="manage-text">
            <strong>{t('settings.about')}</strong>
            <small>{t('settings.version')} · React + Node + PGlite</small>
          </span>
        </div>
      </div>

      <Button
        variant="secondary"
        block
        icon={<LogOut size={17} />}
        onClick={async () => {
          await logout();
          navigate('/login', { replace: true });
        }}
      >
        {t('settings.signOut')}
      </Button>

      <p className="version-foot">
        <Languages size={13} /> English & ગુજરાતી · <Bell size={13} /> Consent-based by design · <UserRound size={13} /> © 2026 Suraksha
      </p>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('settings.deleteAccount')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={deleteBusy} disabled={!deletePassword} onClick={() => void deleteAccount()} icon={<Trash2 size={16} />}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <Notice tone="danger">{t('settings.deleteWarning')}</Notice>
        <Field label={t('auth.password')}>
          <input
            className="input"
            type="password"
            value={deletePassword}
            autoComplete="current-password"
            onChange={(event) => setDeletePassword(event.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ tokens: import('@suraksha/shared').AuthTokens }>('/me/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      tokenStore.set(result.tokens);
      toast.success(t('settings.passwordChanged'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.changePassword')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={current.length < 1 || next.length < 8 || next !== confirm}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('settings.currentPassword')}>
          <input className="input" type="password" value={current} autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label={t('settings.newPassword')} hint={t('auth.passwordHint')}>
          <input className="input" type="password" value={next} autoComplete="new-password" onChange={(event) => setNext(event.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
