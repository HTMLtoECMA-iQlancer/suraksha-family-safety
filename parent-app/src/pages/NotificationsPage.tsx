import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import type { NotificationItem } from '@suraksha/shared';
import { apiFetch } from '../api';
import type { NotificationsResponse } from '../api';
import { useDevices } from '../devices';
import { relativeTime } from '../format';
import { useI18n } from '../i18n';
import { useRealtimeMessage } from '../realtime';
import { Button, EmptyState, PageHeader, Pill, Skeleton } from '../ui';

const SEEN_KEY = 'suraksha.notificationsSeenAt';

export function NotificationsPage() {
  const { t, locale } = useI18n();
  const { devices, select } = useDevices();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [seenAt, setSeenAt] = useState(() => Date.parse(localStorage.getItem(SEEN_KEY) ?? '0'));
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NotificationsResponse>('/notifications');
      setItems(data.notifications);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type !== 'event.new') return;
    const event = message.data.event;
    setItems((prev) => [
      {
        id: event.id,
        kind: event.kind,
        title: event.title,
        body: event.detail,
        severity: event.severity,
        deviceId: event.deviceId,
        at: event.occurredAt,
        read: false,
      },
      ...prev.filter((item) => item.id !== event.id),
    ]);
  });

  const markRead = () => {
    const now = new Date().toISOString();
    localStorage.setItem(SEEN_KEY, now);
    setSeenAt(Date.parse(now));
  };

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="40%" />
        <Skeleton height={320} />
      </div>
    );
  }

  const unread = items.filter((item) => Date.parse(item.at) > seenAt).length;

  return (
    <div className="page">
      <PageHeader
        title={t('notifications.title')}
        subtitle={`${items.length} ${t('notifications.title').toLowerCase()}${unread ? ` · ${unread} ${t('notifications.unread')}` : ''}`}
        actions={
          items.length ? (
            <Button variant="secondary" size="sm" onClick={markRead} icon={<CheckCheck size={16} />}>
              {t('notifications.markRead')}
            </Button>
          ) : undefined
        }
      />

      {items.length ? (
        <div className="notification-list card">
          {items.map((item) => {
            const device = devices.find((candidate) => candidate.id === item.deviceId);
            const isNew = Date.parse(item.at) > seenAt;
            return (
              <button
                key={item.id}
                type="button"
                className={`notification-row${isNew ? ' unread' : ''}`}
                onClick={() => {
                  if (item.deviceId) select(item.deviceId);
                }}
              >
                <span className={`notif-icon sev-${item.severity}`}>
                  <Bell size={17} />
                </span>
                <span className="notif-text">
                  <strong>{item.title}</strong>
                  <small>{item.body}</small>
                  <span className="notif-meta">
                    {device?.childName ?? 'Device'} · {device?.name ?? ''}
                  </span>
                </span>
                <span className="notif-side">
                  <Pill tone={item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'neutral'}>
                    {t(`event.severity.${item.severity}` as 'event.severity.info')}
                  </Pill>
                  <small>{relativeTime(item.at, locale)}</small>
                  {isNew ? <i className="unread-dot" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<BellOff size={22} />} title={t('notifications.empty')} body={t('event.empty')} />
      )}
    </div>
  );
}
