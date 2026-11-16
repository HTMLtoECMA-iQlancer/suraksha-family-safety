import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Clock3,
  Crosshair,
  MapPin,
  Navigation,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Geofence, LocationPoint, PolicyMap } from '@suraksha/shared';
import { updatePolicy, apiFetch, ApiError } from '../api';
import type { GeofencesResponse, LocationResponse, LocationsResponse } from '../api';
import { useDevices } from '../devices';
import { dateTime, relativeTime } from '../format';
import { useI18n } from '../i18n';
import { MapView } from '../MapView';
import { useRealtimeMessage } from '../realtime';
import { useToast } from '../toast';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Notice,
  PageHeader,
  Pill,
  SectionHeader,
  Skeleton,
  Toggle,
} from '../ui';

type Hours = 6 | 24 | 72;

export function LocationPage() {
  const { t, locale } = useI18n();
  const { selected } = useDevices();
  const toast = useToast();
  const [location, setLocation] = useState<LocationPoint | null>(null);
  const [policy, setPolicy] = useState<PolicyMap['location'] | null>(null);
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [fences, setFences] = useState<Geofence[]>([]);
  const [hours, setHours] = useState<Hours>(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [fenceOpen, setFenceOpen] = useState(false);
  const [deleting, setDeleting] = useState<Geofence | null>(null);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);
  const reloadRef = useRef<number | null>(null);

  const deviceId = selected?.id ?? null;

  const load = useCallback(async () => {
    if (!deviceId) {
      setLoading(false);
      return;
    }
    try {
      const [latest, history, fenceData] = await Promise.all([
        apiFetch<LocationResponse>(`/devices/${deviceId}/location`),
        apiFetch<LocationsResponse>(`/devices/${deviceId}/locations?hours=${hours}`),
        apiFetch<GeofencesResponse>(`/devices/${deviceId}/geofences`),
      ]);
      setLocation(latest.location);
      setPolicy(latest.sharing);
      setPoints(history.points);
      setFences(fenceData.geofences);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load location data');
    } finally {
      setLoading(false);
    }
  }, [deviceId, hours]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const scheduleLoad = useCallback(() => {
    if (reloadRef.current) window.clearTimeout(reloadRef.current);
    reloadRef.current = window.setTimeout(() => void load(), 500);
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type === 'location.update' && message.data.point.deviceId === deviceId) scheduleLoad();
    if (message.type === 'geofence.alert' && message.data.geofence.deviceId === deviceId) {
      toast.show(message.data.event.title, message.data.event.severity === 'critical' ? 'error' : 'info');
      scheduleLoad();
    }
  });

  const savePolicy = async (patch: Partial<PolicyMap['location']>) => {
    if (!deviceId || !policy) return;
    setPolicyBusy(true);
    const next = { ...policy, ...patch };
    setPolicy(next);
    try {
      await updatePolicy(deviceId, 'location', next);
      toast.success(t('common.done'));
    } catch (err) {
      setPolicy(policy);
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setPolicyBusy(false);
    }
  };

  const toggleFence = async (fence: Geofence) => {
    setToggleBusy(fence.id);
    try {
      const result = await apiFetch<{ geofence: Geofence }>(`/geofences/${fence.id}`, {
        method: 'PATCH',
        body: { enabled: !fence.enabled },
      });
      setFences((prev) => prev.map((item) => (item.id === fence.id ? result.geofence : item)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setToggleBusy(null);
    }
  };

  const deleteFence = async () => {
    if (!deleting) return;
    try {
      await apiFetch(`/geofences/${deleting.id}`, { method: 'DELETE' });
      setFences((prev) => prev.filter((item) => item.id !== deleting.id));
      toast.success(t('common.done'));
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    }
  };

  if (!selected) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="40%" />
        <Skeleton height={280} />
        <Skeleton height={140} />
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

  const mapCenter = location ? { lat: location.lat, lng: location.lng } : null;
  const mapPoints = points.map((point) => ({ lat: point.lat, lng: point.lng, accuracy: point.accuracy }));

  return (
    <div className="page">
      <PageHeader
        title={t('location.title')}
        subtitle={`${selected.childName} · ${t('location.subtitle')}`}
        actions={
          <Pill tone={policy?.sharingEnabled ? 'success' : 'neutral'}>
            <ShieldCheck size={13} /> {policy?.sharingEnabled ? t('location.sharingOn') : t('location.sharingOff')}
          </Pill>
        }
      />

      <section className="map-card card">
        {location ? (
          <MapView center={mapCenter} points={mapPoints} geofences={fences.filter((fence) => fence.enabled)} height={340} />
        ) : (
          <div className="map-empty">
            <MapPin size={30} />
            <strong>{t('location.noLocation')}</strong>
            <p>{t('permissions.askChild')}</p>
          </div>
        )}
        {location ? (
          <div className="map-overlay">
            <div className="map-latest">
              <span className="map-latest-icon">
                <Navigation size={16} />
              </span>
              <div>
                <strong>
                  {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                </strong>
                <small>
                  {t('location.accuracy')} ±{Math.round(location.accuracy)}m · {relativeTime(location.recordedAt, locale)}
                </small>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                window.open(`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`, '_blank', 'noopener');
              }}
              icon={<Crosshair size={15} />}
            >
              Open map
            </Button>
          </div>
        ) : null}
      </section>

      <div className="location-grid">
        <section className="card">
          <SectionHeader
            title={t('location.history')}
            action={
              <div className="seg small">
                {([6, 24, 72] as Hours[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={hours === option ? 'active' : ''}
                    onClick={() => setHours(option)}
                  >
                    {option}h
                  </button>
                ))}
              </div>
            }
          />
          <div className="timeline">
            {points.length ? (
              [...points].reverse().slice(0, 12).map((point, index) => (
                <div key={`${point.recordedAt}-${index}`} className="timeline-row">
                  <span className={`timeline-dot${index === 0 ? ' latest' : ''}`} />
                  <div>
                    <strong>
                      {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                    </strong>
                    <small>
                      {dateTime(point.recordedAt, locale)} · ±{Math.round(point.accuracy)}m
                      {point.speed !== null ? ` · ${Math.round(point.speed * 3.6)} km/h` : ''}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState icon={<Clock3 size={20} />} title={t('location.noHistory')} />
            )}
          </div>
        </section>

        <section className="card">
          <SectionHeader title={t('dashboard.locationSafety')} />
          <div className="setting-list">
            <SettingRow
              title={t('dashboard.sharing')}
              body={policy?.sharingEnabled ? t('location.sharingOn') : t('location.sharingOff')}
            >
              <Toggle
                label={t('dashboard.sharing')}
                checked={Boolean(policy?.sharingEnabled)}
                disabled={policyBusy}
                onChange={(next) => void savePolicy({ sharingEnabled: next })}
              />
            </SettingRow>
            <SettingRow title={t('location.history')} body={`${t('location.retention')} ${policy?.retentionDays ?? 30} ${t('location.days')}`}>
              <Toggle
                label={t('location.history')}
                checked={Boolean(policy?.historyEnabled)}
                disabled={policyBusy}
                onChange={(next) => void savePolicy({ historyEnabled: next })}
              />
            </SettingRow>
            <SettingRow title={t('dashboard.drivingAlerts')} body="Speeding and unsafe driving alerts">
              <Toggle
                label={t('dashboard.drivingAlerts')}
                checked={Boolean(policy?.drivingAlerts)}
                disabled={policyBusy}
                onChange={(next) => void savePolicy({ drivingAlerts: next })}
              />
            </SettingRow>
            <SettingRow title={t('dashboard.sos')} body="Child can send an urgent alert with their location">
              <Toggle
                label={t('dashboard.sos')}
                checked={Boolean(policy?.sosEnabled)}
                disabled={policyBusy}
                onChange={(next) => void savePolicy({ sosEnabled: next })}
              />
            </SettingRow>
          </div>
          <Notice tone="info" icon={<ShieldAlert size={17} />}>
            {locale === 'gu'
              ? 'સ્થાન ફક્ત બાળકની એપ શેર કરે ત્યારે જ દેખાય છે. બાળક ક્યારેય પણ શેરિંગ બંધ કરી શકે છે.'
              : 'Location appears only while the child app shares it. Your child can turn sharing off at any time and always sees when it is on.'}
          </Notice>
        </section>
      </div>

      <SectionHeader
        title={t('location.geofences')}
        action={
          <Button variant="secondary" size="sm" onClick={() => setFenceOpen(true)} icon={<Plus size={15} />}>
            {t('location.addGeofence')}
          </Button>
        }
      />
      <div className="fence-list card">
        {fences.length ? (
          fences.map((fence) => (
            <div key={fence.id} className="fence-row">
              <span className="fence-icon">
                <MapPin size={18} />
              </span>
              <div className="fence-text">
                <strong>{fence.name}</strong>
                <small>
                  {fence.radiusM}m ·{' '}
                  {[fence.notifyOnEnter ? (locale === 'gu' ? 'આવે' : 'arrival') : null, fence.notifyOnExit ? (locale === 'gu' ? 'નીકળે' : 'leave') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              <Toggle
                label={`${fence.name} enabled`}
                checked={fence.enabled}
                disabled={toggleBusy === fence.id}
                onChange={() => void toggleFence(fence)}
              />
              <button type="button" className="icon-btn danger" aria-label={t('common.delete')} onClick={() => setDeleting(fence)}>
                <Trash2 size={16} />
              </button>
            </div>
          ))
        ) : (
          <EmptyState title={t('location.addGeofence')} body="Get an alert when your child arrives at school or home." />
        )}
      </div>

      <AddGeofenceModal
        open={fenceOpen}
        onClose={() => setFenceOpen(false)}
        deviceId={selected.id}
        defaultLat={location?.lat ?? 23.0301}
        defaultLng={location?.lng ?? 72.58}
        onCreated={(fence) => {
          setFences((prev) => [...prev, fence]);
          setFenceOpen(false);
          toast.success(`${fence.name} added`);
        }}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('common.delete')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void deleteFence()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('location.deleteConfirm')}</p>
        <p className="muted">{deleting?.name}</p>
      </Modal>
    </div>
  );
}

function SettingRow({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <small>{body}</small>
      </div>
      {children}
    </div>
  );
}

function AddGeofenceModal({
  open,
  onClose,
  deviceId,
  defaultLat,
  defaultLng,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  deviceId: string;
  defaultLat: number;
  defaultLng: number;
  onCreated: (fence: Geofence) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('School');
  const [lat, setLat] = useState(String(defaultLat));
  const [lng, setLng] = useState(String(defaultLng));
  const [radius, setRadius] = useState(200);
  const [enter, setEnter] = useState(true);
  const [exit, setExit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLat(defaultLat.toFixed(5));
      setLng(defaultLng.toFixed(5));
      setError(null);
    }
  }, [open, defaultLat, defaultLng]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ geofence: Geofence }>(`/devices/${deviceId}/geofences`, {
        method: 'POST',
        body: {
          name: name.trim(),
          lat: Number(lat),
          lng: Number(lng),
          radiusM: radius,
          notifyOnEnter: enter,
          notifyOnExit: exit,
          enabled: true,
        },
      });
      onCreated(result.geofence);
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
      title={t('location.addGeofence')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={name.trim().length < 2 || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('location.geofenceName')}>
          <input className="input" value={name} maxLength={50} onChange={(event) => setName(event.target.value)} placeholder="School" />
        </Field>
        <div className="grid-2">
          <Field label="Latitude">
            <input className="input" value={lat} onChange={(event) => setLat(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Longitude">
            <input className="input" value={lng} onChange={(event) => setLng(event.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <Field label={`${t('location.radius')}: ${radius}m`}>
          <input
            type="range"
            min={50}
            max={1000}
            step={25}
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value))}
            className="range"
          />
        </Field>
        <div className="setting-row">
          <div>
            <strong>{t('location.notifyEnter')}</strong>
          </div>
          <Toggle label={t('location.notifyEnter')} checked={enter} onChange={setEnter} />
        </div>
        <div className="setting-row">
          <div>
            <strong>{t('location.notifyExit')}</strong>
          </div>
          <Toggle label={t('location.notifyExit')} checked={exit} onChange={setExit} />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
