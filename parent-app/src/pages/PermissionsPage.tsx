import { useEffect, type CSSProperties, type ReactElement } from 'react';
import {
  Accessibility,
  BarChart3,
  BatteryCharging,
  Bell,
  Camera,
  ChevronRight,
  MapPin,
  Mic,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { PermissionState } from '@suraksha/shared';
import { useDevices } from '../devices';
import { openChildPreview } from '../childPreview';
import { dateTime } from '../format';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { Button, Notice, PageHeader, Pill, Progress, SectionHeader } from '../ui';

const ICONS: Record<string, ReactElement> = {
  camera: <Camera size={19} />,
  microphone: <Mic size={19} />,
  location: <MapPin size={19} />,
  notifications: <Bell size={19} />,
  usage_access: <BarChart3 size={19} />,
  screen_capture: <MonitorSmartphone size={19} />,
  battery_optimization: <BatteryCharging size={19} />,
  accessibility: <Accessibility size={19} />,
};

const STEPS = [
  'Open Suraksha Child on the device.',
  'Tap Permissions, then the missing permission.',
  'Allow it in the Android settings screen that opens.',
  'Come back here — the status updates within seconds.',
];

export function PermissionsPage() {
  const { t, locale } = useI18n();
  const { selected, refresh } = useDevices();

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!selected) return null;

  const permissions = selected.permissions;
  const granted = permissions.filter((permission) => permission.granted).length;
  const health = selected.permissionHealth;

  const labelFor = (permission: PermissionState) => {
    const key = `child.permission.${permission.key}` as MessageKey;
    const translated = t(key);
    return translated === key ? permission.label : translated;
  };

  const whyFor = (permission: PermissionState) => {
    const key = `child.permission.${permission.key}.why` as MessageKey;
    const translated = t(key);
    return translated === key ? permission.requiredFor : translated;
  };

  return (
    <div className="page">
      <PageHeader title={t('permissions.title')} subtitle={`${selected.childName} · ${selected.name}`} />

      <section className="permission-hero card">
        <div className="ring-visual large" style={{ '--ring-value': `${health * 3.6}deg` } as CSSProperties}>
          <span>{health}%</span>
        </div>
        <div>
          <h2>{t('permissions.health')}</h2>
          <p>
            {granted} {t('permissions.of')} {permissions.length} {t('permissions.granted')} ·{' '}
            {permissions.length - granted} {t('permissions.notGranted')}
          </p>
          <Progress value={health} tone={health >= 80 ? 'success' : health >= 50 ? 'warning' : 'danger'} />
          <small className="muted">
            {t('permissions.lastChecked')}: {selected.lastSeenAt ? dateTime(selected.lastSeenAt, locale) : '—'}
          </small>
        </div>
      </section>

      <Notice tone="brand" icon={<ShieldCheck size={18} />}>
        {t('permissions.intro')} {t('permissions.askChild')}
      </Notice>

      <SectionHeader title={t('dashboard.requiredPermissions')} />
      <div className="permission-list card">
        {permissions.map((permission) => (
          <div key={permission.key} className={`permission-row${permission.granted ? ' granted' : ''}`}>
            <span className={`permission-icon${permission.granted ? ' granted' : ''}`}>
              {ICONS[permission.key] ?? <ShieldCheck size={19} />}
            </span>
            <div className="permission-text">
              <strong>{labelFor(permission)}</strong>
              <small>{whyFor(permission)}</small>
            </div>
            <Pill tone={permission.granted ? 'success' : 'warning'}>
              {permission.granted ? t('permissions.granted') : t('permissions.notGranted')}
            </Pill>
          </div>
        ))}
        {!permissions.length ? (
          <div className="permission-empty">
            <Smartphone size={24} />
            <strong>{t('common.noData')}</strong>
            <p>{t('permissions.askChild')}</p>
          </div>
        ) : null}
      </div>

      <SectionHeader title={t('permissions.title')} />
      <div className="card steps-card">
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span className="step-num">{index + 1}</span>
              <span>{step}</span>
              <ChevronRight size={15} />
            </li>
          ))}
        </ol>
        <Notice tone="info">
          {locale === 'gu'
            ? 'Android વાલીને દૂરથી પરવાનગી આપવા દેતું નથી. બાળક સાથે બેસીને એક વાર પરવાનગી આપો; પછી ડેશબોર્ડ પોતે અપડેટ થશે.'
            : 'Android does not allow a parent to grant these permissions remotely. Grant them once with your child present; the dashboard then updates automatically.'}
        </Notice>
        {selected.online ? (
          <Button variant="soft" block onClick={() => void openChildPreview(selected.id)} icon={<Smartphone size={17} />}>
            {t('permissions.openPreview')}
          </Button>
        ) : (
          <Notice tone="warning">{t('common.deviceOffline')}</Notice>
        )}
      </div>
    </div>
  );
}
