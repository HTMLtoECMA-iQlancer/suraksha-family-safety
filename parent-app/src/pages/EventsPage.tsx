import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  BellRing,
  Camera,
  CircleAlert,
  MapPin,
  ShieldAlert,
  Siren,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import type { EventSeverity, SafetyEvent } from '@suraksha/shared';
import { apiFetch, ApiError } from '../api';
import type { EventsResponse } from '../api';
import { useDevices } from '../devices';
import { dateTime, relativeTime } from '../format';
import { useI18n } from '../i18n';
import { useRealtimeMessage } from '../realtime';
import {
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pill,
  Skeleton,
} from '../ui';

type Filter = 'all' | EventSeverity;

export function EventsPage() {
  const { t, locale } = useI18n();
  const { selected } = useDevices();
  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SafetyEvent | null>(null);

  const load = useCallback(async () => {
    if (!selected) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<EventsResponse>(`/devices/${selected.id}/events?limit=100`);
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load events');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type === 'event.new' && message.data.event.deviceId === selected?.id) {
      setEvents((prev) => [message.data.event, ...prev.filter((event) => event.id !== message.data.event.id)]);
    }
  });

  if (!selected) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="35%" />
        <Skeleton height={80} />
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

  const filtered = filter === 'all' ? events : events.filter((event) => event.severity === filter);
  const groups = new Map<string, SafetyEvent[]>();
  for (const event of filtered) {
    const key = new Date(event.occurredAt).toDateString();
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return (
    <div className="page">
      <PageHeader title={t('event.title')} subtitle={`${selected.childName} · ${selected.name}`} />

      <div className="seg filter-seg">
        {(['all', 'info', 'warning', 'critical'] as Filter[]).map((option) => (
          <button key={option} type="button" className={filter === option ? 'active' : ''} onClick={() => setFilter(option)}>
            {option === 'all' ? t('common.all') : t(`event.severity.${option}` as 'event.severity.info')}
            <span className="seg-count">{option === 'all' ? events.length : events.filter((event) => event.severity === option).length}</span>
          </button>
        ))}
      </div>

      {groups.size ? (
        [...groups.entries()].map(([day, items]) => (
          <section key={day} className="event-group">
            <h2 className="event-day">
              {day === new Date().toDateString()
                ? t('common.today')
                : day === new Date(Date.now() - 86_400_000).toDateString()
                  ? t('common.yesterday')
                  : new Date(day).toLocaleDateString(locale === 'gu' ? 'gu-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
            <div className="timeline-card card">
              {items.map((event) => (
                <button key={event.id} type="button" className="event-item" onClick={() => setDetail(event)}>
                  <span className={`event-kind sev-${event.severity}`}>{kindIcon(event.kind)}</span>
                  <span className="event-item-text">
                    <strong>{event.title}</strong>
                    <small>{event.detail}</small>
                  </span>
                  <span className="event-item-meta">
                    <Pill tone={event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : 'neutral'}>
                      {t(`event.severity.${event.severity}` as 'event.severity.info')}
                    </Pill>
                    <small>{relativeTime(event.occurredAt, locale)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState icon={<BellRing size={22} />} title={t('event.empty')} />
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={t('event.detail')} size="sm">
        {detail ? (
          <div className="stack event-detail">
            <span className={`event-kind big sev-${detail.severity}`}>{kindIcon(detail.kind)}</span>
            <h3>{detail.title}</h3>
            <p>{detail.detail}</p>
            <dl className="detail-list">
              <div>
                <dt>{t('event.when')}</dt>
                <dd>{dateTime(detail.occurredAt, locale)}</dd>
              </div>
              <div>
                <dt>{t('event.device')}</dt>
                <dd>{selected.name}</dd>
              </div>
              <div>
                <dt>{t('event.severity')}</dt>
                <dd>{t(`event.severity.${detail.severity}` as 'event.severity.info')}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{detail.kind}</dd>
              </div>
            </dl>
            <p className="audit-note">{t('session.historyNote')}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function kindIcon(kind: SafetyEvent['kind']) {
  const map: Partial<Record<SafetyEvent['kind'], ReactElement>> = {
    'session.requested': <Camera size={18} />,
    'session.approved': <ShieldAlert size={18} />,
    'session.denied': <CircleAlert size={18} />,
    'session.started': <Camera size={18} />,
    'session.ended': <Camera size={18} />,
    'device.offline': <WifiOff size={18} />,
    'device.online': <WifiOff size={18} />,
    'geofence.enter': <MapPin size={18} />,
    'geofence.exit': <MapPin size={18} />,
    'sos.triggered': <Siren size={18} />,
    'driving.speed': <TriangleAlert size={18} />,
    'content.alert': <ShieldAlert size={18} />,
  };
  return map[kind] ?? <BellRing size={17} />;
}
