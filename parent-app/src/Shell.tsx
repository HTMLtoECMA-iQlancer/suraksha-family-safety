import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BatteryMedium,
  Bell,
  ChevronDown,
  CircleUserRound,
  LayoutDashboard,
  MapPin,
  Plus,
  ShieldCheck,
  Smartphone,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { SessionKind } from '@suraksha/shared';
import { apiFetch } from './api';
import type { NotificationsResponse } from './api';
import { useAuth } from './auth';
import { openChildPreview } from './childPreview';
import { useDevices } from './devices';
import { useI18n } from './i18n';
import { useRealtime, useRealtimeMessage } from './realtime';
import { PairingDialog } from './PairingDialog';
import { SessionDialog } from './SessionDialog';
import { useToast } from './toast';
import { Avatar } from './ui';

interface AppActions {
  openPairing: () => void;
  openSession: (kind?: SessionKind) => void;
}

const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error('useAppActions must be used inside AppShell');
  return ctx;
}

const NAV = [
  { to: '/', labelKey: 'nav.device', icon: LayoutDashboard },
  { to: '/location', labelKey: 'nav.location', icon: MapPin },
  { to: '/family', labelKey: 'nav.family', icon: Users },
  { to: '/settings', labelKey: 'nav.my', icon: CircleUserRound },
] as const;

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <>
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <Icon size={21} strokeWidth={2.1} />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        );
      })}
    </>
  );
}

export function AppShell() {
  const { t, locale, setLocale } = useI18n();
  const { user, family, logout } = useAuth();
  const { selected, devices, select } = useDevices();
  const { connected } = useRealtime();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [pairingOpen, setPairingOpen] = useState(false);
  const [sessionKind, setSessionKind] = useState<SessionKind | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  const seenKey = 'suraksha.notificationsSeenAt';

  useEffect(() => {
    void apiFetch<NotificationsResponse>('/notifications', {
      method: 'GET',
    })
      .then(({ notifications }) => {
        const seen = Date.parse(localStorage.getItem(seenKey) ?? '0');
        const count = notifications.filter((item) => Date.parse(item.at) > seen).length;
        setUnread(count);
      })
      .catch(() => undefined);
  }, [location.pathname]);

  useRealtimeMessage((message) => {
    if (message.type === 'event.new') setUnread((count) => Math.min(count + 1, 99));
  });

  useEffect(() => {
    if (!switcherOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) setSwitcherOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [switcherOpen]);

  const actions = useMemo<AppActions>(
    () => ({
      openPairing: () => setPairingOpen(true),
      openSession: (kind: SessionKind = 'camera') => {
        setSessionKind(kind);
        setSessionOpen(true);
      },
    }),
    [],
  );

  const openNotifications = () => {
    localStorage.setItem(seenKey, new Date().toISOString());
    setUnread(0);
    navigate('/notifications');
  };

  const signOut = async () => {
    await logout();
    toast.show('Signed out');
    navigate('/login', { replace: true });
  };

  return (
    <AppActionsContext.Provider value={actions}>
      <div className="app-shell">
        <aside className="side-rail">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <ShieldCheck size={22} />
            </span>
            <span className="brand-word">Suraksha</span>
          </Link>

          <div className="rail-device">
            {selected ? (
              <>
                <Avatar name={selected.childName} size={44} />
                <div>
                  <strong>{selected.childName}</strong>
                  <span>
                    <i className={`dot ${selected.online ? 'online' : ''}`} /> {selected.name}
                  </span>
                </div>
              </>
            ) : (
              <button type="button" className="rail-add" onClick={() => setPairingOpen(true)}>
                <Plus size={16} /> {t('dashboard.addDevice')}
              </button>
            )}
          </div>

          <nav className="side-nav" aria-label="Primary">
            <NavItems />
          </nav>

          <div className="rail-foot">
            <div className={`conn-pill${connected ? ' on' : ''}`}>
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connected ? 'Live' : 'Reconnecting'}
            </div>
            <button type="button" className="rail-profile" onClick={() => navigate('/settings')}>
              <Avatar name={user?.displayName ?? 'Suraksha'} size={34} />
              <span>
                <strong>{user?.displayName}</strong>
                <small>{family?.name}</small>
              </span>
            </button>
            <button type="button" className="rail-signout" onClick={() => void signOut()}>
              {t('settings.signOut')}
            </button>
          </div>
        </aside>

        <div className="app-main">
          <header className="app-header">
            <div className="header-inner">
              <Link to="/" className="brand mobile-brand">
                <span className="brand-mark">
                  <ShieldCheck size={20} />
                </span>
              </Link>

              <div className="device-switch" ref={switcherRef}>
                {selected ? (
                  <button
                    type="button"
                    className="device-chip"
                    aria-haspopup="listbox"
                    aria-expanded={switcherOpen}
                    onClick={() => setSwitcherOpen((open) => !open)}
                  >
                    <Avatar name={selected.childName} size={32} />
                    <span className="device-chip-text">
                      <strong>{selected.childName}</strong>
                      <small>
                        <i className={`dot ${selected.online ? 'online' : ''}`} />
                        {selected.online ? t('common.online') : t('common.offline')}
                      </small>
                    </span>
                    <ChevronDown size={16} className={switcherOpen ? 'flip' : ''} />
                  </button>
                ) : (
                  <button type="button" className="device-chip empty" onClick={() => setPairingOpen(true)}>
                    <Smartphone size={18} />
                    <span>{t('dashboard.addDevice')}</span>
                    <Plus size={16} />
                  </button>
                )}

                {switcherOpen ? (
                  <div className="popover device-popover" role="listbox">
                    <div className="popover-head">
                      <strong>{t('dashboard.switchDevice')}</strong>
                      <span>{devices.length} linked</span>
                    </div>
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        type="button"
                        role="option"
                        aria-selected={device.id === selected?.id}
                        className={`device-option${device.id === selected?.id ? ' selected' : ''}`}
                        onClick={() => {
                          select(device.id);
                          setSwitcherOpen(false);
                        }}
                      >
                        <Avatar name={device.childName} size={34} />
                        <span className="device-option-text">
                          <strong>{device.childName}</strong>
                          <small>
                            {device.model} · {device.online ? t('common.online') : t('common.offline')}
                          </small>
                        </span>
                        <span className="device-option-meta">
                          {device.battery !== null ? (
                            <small>
                              <BatteryMedium size={13} /> {device.battery}%
                            </small>
                          ) : null}
                        </span>
                      </button>
                    ))}
                    <div className="popover-divider" />
                    <button type="button" className="popover-action" onClick={() => { setSwitcherOpen(false); setPairingOpen(true); }}>
                      <Plus size={16} /> {t('dashboard.addDevice')}
                    </button>
                    {selected ? (
                      <button
                        type="button"
                        className="popover-action"
                        onClick={() => {
                          setSwitcherOpen(false);
                          void openChildPreview(selected.id);
                        }}
                      >
                        <Smartphone size={16} /> {t('dashboard.openChildPreview')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="header-actions">
                <button
                  type="button"
                  className="lang-toggle"
                  onClick={() => setLocale(locale === 'en' ? 'gu' : 'en')}
                  aria-label="Switch language"
                >
                  {locale === 'en' ? 'ગુજરાતી' : 'English'}
                </button>
                <button type="button" className="icon-btn bell-btn" aria-label={t('dashboard.notifications')} onClick={openNotifications}>
                  <Bell size={20} />
                  {unread > 0 ? <span className="bell-badge">{unread > 9 ? '9+' : unread}</span> : null}
                </button>
                <button type="button" className="header-avatar" onClick={() => navigate('/settings')} aria-label={t('settings.title')}>
                  <Avatar name={user?.displayName ?? 'Suraksha'} size={34} />
                </button>
              </div>
            </div>
            {!connected ? (
              <div className="offline-strip">
                <WifiOff size={13} /> Reconnecting to live updates — data may be a few seconds behind.
              </div>
            ) : null}
          </header>

          <main className="app-content">
            <Outlet />
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Primary">
          <NavItems />
        </nav>

        <PairingDialog open={pairingOpen} onClose={() => setPairingOpen(false)} />
        <SessionDialog
          open={sessionOpen && Boolean(selected)}
          device={selected}
          initialKind={sessionKind}
          onClose={() => {
            setSessionOpen(false);
            setSessionKind(null);
          }}
        />
      </div>
    </AppActionsContext.Provider>
  );
}
