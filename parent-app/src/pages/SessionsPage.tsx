import { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Clock3,
  Mic,
  Monitor,
  PhoneOff,
  Plus,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { SessionRequest } from '@suraksha/shared';
import { apiFetch, ApiError } from '../api';
import type { AuditResponse, SessionsResponse } from '../api';
import { useDevices } from '../devices';
import { dateTime, duration } from '../format';
import { useI18n } from '../i18n';
import { useRealtimeMessage } from '../realtime';
import { useAppActions } from '../Shell';
import { useToast } from '../toast';
import {
  Button,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pill,
  SectionHeader,
  Skeleton,
} from '../ui';

const KIND_ICON = { camera: Camera, audio: Mic, screen: Monitor } as const;

export function SessionsPage() {
  const { t, locale } = useI18n();
  const { selected } = useDevices();
  const { openSession } = useAppActions();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionRequest[]>([]);
  const [audit, setAudit] = useState<AuditResponse['audit']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selected) {
      setLoading(false);
      return;
    }
    try {
      const [sessionData, auditData] = await Promise.all([
        apiFetch<SessionsResponse>(`/devices/${selected.id}/sessions`),
        apiFetch<AuditResponse>(`/devices/${selected.id}/audit`).catch(() => ({ audit: [] })),
      ]);
      setSessions(sessionData.sessions);
      setAudit(auditData.audit.filter((entry) => entry.sessionId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type !== 'session.update' || message.data.session.deviceId !== selected?.id) return;
    setSessions((prev) => {
      const exists = prev.some((session) => session.id === message.data.session.id);
      return exists
        ? prev.map((session) => (session.id === message.data.session.id ? message.data.session : session))
        : [message.data.session, ...prev];
    });
  });

  const cancel = async (session: SessionRequest) => {
    setBusy(session.id);
    try {
      await apiFetch(`/sessions/${session.id}/cancel`, { method: 'POST' });
      toast.success(t('session.cancelled'));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const end = async (session: SessionRequest) => {
    setBusy(session.id);
    try {
      await apiFetch(`/sessions/${session.id}/end`, { method: 'POST', body: { reason: 'Stopped by parent' } });
      toast.success(t('session.ended'));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  if (!selected) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="40%" />
        <Skeleton height={300} />
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

  const statusLabel = (status: SessionRequest['status']) => {
    if (status === 'pending') return t('common.pending');
    if (status === 'approved') return t('session.connecting');
    if (status === 'active') return t('common.active');
    if (status === 'ended') return t('common.ended');
    if (status === 'denied') return t('common.denied');
    if (status === 'expired') return t('session.expired');
    return t('session.cancelled');
  };

  const statusTone = (status: SessionRequest['status']) =>
    status === 'active'
      ? 'success'
      : status === 'pending'
        ? 'warning'
        : status === 'denied'
          ? 'danger'
          : status === 'approved'
            ? 'info'
            : 'neutral';

  const kindLabel = (kind: SessionRequest['kind']) =>
    locale === 'gu'
      ? { camera: 'કેમેરા', audio: 'ઓડિયો', screen: 'સ્ક્રીન' }[kind]
      : { camera: 'Camera', audio: 'Live audio', screen: 'Screen sharing' }[kind];

  const openCount = sessions.filter((session) => ['pending', 'approved', 'active'].includes(session.status)).length;

  return (
    <div className="page">
      <PageHeader
        title={t('session.title')}
        subtitle={`${selected.childName} · ${openCount ? `${openCount} ${t('dashboard.openSessions').toLowerCase()}` : t('session.historyNote')}`}
        actions={
          <Button size="sm" onClick={() => openSession('camera')} icon={<Plus size={15} />}>
            {t('session.requestTitle')}
          </Button>
        }
      />

      <div className="session-list">
        {sessions.length ? (
          sessions.map((session) => {
            const Icon = KIND_ICON[session.kind];
            const open = ['pending', 'approved', 'active'].includes(session.status);
            return (
              <article key={session.id} className={`session-card card${open ? ' open' : ''}`}>
                <span className={`session-kind kind-${session.kind}`}>
                  <Icon size={20} />
                </span>
                <div className="session-body">
                  <div className="row-between">
                    <strong>{kindLabel(session.kind)}</strong>
                    <Pill tone={statusTone(session.status)}>{statusLabel(session.status)}</Pill>
                  </div>
                  <p>{session.reason}</p>
                  <small>
                    {session.parentName} · {dateTime(session.createdAt, locale)}
                    {session.endedBy ? ` · ended by ${session.endedBy}` : ''}
                  </small>
                  {session.startedAt && session.endedAt ? (
                    <small>
                      <Clock3 size={12} />{' '}
                      {duration(Math.max(1, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000)), locale)}
                    </small>
                  ) : null}
                </div>
                <div className="session-actions">
                  {session.status === 'pending' ? (
                    <Button variant="secondary" size="sm" loading={busy === session.id} onClick={() => void cancel(session)}>
                      <XCircle size={14} /> {t('session.cancelRequest')}
                    </Button>
                  ) : null}
                  {session.status === 'active' || session.status === 'approved' ? (
                    <Button variant="danger" size="sm" loading={busy === session.id} onClick={() => void end(session)}>
                      <PhoneOff size={14} /> {t('session.end')}
                    </Button>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => setDetail(session)}>
                      {t('event.detail')} <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState icon={<ShieldCheck size={22} />} title={t('common.noData')} body={t('session.historyNote')} />
        )}
      </div>

      <SectionHeader title={locale === 'gu' ? 'એક્સેસ લોગ' : 'Access log'} />
      <div className="audit-list card">
        {audit.slice(0, 12).map((entry) => (
          <div key={entry.id} className="audit-row">
            <span className={`audit-dot role-${entry.actorType}`} />
            <div>
              <strong>{entry.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
              <small>
                {entry.actorType} · {dateTime(entry.createdAt, locale)}
              </small>
            </div>
          </div>
        ))}
        {!audit.length ? <EmptyState title={t('common.noData')} /> : null}
        <p className="audit-note">{t('session.historyNote')}</p>
      </div>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={t('session.title')} size="sm">
        {detail ? (
          <div className="stack">
            <div className="row-between">
              <strong>{kindLabel(detail.kind)}</strong>
              <Pill tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Pill>
            </div>
            <p>{detail.reason}</p>
            <dl className="detail-list">
              <div>
                <dt>Requested</dt>
                <dd>{dateTime(detail.createdAt, locale)}</dd>
              </div>
              <div>
                <dt>Responded</dt>
                <dd>{detail.respondedAt ? dateTime(detail.respondedAt, locale) : '—'}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{detail.startedAt ? dateTime(detail.startedAt, locale) : '—'}</dd>
              </div>
              <div>
                <dt>Ended</dt>
                <dd>{detail.endedAt ? dateTime(detail.endedAt, locale) : '—'}</dd>
              </div>
              <div>
                <dt>Requested by</dt>
                <dd>{detail.parentName}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
