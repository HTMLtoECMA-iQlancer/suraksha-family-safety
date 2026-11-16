import { useCallback, useEffect, useState } from 'react';
import {
  AppWindow,
  Ban,
  Clock3,
  Lock,
  Moon,
  Smartphone,
  Timer,
  Zap,
} from 'lucide-react';
import type { AppRule, PolicyMap, ScreenTimeSchedule } from '@suraksha/shared';
import { todayIso, WEEKDAY_LABELS } from '@suraksha/shared';
import { apiFetch, ApiError, updatePolicy } from '../api';
import type { AppsResponse, PoliciesResponse, UsageResponse } from '../api';
import { useDevices } from '../devices';
import { duration, weekdayShort } from '../format';
import { useI18n } from '../i18n';
import { useToast } from '../toast';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Progress,
  SectionHeader,
  Skeleton,
  Toggle,
} from '../ui';

export function ScreenTimePage() {
  const { t, locale } = useI18n();
  const { selected } = useDevices();
  const toast = useToast();
  const [days, setDays] = useState<UsageResponse['days']>([]);
  const [apps, setApps] = useState<AppsResponse['apps']>([]);
  const [policies, setPolicies] = useState<PolicyMap | null>(null);
  const [limit, setLimit] = useState(180);
  const [downtime, setDowntime] = useState<ScreenTimeSchedule>({ enabled: false, start: '21:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [appsBusy, setAppsBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [appEdits, setAppEdits] = useState<Record<string, { blocked: boolean; limitMinutes: number | null }>>({});

  const load = useCallback(async () => {
    if (!selected) {
      setLoading(false);
      return;
    }
    try {
      const [usage, appData, policyData] = await Promise.all([
        apiFetch<UsageResponse>(`/devices/${selected.id}/usage?days=7`),
        apiFetch<AppsResponse>(`/devices/${selected.id}/apps`),
        apiFetch<PoliciesResponse>(`/devices/${selected.id}/policies`),
      ]);
      setDays(usage.days);
      setApps(appData.apps);
      setPolicies(policyData.policies);
      setLimit(policyData.policies.screen_time.dailyLimitMinutes);
      setDowntime(policyData.policies.screen_time.downtime);
      const edits: Record<string, { blocked: boolean; limitMinutes: number | null }> = {};
      for (const app of appData.apps) edits[app.package] = { blocked: app.blocked, limitMinutes: app.limitMinutes };
      setAppEdits(edits);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load screen time');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const savePlan = async () => {
    if (!selected || !policies) return;
    setPlanBusy(true);
    try {
      const next = await updatePolicy(selected.id, 'screen_time', {
        ...policies.screen_time,
        dailyLimitMinutes: limit,
        downtime,
      });
      setPolicies(next);
      toast.success(t('common.done'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setPlanBusy(false);
    }
  };

  const saveApps = async () => {
    if (!selected || !policies) return;
    setAppsBusy(true);
    try {
      const rules = new Map<string, AppRule>(policies.app_rules.rules.map((rule) => [rule.package, rule]));
      for (const app of apps) {
        const edit = appEdits[app.package];
        if (!edit) continue;
        rules.set(app.package, {
          package: app.package,
          appName: app.appName,
          category: app.category,
          blocked: edit.blocked,
          limitMinutes: edit.limitMinutes,
        });
      }
      const next = await updatePolicy(selected.id, 'app_rules', { rules: [...rules.values()] });
      setPolicies(next);
      toast.success(t('common.done'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setAppsBusy(false);
    }
  };

  const setFocusLock = async (minutes: number | null) => {
    if (!selected) return;
    setLockBusy(true);
    try {
      if (minutes === null) {
        await apiFetch(`/devices/${selected.id}/focus-lock`, { method: 'DELETE' });
        toast.success(t('time.lockEnded'));
      } else {
        await apiFetch(`/devices/${selected.id}/focus-lock`, { method: 'POST', body: { minutes } });
        toast.success(t('time.lockStarted'));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setLockBusy(false);
    }
  };

  if (!selected) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="40%" />
        <Skeleton height={160} />
        <Skeleton height={260} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  const today = days.find((day) => day.day === todayIso());
  const todayMinutes = today?.totalMinutes ?? 0;
  const week = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const weekMax = Math.max(60, ...week.map((day) => day.totalMinutes));
  const lock = policies?.instant_block;
  const lockActive = Boolean(lock?.active && (!lock.until || Date.parse(lock.until) > Date.now()));

  return (
    <div className="page">
      <PageHeader
        title={t('time.title')}
        subtitle={`${selected.childName} · ${t('time.subtitle')}`}
        actions={
          <Button size="sm" variant={lockActive ? 'danger' : 'secondary'} loading={lockBusy} onClick={() => void setFocusLock(lockActive ? null : 30)} icon={<Lock size={15} />}>
            {lockActive ? t('time.endLock') : t('time.focusLock')}
          </Button>
        }
      />

      <section className="screen-hero card">
        <div className="screen-hero-main">
          <span className="big-time">{duration(todayMinutes, locale)}</span>
          <span className="muted">{t('time.today')}</span>
          <div className="limit-line">
            <Progress value={limit ? (todayMinutes / limit) * 100 : 0} tone={todayMinutes > limit ? 'danger' : 'brand'} />
            <small>{duration(limit, locale)} {t('time.limit').toLowerCase()}</small>
          </div>
        </div>
        <div className="week-bars large">
          {week.map((day) => (
            <div key={day.day} className={`week-col${day.day === todayIso() ? ' today' : ''}`}>
              <span className="bar-value">{Math.round(day.totalMinutes)}</span>
              <div className="week-bar-track">
                <span style={{ height: Math.max(6, Math.round((day.totalMinutes / weekMax) * 92)) }} />
              </div>
              <small>{weekdayShort(day.day, locale)}</small>
            </div>
          ))}
        </div>
      </section>

      {lockActive ? (
        <Notice tone="danger" icon={<Lock size={18} />}>
          <strong>
            {t('time.lockActive', {
              time: lock?.until
                ? new Date(lock.until).toLocaleTimeString(locale === 'gu' ? 'gu-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })
                : '—',
            })}
          </strong>{' '}
          <button type="button" className="inline-link" onClick={() => void setFocusLock(null)}>
            {t('time.endLock')}
          </button>
        </Notice>
      ) : null}

      <div className="time-grid">
        <section className="card">
          <SectionHeader title={t('time.plan')} />
          <div className="stack">
            <label className="field">
              <span className="field-label">{t('time.limitMinutes')}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                step={15}
                value={limit}
                onChange={(event) => setLimit(Math.max(0, Math.min(1440, Number(event.target.value))))}
              />
            </label>
            <div className="chip-row">
              {[60, 120, 180, 240].map((preset) => (
                <button key={preset} type="button" className={`chip${limit === preset ? ' selected' : ''}`} onClick={() => setLimit(preset)}>
                  {duration(preset, locale)}
                </button>
              ))}
            </div>

            <div className="setting-row">
              <div>
                <strong>{t('time.downtimeEnabled')}</strong>
                <small>{t('dashboard.downtime')}</small>
              </div>
              <Toggle label={t('time.downtimeEnabled')} checked={downtime.enabled} onChange={(next) => setDowntime({ ...downtime, enabled: next })} />
            </div>

            <div className="grid-2">
              <label className="field">
                <span className="field-label">{t('time.downtimeStart')}</span>
                <input className="input" type="time" value={downtime.start} onChange={(event) => setDowntime({ ...downtime, start: event.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">{t('time.downtimeEnd')}</span>
                <input className="input" type="time" value={downtime.end} onChange={(event) => setDowntime({ ...downtime, end: event.target.value })} />
              </label>
            </div>

            <div className="field">
              <span className="field-label">{t('time.days')}</span>
              <div className="day-chips">
                {WEEKDAY_LABELS.map((label, index) => {
                  const active = downtime.days.includes(index);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`day-chip${active ? ' selected' : ''}`}
                      aria-pressed={active}
                      onClick={() =>
                        setDowntime({
                          ...downtime,
                          days: active ? downtime.days.filter((day) => day !== index) : [...downtime.days, index].sort(),
                        })
                      }
                    >
                      {label.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button block loading={planBusy} onClick={() => void savePlan()} icon={<Clock3 size={16} />}>
              {t('time.savePlan')}
            </Button>
          </div>
        </section>

        <section className="card">
          <SectionHeader title={t('time.focusLock')} />
          <div className="focus-panel">
            <span className={`focus-orb${lockActive ? ' active' : ''}`}>
              <Zap size={28} />
            </span>
            <p>{t('time.focusLockBody')}</p>
            {lockActive ? (
              <Button variant="danger" block loading={lockBusy} onClick={() => void setFocusLock(null)} icon={<Ban size={16} />}>
                {t('time.endLock')}
              </Button>
            ) : (
              <div className="chip-row">
                {[15, 30, 60].map((minutes) => (
                  <button key={minutes} type="button" className="chip" onClick={() => void setFocusLock(minutes)} disabled={lockBusy}>
                    {minutes} {t('time.minutes')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <SectionHeader
        title={t('time.manageApps')}
        action={
          <Button size="sm" variant="secondary" loading={appsBusy} onClick={() => void saveApps()}>
            {t('time.saveApps')}
          </Button>
        }
      />
      <div className="card app-manage-list">
        {apps.length ? (
          apps.map((app) => {
            const edit = appEdits[app.package] ?? { blocked: app.blocked, limitMinutes: app.limitMinutes };
            return (
              <div key={app.package} className={`app-manage-row${edit.blocked ? ' blocked' : ''}`}>
                <span className={`app-icon cat-${app.category.toLowerCase()}`}>{app.appName.slice(0, 1)}</span>
                <div className="app-manage-text">
                  <strong>{app.appName}</strong>
                  <small>
                    {app.category} · {duration(app.minutes, locale)} {t('time.usage')}
                  </small>
                </div>
                <select
                  className="select compact"
                  value={edit.limitMinutes ?? ''}
                  disabled={edit.blocked}
                  onChange={(event) =>
                    setAppEdits((prev) => ({
                      ...prev,
                      [app.package]: { ...edit, limitMinutes: event.target.value ? Number(event.target.value) : null },
                    }))
                  }
                  aria-label={`${app.appName} limit`}
                >
                  <option value="">{t('time.unlimited')}</option>
                  <option value="15">15m</option>
                  <option value="30">30m</option>
                  <option value="60">1h</option>
                  <option value="120">2h</option>
                </select>
                <label className="block-toggle">
                  <input
                    type="checkbox"
                    checked={edit.blocked}
                    onChange={(event) => setAppEdits((prev) => ({ ...prev, [app.package]: { ...edit, blocked: event.target.checked } }))}
                  />
                  <span>{t('time.block')}</span>
                </label>
              </div>
            );
          })
        ) : (
          <EmptyState icon={<AppWindow size={20} />} title={t('common.noData')} body={t('permissions.askChild')} />
        )}
      </div>

      <Notice tone="warning" icon={<Smartphone size={18} />}>
        {t('time.osNote')}
      </Notice>

      <div className="icon-legend">
        <span>
          <Timer size={14} /> {t('time.week')}
        </span>
        <span>
          <Moon size={14} /> {t('dashboard.downtime')}
        </span>
      </div>
    </div>
  );
}
