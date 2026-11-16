import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  ImageOff,
  MessageSquareWarning,
  PhoneOff,
  ScanEye,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { PolicyMap, SafetyEvent } from '@suraksha/shared';
import { apiFetch, ApiError, updatePolicy } from '../api';
import type { EventsResponse, PoliciesResponse } from '../api';
import { useDevices } from '../devices';
import { relativeTime } from '../format';
import { useI18n } from '../i18n';
import { useToast } from '../toast';
import {
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Pill,
  SectionHeader,
  Skeleton,
  Toggle,
} from '../ui';

export function ContentSafetyPage() {
  const { t, locale } = useI18n();
  const { selected } = useDevices();
  const toast = useToast();
  const [policies, setPolicies] = useState<PolicyMap | null>(null);
  const [alerts, setAlerts] = useState<SafetyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selected) {
      setLoading(false);
      return;
    }
    try {
      const [policyData, eventData] = await Promise.all([
        apiFetch<PoliciesResponse>(`/devices/${selected.id}/policies`),
        apiFetch<EventsResponse>(`/devices/${selected.id}/events?limit=100`),
      ]);
      setPolicies(policyData.policies);
      setAlerts(eventData.events.filter((event) => event.kind === 'content.alert' || event.kind === 'browsing.blocked'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load content safety');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const save = async <K extends 'notifications' | 'supervision'>(kind: K, next: PolicyMap[K]) => {
    if (!selected || !policies) return;
    setPolicies({ ...policies, [kind]: next } as PolicyMap);
    setBusy(true);
    try {
      const updated = await updatePolicy(selected.id, kind, next);
      setPolicies(updated);
      toast.success(t('common.done'));
    } catch (err) {
      await load();
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!selected) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="40%" />
        <Skeleton height={240} />
      </div>
    );
  }

  if (error || !policies) {
    return (
      <div className="page">
        <ErrorState message={error ?? 'Could not load content safety'} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={t('safety.title')} subtitle={`${selected.childName} · ${t('safety.subtitle')}`} />

      <Notice tone="brand" icon={<ShieldCheck size={18} />}>
        {t('safety.intro')}
      </Notice>

      <SectionHeader title={t('safety.alerts')} />
      <div className="card">
        <div className="setting-list">
          <div className="setting-row">
            <div>
              <strong>{t('settings.safetyAlerts')}</strong>
              <small>Content, browsing and geofence alerts on the dashboard</small>
            </div>
            <Toggle
              label={t('settings.safetyAlerts')}
              checked={policies.notifications.safetyAlerts}
              disabled={busy}
              onChange={(next) => void save('notifications', { ...policies.notifications, safetyAlerts: next })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('settings.sessionRequests')}</strong>
              <small>Session approvals, denials and stop events</small>
            </div>
            <Toggle
              label={t('settings.sessionRequests')}
              checked={policies.notifications.sessionRequests}
              disabled={busy}
              onChange={(next) => void save('notifications', { ...policies.notifications, sessionRequests: next })}
            />
          </div>
        </div>
      </div>

      <div className="safety-cards">
        <article className="safety-card card">
          <span className="safety-icon violet">
            <MessageSquareWarning size={22} />
          </span>
          <h3>{t('safety.social')}</h3>
          <p>{t('safety.intro')}</p>
          <Pill tone="warning">{locale === 'gu' ? 'ક્લાસિફાયર જરૂરી' : 'Classifier required'}</Pill>
          <small>{t('help.limitsBody')}</small>
        </article>
        <article className="safety-card card">
          <span className="safety-icon rose">
            <ImageOff size={22} />
          </span>
          <h3>{t('safety.images')}</h3>
          <p>{t('safety.imageNote')}</p>
          <Pill tone="neutral">{locale === 'gu' ? 'ગોઠવેલું નથી' : 'Not configured'}</Pill>
          <small>On-device classifier required</small>
        </article>
        <article className="safety-card card">
          <span className="safety-icon slate">
            <PhoneOff size={22} />
          </span>
          <h3>{t('safety.calls')}</h3>
          <p>{t('safety.callsNote')}</p>
          <Pill tone="neutral">{t('common.osLimited')}</Pill>
          <small>Default-handler + policy review required</small>
        </article>
      </div>

      <SectionHeader title={t('dashboard.supervision')} />
      <div className="card">
        <div className="setting-list">
          <div className="setting-row">
            <div>
              <strong>Require approval for every session</strong>
              <small>Recommended. Suraksha never starts camera, microphone or screen capture silently.</small>
            </div>
            <Toggle
              label="Require approval"
              checked={policies.supervision.requireApprovalAlways}
              disabled={busy}
              onChange={(next) => void save('supervision', { ...policies.supervision, requireApprovalAlways: next })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Child can stop sessions</strong>
              <small>Platform requirement and core privacy promise.</small>
            </div>
            <Toggle
              label="Child can stop sessions"
              checked={policies.supervision.childCanStopSessions}
              disabled={busy}
              onChange={(next) => void save('supervision', { ...policies.supervision, childCanStopSessions: next })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Share session history with the child</strong>
              <small>The child sees every session request and who asked.</small>
            </div>
            <Toggle
              label="Share session history"
              checked={policies.supervision.shareSessionHistoryWithChild}
              disabled={busy}
              onChange={(next) => void save('supervision', { ...policies.supervision, shareSessionHistoryWithChild: next })}
            />
          </div>
        </div>
        <Notice tone="warning" icon={<TriangleAlert size={18} />}>
          Turning off mandatory approval would violate the product’s privacy boundary. The Android client always requires the child to approve.
        </Notice>
      </div>

      <SectionHeader title={t('safety.alertFeed')} />
      <div className="card">
        {alerts.length ? (
          <div className="alert-feed">
            {alerts.map((alert) => (
              <div key={alert.id} className="alert-row">
                <span className={`severity-dot sev-${alert.severity}`} />
                <div>
                  <strong>{alert.title}</strong>
                  <small>{alert.detail}</small>
                </div>
                <span className="muted">{relativeTime(alert.occurredAt, locale)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<ScanEye size={22} />} title={locale === 'gu' ? 'હજુ કન્ટેન્ટ ચેતવણી નથી' : 'No content alerts yet'} body={t('safety.imageNote')} />
        )}
      </div>

      <Link to="/safe-browsing" className="card link-card">
        <span className="manage-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <strong>{t('dashboard.safeBrowsing')}</strong>
          <small>{t('browsing.subtitle')}</small>
        </div>
        <ChevronRight size={17} />
      </Link>
    </div>
  );
}
