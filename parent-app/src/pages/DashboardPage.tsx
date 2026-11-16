import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppWindow,
  ArrowRight,
  Ban,
  BatteryMedium,
  BellRing,
  CalendarClock,
  Camera,
  ChevronRight,
  Clock3,
  Eye,
  Globe2,
  History,
  Lock,
  MapPin,
  MessageSquareWarning,
  Mic,
  Monitor,
  PhoneCall,
  ShieldCheck,
  Smartphone,
  Timer,
  Users,
  Wifi,
} from 'lucide-react';
import type { SafetyEvent } from '@suraksha/shared';
import { SESSION_LABELS, todayIso } from '@suraksha/shared';
import { apiFetch, ApiError } from '../api';
import type { OverviewResponse } from '../api';
import { useAuth } from '../auth';
import { useDevices } from '../devices';
import { duration, relativeTime, weekdayShort } from '../format';
import { useI18n } from '../i18n';
import { useRealtimeMessage } from '../realtime';
import { openChildPreview } from '../childPreview';
import { useAppActions } from '../Shell';
import { useToast } from '../toast';
import { Avatar, Button, EmptyState, ErrorState, Modal, Notice, Pill, Progress, SectionHeader, Skeleton, StatTile } from '../ui';

export function DashboardPage() {
  const { t, locale } = useI18n();
  const { user, family } = useAuth();
  const { selected, loading: devicesLoading } = useDevices();
  const { openSession, openPairing } = useAppActions();
  const toast = useToast();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockMinutes, setLockMinutes] = useState(30);
  const [lockBusy, setLockBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const reloadRef = useRef<number | null>(null);

  const deviceId = selected?.id ?? null;

  const load = useCallback(async () => {
    if (!deviceId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<OverviewResponse>(`/devices/${deviceId}/overview`);
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this device');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  const scheduleLoad = useCallback(() => {
    if (reloadRef.current) window.clearTimeout(reloadRef.current);
    reloadRef.current = window.setTimeout(() => void load(), 400);
  }, [load]);

  useEffect(() => {
    setLoading(true);
    setOverview(null);
    void load();
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type === 'event.new' && message.data.event.deviceId === deviceId) scheduleLoad();
    if (message.type === 'session.update' && message.data.session.deviceId === deviceId) scheduleLoad();
    if (message.type === 'location.update' && message.data.point.deviceId === deviceId) scheduleLoad();
    if (message.type === 'policy.updated' && message.data.deviceId === deviceId) scheduleLoad();
  });

  const startLock = async (minutes: number) => {
    if (!deviceId) return;
    setLockBusy(true);
    try {
      await apiFetch(`/devices/${deviceId}/focus-lock`, { method: 'POST', body: { minutes } });
      toast.success(t('time.lockStarted'));
      setLockOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setLockBusy(false);
    }
  };

  const endLock = async () => {
    if (!deviceId) return;
    setLockBusy(true);
    try {
      await apiFetch(`/devices/${deviceId}/focus-lock`, { method: 'DELETE' });
      toast.success(t('time.lockEnded'));
      setLockOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setLockBusy(false);
    }
  };

  const stopSession = async () => {
    if (!overview?.openSession) return;
    setEnding(true);
    try {
      await apiFetch(`/sessions/${overview.openSession.id}/end`, { method: 'POST', body: { reason: 'Stopped from dashboard' } });
      toast.success(t('session.ended'));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setEnding(false);
    }
  };

  const today = overview?.usage.days.find((day) => day.day === todayIso());
  const todayMinutes = today?.totalMinutes ?? 0;
  const limit = overview?.policies.screen_time.dailyLimitMinutes ?? 0;
  const week = [...(overview?.usage.days ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const weekMax = Math.max(60, ...week.map((day) => day.totalMinutes));
  const instantBlock = overview?.policies.instant_block;
  const lockActive = Boolean(instantBlock?.active && (!instantBlock.until || Date.parse(instantBlock.until) > Date.now()));
  const permissionHealth = overview?.device.permissionHealth ?? selected?.permissionHealth ?? 0;
  const firstName = user?.displayName?.split(' ')[0] ?? '';
  const dateLine = new Date().toLocaleDateString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  if (devicesLoading || (loading && !overview)) {
    return (
      <div className="page">
        <div className="dash-skeleton">
          <Skeleton height={30} width="45%" />
          <Skeleton height={150} />
          <Skeleton height={120} />
          <Skeleton height={220} />
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="page">
        <div className="empty-page-card">
          <Smartphone size={38} />
          <h1>{t('dashboard.addDevice')}</h1>
          <p>Pair your child’s phone to see screen time, location and safety alerts in one place.</p>
          <Button onClick={openPairing} icon={<Smartphone size={17} />}>
            {t('dashboard.addDevice')}
          </Button>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!overview) return null;

  const quickActions: { key: string; label: string; icon: typeof Camera; onClick: () => void; accent: string }[] = [
    { key: 'camera', label: t('dashboard.requestCamera'), icon: Camera, onClick: () => openSession('camera'), accent: 'blue' },
    { key: 'audio', label: t('dashboard.requestAudio'), icon: Mic, onClick: () => openSession('audio'), accent: 'violet' },
    { key: 'screen', label: t('dashboard.requestScreen'), icon: Monitor, onClick: () => openSession('screen'), accent: 'teal' },
    { key: 'location', label: t('nav.location'), icon: MapPin, onClick: () => navigate('/location'), accent: 'rose' },
    { key: 'time', label: t('dashboard.screenTime'), icon: Timer, onClick: () => navigate('/screen-time'), accent: 'amber' },
    { key: 'lock', label: t('dashboard.instantBlock'), icon: Lock, onClick: () => setLockOpen(true), accent: 'slate' },
  ];

  return (
    <div className="page">
      <header className="dash-head">
        <div>
          <p className="eyebrow">{dateLine}</p>
          <h1>
            {t('dashboard.welcome')}, {firstName}
          </h1>
          <p className="page-sub">{family?.name} · {t('dashboard.familyDashboard')}</p>
        </div>
        <button type="button" className="link-btn" onClick={() => navigate('/notifications')}>
          <BellRing size={16} /> {t('dashboard.notifications')}
        </button>
      </header>

      {overview.openSession ? (
        <div className={`live-banner status-${overview.openSession.status}`}>
          <span className="live-dot" />
          <div>
            <strong>
              {overview.openSession.status === 'pending' ? t('session.waiting') : t('dashboard.liveNow')}
            </strong>
            <span>
              {SESSION_LABELS[overview.openSession.kind]} · {overview.openSession.parentName} ·{' '}
              {relativeTime(overview.openSession.createdAt, locale)}
            </span>
          </div>
          <Button variant="soft" size="sm" onClick={() => navigate('/sessions')}>
            {t('dashboard.openSessions')}
          </Button>
          {overview.openSession.status !== 'pending' ? (
            <Button variant="danger" size="sm" loading={ending} onClick={() => void stopSession()}>
              {t('session.end')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="device-hero card">
        <div className="device-hero-top">
          <div className="device-identity">
            <Avatar name={selected.childName} size={56} />
            <div>
              <h2>{selected.name}</h2>
              <p>
                {selected.childName} · {selected.model}
                {selected.platform === 'android' && selected.osVersion ? ` · ${selected.osVersion}` : null}
              </p>
              <div className="identity-pills">
                <Pill tone={selected.online ? 'success' : 'neutral'}>
                  <i className={`dot ${selected.online ? 'online' : ''}`} /> {selected.online ? t('common.online') : t('common.offline')}
                </Pill>
                <Pill tone={permissionHealth >= 80 ? 'success' : permissionHealth >= 50 ? 'warning' : 'danger'}>
                  {permissionHealth}% {t('dashboard.permissions')}
                </Pill>
                {selected.trustedCheckIn?.enabled ? (
                  <Pill tone="info">{t('dashboard.quickCheckOn')}</Pill>
                ) : null}
              </div>
            </div>
          </div>
          <button type="button" className="permission-ring" onClick={() => navigate('/permissions')} aria-label={t('dashboard.permissions')}>
            <span className="ring-visual" style={{ '--ring-value': `${permissionHealth * 3.6}deg` } as CSSProperties}>
              <span>{permissionHealth}%</span>
            </span>
            <small>{t('dashboard.permissionHealth')}</small>
          </button>
        </div>

        <div className="device-metrics">
          <StatTile label={t('dashboard.battery')} value={selected.battery !== null ? `${selected.battery}%` : '—'} hint={selected.battery !== null && selected.battery < 20 ? 'Low battery' : 'Good'} />
          <StatTile label={t('dashboard.network')} value={<span className="inline-icon"><Wifi size={16} /> {selected.network ?? '—'}</span>} />
          <StatTile label={t('dashboard.lastSync')} value={relativeTime(selected.lastSeenAt, locale)} />
          <StatTile label={t('dashboard.dailyLimit')} value={duration(limit, locale)} hint={`${duration(todayMinutes, locale)} ${t('dashboard.usedToday')}`} />
        </div>

        <div className="hero-actions">
          <Button variant="secondary" size="sm" onClick={() => navigate('/permissions')} icon={<ShieldCheck size={16} />}>
            {t('dashboard.fixPermissions')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openSession('camera')} icon={<Eye size={16} />}>
            {selected.trustedCheckIn?.enabled ? t('session.quickCheckTitle') : t('session.requestTitle')}
          </Button>
        </div>
      </section>

      {permissionHealth < 100 ? (
        <Notice tone="warning" icon={<ShieldCheck size={18} />}>
          {t('dashboard.needsAttention')}: {overview.device.permissions.filter((permission) => !permission.granted).length}{' '}
          {locale === 'gu' ? 'પરવાનગી બાકી છે.' : 'permissions are still missing. Some features will not work until they are granted on the child device.'}
        </Notice>
      ) : null}

      {lockActive ? (
        <Notice tone="danger" icon={<Lock size={18} />}>
          <strong>{t('time.lockActive', { time: instantBlock?.until ? new Date(instantBlock.until).toLocaleTimeString(locale === 'gu' ? 'gu-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' }) : '—' })}</strong>{' '}
          <button type="button" className="inline-link" onClick={() => setLockOpen(true)}>
            {t('time.endLock')}
          </button>
        </Notice>
      ) : null}

      <SectionHeader
        title={t('dashboard.quickActions')}
        action={
          <button type="button" className="link-btn" onClick={() => navigate('/sessions')}>
            {t('dashboard.sessionHistory')} <ArrowRight size={14} />
          </button>
        }
      />
      <div className="quick-grid">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.key} type="button" className="quick-tile" onClick={action.onClick}>
              <span className={`quick-icon accent-${action.accent}`}>
                <Icon size={21} />
              </span>
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      <div className="dash-columns">
        <section className="card usage-card">
          <SectionHeader
            title={t('dashboard.screenTime')}
            action={
              <button type="button" className="link-btn" onClick={() => navigate('/screen-time')}>
                {t('dashboard.manage')} <ChevronRight size={15} />
              </button>
            }
          />
          <div className="usage-total">
            <div>
              <strong>{duration(todayMinutes, locale)}</strong>
              <span>{t('dashboard.usedToday')}</span>
            </div>
            <div className="usage-limit">
              <small>{t('dashboard.dailyLimit')}</small>
              <strong>{duration(limit, locale)}</strong>
            </div>
          </div>
          <Progress value={limit ? (todayMinutes / limit) * 100 : 0} tone={todayMinutes > limit ? 'danger' : todayMinutes / Math.max(limit, 1) > 0.8 ? 'warning' : 'brand'} />
          <div className="week-bars" aria-label={t('time.week')}>
            {week.map((day) => {
              const height = Math.max(6, Math.round((day.totalMinutes / weekMax) * 76));
              const isToday = day.day === todayIso();
              return (
                <div key={day.day} className={`week-col${isToday ? ' today' : ''}`}>
                  <div className="week-bar-track">
                    <span style={{ height }} title={`${day.totalMinutes} min`} />
                  </div>
                  <small>{weekdayShort(day.day, locale)}</small>
                </div>
              );
            })}
            {!week.length ? <p className="muted">{t('common.noData')}</p> : null}
          </div>
          <div className="top-apps">
            {(today?.entries ?? []).slice(0, 3).map((entry) => (
              <div key={entry.package} className="top-app-row">
                <span className={`app-dot cat-${entry.category.toLowerCase()}`}>{entry.appName.slice(0, 1)}</span>
                <span className="app-name">{entry.appName}</span>
                <span className="app-minutes">{duration(entry.minutes, locale)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card events-card">
          <SectionHeader
            title={t('dashboard.todaysEvents')}
            action={
              <button type="button" className="link-btn" onClick={() => navigate('/events')}>
                {t('common.viewAll')} <ChevronRight size={15} />
              </button>
            }
          />
          {overview.events.length ? (
            <ul className="event-mini-list">
              {overview.events.slice(0, 5).map((event) => (
                <EventMini key={event.id} event={event} onClick={() => navigate('/events')} />
              ))}
            </ul>
          ) : (
            <EmptyState title={t('event.empty')} />
          )}
        </section>
      </div>

      <SectionHeader title={t('dashboard.locationSafety')} />
      <button type="button" className="location-preview card" onClick={() => navigate('/location')}>
        <div className="mini-map" aria-hidden>
          <span className="map-pin-pulse">
            <MapPin size={22} />
          </span>
          <span className="map-grid" />
        </div>
        <div className="location-preview-copy">
          <div className="row-between">
            <strong>{t('location.lastLocation')}</strong>
            <Pill tone={overview.policies.location.sharingEnabled ? 'success' : 'neutral'}>
              {overview.policies.location.sharingEnabled ? t('location.sharingOn') : t('location.sharingOff')}
            </Pill>
          </div>
          <p>
            {overview.location
              ? `${overview.location.lat.toFixed(4)}, ${overview.location.lng.toFixed(4)} · ${relativeTime(overview.location.recordedAt, locale)}`
              : t('location.noLocation')}
          </p>
          <span className="muted">
            {overview.geofences.length} {t('dashboard.geofences')} · {overview.policies.location.drivingAlerts ? t('dashboard.drivingAlerts') : '—'}
          </span>
          <span className="inline-cta">
            {t('location.title')} <ChevronRight size={15} />
          </span>
        </div>
      </button>

      <SectionHeader title={t('dashboard.contentSafety')} />
      <div className="manage-list card">
        <ManageRow
          icon={<Timer size={19} />}
          title={t('dashboard.screenTime')}
          subtitle={`${duration(todayMinutes, locale)} ${t('dashboard.usedToday')} · ${t('dashboard.dailyLimit')} ${duration(limit, locale)}`}
          onClick={() => navigate('/screen-time')}
        />
        <ManageRow
          icon={<Lock size={19} />}
          title={t('dashboard.instantBlock')}
          subtitle={lockActive ? t('common.active') : t('dashboard.usagePlan')}
          value={lockActive ? t('common.enabled') : undefined}
          onClick={() => setLockOpen(true)}
        />
        <ManageRow
          icon={<AppWindow size={19} />}
          title={t('dashboard.usagePlan')}
          subtitle={`${overview.policies.app_rules.rules.length} ${locale === 'gu' ? 'એપ મર્યાદા' : 'apps with limits'}`}
          onClick={() => navigate('/screen-time')}
        />
        <ManageRow
          icon={<MessageSquareWarning size={19} />}
          title={t('dashboard.contentSafety')}
          subtitle={t('safety.subtitle')}
          onClick={() => navigate('/content-safety')}
        />
        <ManageRow
          icon={<Globe2 size={19} />}
          title={t('dashboard.safeBrowsing')}
          subtitle={overview.policies.safe_browsing.enabled ? t('browsing.methodDns') : t('browsing.needsSetup')}
          value={overview.policies.safe_browsing.enabled ? t('common.enabled') : t('common.disabled')}
          onClick={() => navigate('/safe-browsing')}
        />
        <ManageRow
          icon={<History size={19} />}
          title={t('dashboard.sessionHistory')}
          subtitle={`${overview.sessions.length} ${locale === 'gu' ? 'તાજેતરના સેશન' : 'recent sessions'}`}
          onClick={() => navigate('/sessions')}
        />
        <ManageRow
          icon={<PhoneCall size={19} />}
          title={t('dashboard.callsSms')}
          subtitle={t('safety.callsNote')}
          badge={t('common.osLimited')}
          onClick={() => navigate('/content-safety')}
        />
      </div>

      <SectionHeader title={t('dashboard.devicesSupport')} />
      <div className="manage-list card">
        <ManageRow
          icon={<ShieldCheck size={19} />}
          title={t('dashboard.requiredPermissions')}
          subtitle={`${permissionHealth}% · ${overview.device.permissions.filter((permission) => permission.granted).length}/${overview.device.permissions.length} ${t('permissions.granted')}`}
          onClick={() => navigate('/permissions')}
        />
        <ManageRow
          icon={<Smartphone size={19} />}
          title={t('dashboard.openChildPreview')}
          subtitle={selected.model}
          onClick={() => void openChildPreview(selected.id)}
        />
        <ManageRow
          icon={<CalendarClock size={19} />}
          title={t('dashboard.supervision')}
          subtitle={t('family.accessNote')}
          onClick={() => navigate('/family')}
        />
        <ManageRow
          icon={<Users size={19} />}
          title={t('family.title')}
          subtitle={`${family?.name ?? ''}`}
          onClick={() => navigate('/family')}
        />
        <ManageRow
          icon={<Clock3 size={19} />}
          title={t('dashboard.helpSupport')}
          subtitle={t('help.title')}
          onClick={() => navigate('/help')}
        />
        <ManageRow
          icon={<BatteryMedium size={19} />}
          title={t('dashboard.appVersion')}
          subtitle={selected.appVersion}
          value={selected.platform}
          onClick={() => navigate('/settings')}
        />
      </div>

      <FocusLockModal
        open={lockOpen}
        minutes={lockMinutes}
        setMinutes={setLockMinutes}
        active={lockActive}
        until={instantBlock?.until ?? null}
        busy={lockBusy}
        onClose={() => setLockOpen(false)}
        onStart={() => void startLock(lockMinutes)}
        onEnd={() => void endLock()}
      />
    </div>
  );
}

function EventMini({ event, onClick }: { event: SafetyEvent; onClick: () => void }) {
  const { locale } = useI18n();
  return (
    <li>
      <button type="button" className="event-mini" onClick={onClick}>
        <span className={`severity-dot sev-${event.severity}`} />
        <span className="event-mini-text">
          <strong>{event.title}</strong>
          <small>{event.detail}</small>
        </span>
        <span className="event-mini-time">{relativeTime(event.occurredAt, locale)}</span>
      </button>
    </li>
  );
}

function ManageRow({
  icon,
  title,
  subtitle,
  value,
  badge,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="manage-row" onClick={onClick}>
      <span className="manage-icon">{icon}</span>
      <span className="manage-text">
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      {badge ? <span className="manage-badge">{badge}</span> : null}
      {value ? <span className="manage-value">{value}</span> : null}
      <ChevronRight size={17} className="manage-chevron" />
    </button>
  );
}

function FocusLockModal({
  open,
  minutes,
  setMinutes,
  active,
  until,
  busy,
  onClose,
  onStart,
  onEnd,
}: {
  open: boolean;
  minutes: number;
  setMinutes: (minutes: number) => void;
  active: boolean;
  until: string | null;
  busy: boolean;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <ModalShell open={open} title={t('time.focusLock')} onClose={onClose}>
      <p className="modal-lead">{t('time.focusLockBody')}</p>
      {active ? (
        <>
          <Notice tone="warning" icon={<Lock size={18} />}>
            {t('time.lockActive', {
              time: until
                ? new Date(until).toLocaleTimeString(locale === 'gu' ? 'gu-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })
                : '—',
            })}
          </Notice>
          <Button block variant="danger" loading={busy} onClick={onEnd} icon={<Ban size={17} />}>
            {t('time.endLock')}
          </Button>
        </>
      ) : (
        <>
          <div className="chip-row">
            {[15, 30, 60, 120].map((value) => (
              <button
                key={value}
                type="button"
                className={`chip${minutes === value ? ' selected' : ''}`}
                onClick={() => setMinutes(value)}
              >
                {value} {t('time.minutes')}
              </button>
            ))}
          </div>
          <Notice tone="brand" icon={<Eye size={18} />}>
            {locale === 'gu'
              ? 'બાળકને લોક અને તેનો અંત સમય દેખાશે. એપ ચાલુ હોય ત્યારે જ લાગુ થાય છે.'
              : 'The child sees the lock and its end time. On a normal phone the lock is enforced inside the Suraksha Child app, not across the whole OS.'}
          </Notice>
          <Button block loading={busy} onClick={onStart} icon={<Lock size={17} />}>
            {t('time.startLock')}
          </Button>
        </>
      )}
      <Button block variant="ghost" onClick={onClose}>
        {t('common.close')}
      </Button>
    </ModalShell>
  );
}

function ModalShell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="stack">{children}</div>
    </Modal>
  );
}
