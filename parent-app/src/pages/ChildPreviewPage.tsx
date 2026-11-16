import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  BatteryMedium,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  History,
  Inbox,
  Languages,
  Lock,
  MapPin,
  Mic,
  Monitor,
  Moon,
  PhoneOff,
  Play,
  RefreshCw,
  ShieldCheck,
  Siren,
  Smartphone,
  Sun,
  Unlink,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AuthTokens,
  Device,
  PermissionState,
  PolicyMap,
  SessionKind,
  SessionRequest,
  UserRole,
  WsClientMessage,
  WsServerMessage,
} from '@suraksha/shared';
import { ApiError, wsUrl } from '../api';
import type { ConfigResponse } from '../api';
import { clockTime, dateTime, relativeTime, titleCase } from '../format';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { useTheme } from '../theme';
import { useToast } from '../toast';
import { Avatar, Button, Notice, Pill, Spinner, Toggle } from '../ui';

const CHILD_TOKENS_KEY = 'suraksha.childTokens';
const DEMO_HOME = { lat: 23.0301, lng: 72.58 };
const DEMO_SCHOOL_EXIT = { lat: 23.0425, lng: 72.5485 };

const KIND_ICONS: Record<SessionKind, typeof Camera> = {
  camera: Camera,
  audio: Mic,
  screen: Monitor,
};

const PERMISSION_COPY = {
  camera: ['child.permission.camera', 'child.permission.camera.why'],
  microphone: ['child.permission.microphone', 'child.permission.microphone.why'],
  location: ['child.permission.location', 'child.permission.location.why'],
  notifications: ['child.permission.notifications', 'child.permission.notifications.why'],
  usage_access: ['child.permission.usage_access', 'child.permission.usage_access.why'],
  screen_capture: ['child.permission.screen_capture', 'child.permission.screen_capture.why'],
  battery_optimization: ['child.permission.battery_optimization', 'child.permission.battery_optimization.why'],
  accessibility: ['child.permission.accessibility', 'child.permission.accessibility.why'],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;

interface ChildMe {
  device: Device;
  family: { id: string; name: string };
  policies: PolicyMap;
  sessions: SessionRequest[];
  parents: { displayName: string; role: UserRole }[];
  pairing: { id: string | null; status: string };
}

interface ChildAuditRow {
  id: string;
  session_id: string | null;
  actor_type: string;
  action: string;
  metadata: unknown;
  created_at: string;
}

function readChildTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(CHILD_TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthTokens;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeChildTokens(tokens: AuthTokens) {
  localStorage.setItem(CHILD_TOKENS_KEY, JSON.stringify(tokens));
}

function clearChildTokens() {
  localStorage.removeItem(CHILD_TOKENS_KEY);
}

let childRefreshing: Promise<AuthTokens | null> | null = null;

async function refreshChildTokens(): Promise<AuthTokens | null> {
  if (childRefreshing) return childRefreshing;
  const stored = readChildTokens();
  if (!stored) return null;
  childRefreshing = (async () => {
    try {
      const res = await fetch('/api/child/token/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { tokens: AuthTokens };
      writeChildTokens(data.tokens);
      window.dispatchEvent(new CustomEvent<AuthTokens>('suraksha:child-tokens', { detail: data.tokens }));
      return data.tokens;
    } catch {
      return null;
    } finally {
      childRefreshing = null;
    }
  })();
  return childRefreshing;
}

async function childFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  let tokens = auth ? readChildTokens() : null;
  const run = (access: string | null) =>
    fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(access ? { authorization: `Bearer ${access}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  if (auth && tokens) {
    const expiry = Date.parse(tokens.accessExpiresAt);
    if (Number.isFinite(expiry) && expiry - Date.now() < 45_000) {
      const next = await refreshChildTokens();
      if (next) tokens = next;
    }
  }

  let res = await run(tokens?.accessToken ?? null);
  if (res.status === 401 && auth) {
    const next = await refreshChildTokens();
    if (next) res = await run(next.accessToken);
    else {
      clearChildTokens();
      window.dispatchEvent(new Event('suraksha:child-signed-out'));
    }
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && auth) {
      clearChildTokens();
      window.dispatchEvent(new Event('suraksha:child-signed-out'));
    }
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'request_failed',
      data?.error?.message ?? `Request failed (${res.status})`,
      data?.error?.details,
    );
  }
  return data as T;
}

async function acquireMedia(kind: SessionKind): Promise<MediaStream> {
  if (!navigator.mediaDevices) throw new Error('Media devices are not available in this browser');
  if (kind === 'camera') {
    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  }
  if (kind === 'audio') return navigator.mediaDevices.getUserMedia({ audio: true });
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
}

interface ChildSocket {
  connected: boolean;
  send: (message: WsClientMessage) => boolean;
}

function useChildSocket(token: string | null, onMessage: (message: WsServerMessage) => void): ChildSocket {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }
    let closed = false;
    let retries = 0;
    let retryTimer: number | null = null;
    let heartbeat: number | null = null;

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(wsUrl(token));
      socketRef.current = socket;
      socket.onopen = () => {
        retries = 0;
        setConnected(true);
        heartbeat = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(String(event.data)) as WsServerMessage);
        } catch {
          // Ignore malformed relay frames.
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (heartbeat) window.clearInterval(heartbeat);
        heartbeat = null;
        socketRef.current = null;
        if (!closed) {
          retries += 1;
          retryTimer = window.setTimeout(connect, Math.min(1000 * 2 ** retries, 15_000));
        }
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (heartbeat) window.clearInterval(heartbeat);
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  const send = useCallback((message: WsClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return useMemo(() => ({ connected, send }), [connected, send]);
}

function PairingScreen({ defaultCode, onPaired }: { defaultCode: string; onPaired: (tokens: AuthTokens) => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(defaultCode);
  const [childName, setChildName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await childFetch<{ tokens: AuthTokens }>('/child/pair', {
        method: 'POST',
        auth: false,
        body: {
          code: code.trim().toUpperCase(),
          childName: childName.trim() || undefined,
          platform: 'web-preview',
          model: 'Browser preview',
          osVersion: '',
          appVersion: 'web-preview 1.0.0',
        },
      });
      onPaired(result.tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('child.pairError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="child-pair">
      <section className="child-pair-intro">
        <span className="child-pair-mark">
          <ShieldCheck size={30} />
        </span>
        <span className="eyebrow">Suraksha Child</span>
        <h1>{t('child.welcomeTitle')}</h1>
        <p>{t('child.welcomeBody')}</p>
        <div className="child-pair-shared">
          <strong>{t('child.whatShared')}</strong>
          <ul>
            <li>
              <MapPin size={16} /> {t('child.shareLocation')}
            </li>
            <li>
              <BarChart3 size={16} /> {t('child.shareUsage')}
            </li>
            <li>
              <Bell size={16} /> {t('child.shareAlerts')}
            </li>
          </ul>
        </div>
        <p className="child-pair-never">
          <Eye size={16} /> {t('child.never')}
        </p>
      </section>

      <section className="child-pair-form card">
        <div className="child-pair-icon">
          <Smartphone size={24} />
        </div>
        <h2>{t('child.pairTitle')}</h2>
        <p>{t('child.pairBody')}</p>
        <form onSubmit={submit} className="child-pair-fields">
          <label className="field">
            <span className="field-label">{t('child.pairCode')}</span>
            <input
              className="input input-code"
              value={code}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder="ABC123"
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('child.pairName')}</span>
            <input
              className="input"
              value={childName}
              maxLength={60}
              placeholder="Aarav"
              onChange={(event) => setChildName(event.target.value)}
            />
          </label>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6} icon={<ShieldCheck size={18} />}>
            {busy ? t('child.pairing') : t('child.pairButton')}
          </Button>
        </form>
        <p className="child-pair-preview">
          <Monitor size={15} /> {t('child.browserNote')}
        </p>
      </section>
    </div>
  );
}

function WaitingScreen({
  me,
  onRefresh,
  onForget,
}: {
  me: ChildMe;
  onRefresh: () => Promise<void>;
  onForget: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="child-waiting card">
      <div className="pulse-ring" aria-hidden>
        <Smartphone size={28} />
      </div>
      <span className="eyebrow">{me.family.name}</span>
      <h1>{t('child.waitingParent')}</h1>
      <p>{t('child.waitingParentBody')}</p>
      <div className="child-waiting-meta">
        <span>
          <strong>{me.device.name}</strong> · {me.device.model}
        </span>
        <Pill tone="warning">{t('family.pending')}</Pill>
      </div>
      <div className="row">
        <Button variant="secondary" loading={busy} onClick={() => void refresh()} icon={<RefreshCw size={16} />}>
          {t('common.retry')}
        </Button>
        <Button variant="ghost" onClick={onForget}>
          {t('child.retryPairing')}
        </Button>
      </div>
      <Notice tone="info">{t('child.browserNote')}</Notice>
    </div>
  );
}

function PendingRequest({
  session,
  onApprove,
  onDecline,
}: {
  session: SessionRequest;
  onApprove: () => Promise<void>;
  onDecline: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remain = Math.max(0, Math.floor((Date.parse(session.createdAt) + 120_000 - now) / 1000));
  const expired = remain <= 0;
  const Icon = KIND_ICONS[session.kind];

  const act = async (kind: 'approve' | 'decline') => {
    setBusy(kind);
    try {
      await (kind === 'approve' ? onApprove() : onDecline());
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`child-request${expired ? ' expired' : ''}`}>
      <div className={`child-request-icon kind-${session.kind}`}>
        <Icon size={20} />
      </div>
      <div className="child-request-body">
        <strong>{t('child.requestFrom', { name: session.parentName, kind: session.kind })}</strong>
        {session.reason ? <p>{t('child.why', { reason: session.reason })}</p> : null}
        <small>
          {expired
            ? t('child.requestExpired')
            : t('child.expiresIn', {
                time: `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`,
              })}
        </small>
      </div>
      <div className="child-request-actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={expired}
          loading={busy === 'decline'}
          onClick={() => void act('decline')}
          icon={<X size={15} />}
        >
          {t('child.deny')}
        </Button>
        <Button
          size="sm"
          disabled={expired}
          loading={busy === 'approve'}
          onClick={() => void act('approve')}
          icon={<Check size={15} />}
        >
          {t('child.approve')}
        </Button>
      </div>
    </article>
  );
}

export function ChildPreviewPage() {
  const { t, locale, setLocale } = useI18n();
  const { resolved, setMode } = useTheme();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const [tokens, setTokens] = useState<AuthTokens | null>(readChildTokens);
  const [me, setMe] = useState<ChildMe | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<SessionRequest | null>(null);
  const [history, setHistory] = useState<SessionRequest[]>([]);
  const [accessRows, setAccessRows] = useState<ChildAuditRow[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [connection, setConnection] = useState<RTCPeerConnectionState>('new');
  const [lockDismissed, setLockDismissed] = useState(false);
  const [sosConfirm, setSosConfirm] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  const activeRef = useRef<SessionRequest | null>(null);
  activeRef.current = active;
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const offeredRef = useRef<string | null>(null);
  const configRef = useRef<ConfigResponse | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    iceQueue.current = [];
    offeredRef.current = null;
    setLocalStream(null);
    setConnection('new');
  }, []);

  const loadMe = useCallback(async (silent = false) => {
    try {
      const data = await childFetch<ChildMe>('/child/me');
      setMe(data);
      setMeLoaded(true);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearChildTokens();
        setTokens(null);
        setMe(null);
      } else if (!silent) {
        setLoadError(err instanceof Error ? err.message : 'Could not load this device');
        setMeLoaded(true);
      }
    }
  }, []);

  const mergeSession = useCallback((session: SessionRequest) => {
    setMe((prev) => {
      if (!prev) return prev;
      const exists = prev.sessions.some((item) => item.id === session.id);
      const sessions = exists
        ? prev.sessions.map((item) => (item.id === session.id ? session : item))
        : [session, ...prev.sessions];
      return { ...prev, sessions };
    });
    setActive((prev) => (prev?.id === session.id ? session : prev));
  }, []);

  const loadAccess = useCallback(async () => {
    try {
      const data = await childFetch<{ audit: ChildAuditRow[] }>('/child/access-history');
      setAccessRows(data.audit);
    } catch {
      // History is informational; the companion still works without it.
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await childFetch<{ sessions: SessionRequest[] }>('/child/session-requests');
      setHistory(data.sessions);
    } catch {
      // Inbox history is optional.
    }
  }, []);

  const handleParentSignal = useCallback(async (payload: unknown) => {
    const data = payload as { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    const pc = pcRef.current;
    if (!pc || !data) return;
    try {
      if (data.kind === 'answer' && data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const candidate of iceQueue.current.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
      } else if (data.kind === 'ice' && data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
        else iceQueue.current.push(data.candidate);
      }
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : t('child.mediaError'));
    }
  }, [t]);

  const handleWs = useCallback(
    (message: WsServerMessage) => {
      if (message.type === 'session.update' || message.type === 'session.request') {
        const session = message.data.session;
        mergeSession(session);
        void loadSessions();
        void loadAccess();
        if (session.status === 'pending') {
          toast.show(
            t('child.requestFrom', {
              name: session.parentName,
              kind: locale === 'gu' ? { camera: 'કેમેરા', audio: 'ઓડિયો', screen: 'સ્ક્રીન' }[session.kind] : session.kind,
            }),
          );
        }
        if (
          activeRef.current?.id === session.id &&
          ['ended', 'denied', 'expired', 'cancelled'].includes(session.status)
        ) {
          stopMedia();
          setActive(null);
          toast.show(t('child.sessionEnded'));
        }
        return;
      }
      if (message.type === 'signal' && message.from === 'parent' && activeRef.current?.id === message.sessionId) {
        void handleParentSignal(message.payload);
        return;
      }
      if (message.type === 'policy.updated') {
        setLockDismissed(false);
        void loadMe(true);
        return;
      }
      if (message.type === 'device.unlinked') {
        clearChildTokens();
        setTokens(null);
        setMe(null);
        setActive(null);
        stopMedia();
        toast.show(t('child.unlinked'));
      }
    },
    [mergeSession, loadSessions, loadAccess, stopMedia, handleParentSignal, loadMe, locale, t, toast],
  );

  const socket = useChildSocket(tokens?.accessToken ?? null, handleWs);

  const createOffer = useCallback(
    async (session: SessionRequest) => {
      const stream = streamRef.current;
      if (!stream) return;
      try {
        pcRef.current?.close();
        const config = configRef.current;
        const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
        if (config?.turnUrls?.length && config.turnUsername) {
          iceServers.push({
            urls: config.turnUrls,
            username: config.turnUsername,
            credential: config.turnCredential,
          });
        }
        const pc = new RTCPeerConnection({ iceServers });
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.send({
              type: 'signal',
              sessionId: session.id,
              payload: { kind: 'ice', candidate: event.candidate.toJSON() },
            });
          }
        };
        pc.onconnectionstatechange = () => setConnection(pc.connectionState);
        pcRef.current = pc;
        socket.send({ type: 'webrtc.ready', sessionId: session.id });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.send({ type: 'signal', sessionId: session.id, payload: { kind: 'offer', sdp: offer } });
      } catch (err) {
        offeredRef.current = null;
        setMediaError(err instanceof Error ? err.message : t('child.mediaError'));
      }
    },
    [socket, t],
  );

  useEffect(() => {
    void fetch('/api/config')
      .then((res) => (res.ok ? (res.json() as Promise<ConfigResponse>) : null))
      .then((config) => {
        if (config) configRef.current = config;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const signOut = () => {
      clearChildTokens();
      setTokens(null);
      setMe(null);
      setMeLoaded(false);
      setActive(null);
      stopMedia();
    };
    const refreshed = (event: Event) => {
      const next = (event as CustomEvent<AuthTokens>).detail;
      if (next?.accessToken) setTokens(next);
    };
    window.addEventListener('suraksha:child-signed-out', signOut);
    window.addEventListener('suraksha:child-tokens', refreshed);
    return () => {
      window.removeEventListener('suraksha:child-signed-out', signOut);
      window.removeEventListener('suraksha:child-tokens', refreshed);
    };
  }, [stopMedia]);

  useEffect(() => {
    if (!tokens) {
      setMe(null);
      setMeLoaded(false);
      return;
    }
    setMeLoaded(false);
    void loadMe();
    const timer = window.setInterval(() => void loadMe(true), 6000);
    return () => window.clearInterval(timer);
  }, [tokens, loadMe]);

  useEffect(() => {
    if (!tokens) return;
    const beat = async () => {
      let battery: number | null = null;
      try {
        const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
        if (typeof nav.getBattery === 'function') {
          const status = await nav.getBattery();
          battery = Math.round(status.level * 100);
        }
      } catch {
        battery = null;
      }
      try {
        await childFetch('/child/heartbeat', {
          method: 'POST',
          body: {
            battery,
            network: navigator.onLine ? 'wifi' : 'offline',
            appVersion: 'web-preview 1.0.0',
          },
        });
      } catch {
        // Presence is best-effort.
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 45_000);
    return () => window.clearInterval(timer);
  }, [tokens]);

  useEffect(() => {
    if (!me?.device.linkedAt) return;
    void loadAccess();
    void loadSessions();
  }, [me?.device.id, me?.device.linkedAt, loadAccess, loadSessions]);

  useEffect(() => {
    if (!active || !localStream || !socket.connected) return;
    if (active.status !== 'active') return;
    if (pcRef.current || offeredRef.current === active.id) return;
    offeredRef.current = active.id;
    void createOffer(active);
  }, [active, localStream, socket.connected, createOffer]);

  useEffect(() => {
    if (!active || !me || !meLoaded) return;
    const current = me.sessions.find((item) => item.id === active.id);
    if (current && !['ended', 'denied', 'expired', 'cancelled'].includes(current.status)) return;
    stopMedia();
    setActive(null);
  }, [me, active, meLoaded, stopMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && localStream) {
      video.srcObject = localStream;
      void video.play().catch(() => undefined);
    }
  }, [localStream, active?.id]);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const lockUntil = me?.policies.instant_block.active ? me.policies.instant_block.until : null;
  useEffect(() => setLockDismissed(false), [lockUntil]);

  const startSharing = async (session: SessionRequest) => {
    setMediaBusy(true);
    setMediaError(null);
    offeredRef.current = null;
    try {
      const stream = await acquireMedia(session.kind);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      setLocalStream(stream);
      if (session.kind === 'screen') {
        for (const track of stream.getVideoTracks()) {
          track.onended = () => void endSharing(session, true);
        }
      }
      let target = session;
      if (session.status === 'approved') {
        const result = await childFetch<{ session: SessionRequest }>(`/child/sessions/${session.id}/start`, {
          method: 'POST',
        });
        target = result.session;
        mergeSession(target);
        void loadAccess();
      }
      setActive(target);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : t('child.mediaError'));
    } finally {
      setMediaBusy(false);
    }
  };

  const endSharing = useCallback(
    async (session: SessionRequest, silent = false) => {
      try {
        if (session.status === 'approved' || session.status === 'active') {
          const result = await childFetch<{ session: SessionRequest }>(`/child/sessions/${session.id}/end`, {
            method: 'POST',
          });
          mergeSession(result.session);
        }
        stopMedia();
        setActive(null);
        if (!silent) toast.show(t('child.stopped'));
        void loadAccess();
        void loadSessions();
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : t('child.mediaError'));
      }
    },
    [mergeSession, stopMedia, toast, t, loadAccess, loadSessions],
  );

  const respond = async (session: SessionRequest, approve: boolean) => {
    try {
      const result = await childFetch<{ session: SessionRequest }>(
        `/child/session-requests/${session.id}/respond`,
        {
          method: 'POST',
          body: { approve, reason: approve ? undefined : 'Declined on the child device' },
        },
      );
      mergeSession(result.session);
      if (!approve) toast.show(t('common.denied'));
      void loadAccess();
      void loadSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('child.requestExpired'));
    }
  };

  const togglePermission = async (key: string, granted: boolean) => {
    try {
      const result = await childFetch<{ permissions: PermissionState[] }>('/child/permissions', {
        method: 'POST',
        body: { key, granted },
      });
      setMe((prev) => (prev ? { ...prev, device: { ...prev.device, permissions: result.permissions } } : prev));
    } catch {
      toast.error(t('common.saveFailed'));
    }
  };

  const sharePoint = async (point: { lat: number; lng: number }, accuracy = 25) => {
    try {
      const result = await childFetch<{ stored: boolean; reason?: string }>('/child/location', {
        method: 'POST',
        body: { lat: point.lat, lng: point.lng, accuracy, speed: null, recordedAt: new Date().toISOString() },
      });
      if (result.stored) toast.success(t('child.locationShared'));
      else toast.show(result.reason ?? t('location.sharingOff'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('child.locationError'));
    }
  };

  const shareNow = () => {
    if (!navigator.geolocation) {
      toast.error(t('child.locationDenied'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void sharePoint(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          Math.round(position.coords.accuracy),
        ),
      () => toast.error(t('child.locationDenied')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  const sendUsage = async () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      await childFetch('/child/usage', {
        method: 'POST',
        body: {
          day,
          entries: [
            { package: 'com.android.chrome', appName: 'Chrome', category: 'Browsing', minutes: 28 },
            { package: 'com.google.android.youtube', appName: 'YouTube', category: 'Video', minutes: 22 },
            { package: 'com.whatsapp', appName: 'WhatsApp', category: 'Messaging', minutes: 14 },
          ],
        },
      });
      toast.success(t('child.usageSent'));
      void loadAccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    }
  };

  const sendSos = async () => {
    try {
      await childFetch('/child/sos', { method: 'POST', body: {} });
      setSosConfirm(false);
      toast.success(t('child.sosSent'));
      void loadAccess();
    } catch {
      toast.error(t('common.saveFailed'));
    }
  };

  const unlink = async () => {
    try {
      await childFetch('/child/unlink', { method: 'POST', body: { confirm: true } });
    } catch {
      // Even if the request fails, keep the pairing so the child can retry.
      toast.error(t('common.saveFailed'));
      return;
    }
    clearChildTokens();
    setTokens(null);
    setMe(null);
    setActive(null);
    stopMedia();
    toast.show(t('child.unlinked'));
  };

  const forget = () => {
    clearChildTokens();
    setTokens(null);
    setMe(null);
    setActive(null);
    stopMedia();
  };

  const kindLabel = (kind: SessionKind) =>
    locale === 'gu' ? { camera: 'કેમેરા', audio: 'ઓડિયો', screen: 'સ્ક્રીન' }[kind] : kind;

  const auditText = (action: string) => {
    const labels: Record<string, string> =
      locale === 'gu'
        ? {
            'session.approved': 'સેશન મંજૂર થયું',
            'session.denied': 'સેશન નકારાયું',
            'session.started': 'શેરિંગ શરૂ થયું',
            'session.ended': 'શેરિંગ બંધ થયું',
            'pairing.child_confirmed': 'ઉપકરણ જોડાયું',
            'device.unlinked_by_child': 'બાળકે ઉપકરણ અલગ કર્યું',
            'sos.triggered': 'SOS મોકલાયું',
            'demo.child_session_opened': 'વાલીએ પ્રિવ્યૂ ખોલ્યું',
          }
        : {
            'session.approved': 'Session approved',
            'session.denied': 'Session declined',
            'session.started': 'Sharing started',
            'session.ended': 'Sharing stopped',
            'pairing.child_confirmed': 'Device paired',
            'device.unlinked_by_child': 'Device unlinked by child',
            'sos.triggered': 'SOS sent',
            'demo.child_session_opened': 'Preview opened by parent',
          };
    return labels[action] ?? titleCase(action);
  };

  const actorText = (actor: string) =>
    actor === 'parent'
      ? t('child.auditActor.parent')
      : actor === 'child'
        ? t('child.auditActor.child')
        : t('child.auditActor.system');

  const linked = Boolean(me?.device.linkedAt);
  const pending = me?.sessions.filter((session) => session.status === 'pending') ?? [];
  const live =
    active ??
    me?.sessions.find((session) => session.status === 'approved' || session.status === 'active') ??
    null;
  const finished = history
    .filter((session) => ['ended', 'denied', 'expired', 'cancelled'].includes(session.status))
    .slice(0, 6);
  const LiveIcon = live ? KIND_ICONS[live.kind] : Camera;
  const permissions = me?.device.permissions ?? [];
  const granted = permissions.filter((permission) => permission.granted).length;
  const focusLocked = Boolean(lockUntil && Date.parse(lockUntil) > Date.now());
  const parents = me?.parents.map((parent) => parent.displayName).join(' · ') ?? '';

  return (
    <div className="child-app">
      <header className="child-top">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <ShieldCheck size={21} />
          </span>
          <span className="brand-word">Suraksha</span>
        </Link>
        <div className="child-top-meta">
          {me ? <Pill tone="brand">{me.family.name}</Pill> : null}
          {tokens ? (
            <span className={`child-socket${socket.connected ? ' on' : ''}`}>
              {socket.connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {socket.connected ? t('common.online') : t('common.offline')}
            </span>
          ) : null}
        </div>
        <div className="child-top-actions">
          <button
            type="button"
            className="lang-toggle"
            onClick={() => setLocale(locale === 'en' ? 'gu' : 'en')}
            aria-label="Switch language"
          >
            <Languages size={14} /> {locale === 'en' ? 'ગુજરાતી' : 'English'}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Toggle theme"
            onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link to="/" className="btn btn-secondary btn-sm child-parent-link">
            {t('child.openParent')}
          </Link>
        </div>
      </header>

      <main className="child-main">
        {!tokens ? (
          <PairingScreen
            defaultCode={(searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}
            onPaired={(nextTokens) => {
              writeChildTokens(nextTokens);
              setTokens(nextTokens);
              setMe(null);
              setMeLoaded(false);
              toast.success(t('child.pairSuccess'));
            }}
          />
        ) : !me ? (
          loadError && meLoaded ? (
            <div className="child-load-state card">
              <strong>{loadError}</strong>
              <Button variant="secondary" onClick={() => void loadMe()} icon={<RefreshCw size={16} />}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <div className="child-load-state">
              <Spinner size={26} label={t('common.loading')} />
            </div>
          )
        ) : !linked ? (
          <WaitingScreen me={me} onRefresh={() => loadMe()} onForget={forget} />
        ) : (
          <>
            <section className="child-hero">
              <div className="child-hero-id">
                <Avatar name={me.device.childName} size={58} />
                <div>
                  <span className="eyebrow">{t('child.home')}</span>
                  <h1>{me.device.childName}</h1>
                  <p>
                    {me.device.name} · {me.device.model}
                  </p>
                </div>
              </div>
              <div className="child-hero-meta">
                <Pill tone={me.device.online ? 'success' : 'neutral'}>
                  {me.device.online ? t('common.online') : t('common.offline')}
                </Pill>
                {me.device.battery !== null ? (
                  <span>
                    <BatteryMedium size={15} /> {me.device.battery}%
                  </span>
                ) : null}
                <span>{t('child.linkedTo', { name: me.family.name })}</span>
                {parents ? <span className="child-parents">{parents}</span> : null}
              </div>
            </section>

            {focusLocked && !lockDismissed && lockUntil ? (
              <Notice tone="warning" icon={<Lock size={18} />}>
                <strong>{t('child.focusLock')}</strong> {t('child.focusLockUntil', { time: clockTime(lockUntil, locale) })}{' '}
                <span className="fineprint">{t('child.focusLockPreview')}</span>{' '}
                <button type="button" className="link-btn" onClick={() => setLockDismissed(true)}>
                  {t('child.dismissPreview')}
                </button>
              </Notice>
            ) : null}

            <div className="child-grid">
              <div className="child-col">
                <section className="card child-card">
                  <div className="card-head">
                    <h2>{t('child.sessionRequests')}</h2>
                    <Pill tone={pending.length ? 'warning' : 'neutral'}>{pending.length}</Pill>
                  </div>

                  {live ? (
                    <div className="child-live">
                      <div className="live-bar">
                        <span className="live-dot" aria-hidden />
                        <strong>
                          {live.status === 'active' ? t('child.activeSession') : t('session.connecting')}
                        </strong>
                        <Pill tone="brand">{kindLabel(live.kind)}</Pill>
                      </div>

                      <div className={`child-media${localStream ? ' live' : ''}`}>
                        <video
                          ref={videoRef}
                          muted
                          playsInline
                          autoPlay
                          className={live.kind === 'audio' ? 'child-video hidden-video' : 'child-video'}
                        />
                        {!localStream ? (
                          <div className="child-media-overlay">
                            <span className={`kind-icon kind-${live.kind}`}>
                              <LiveIcon size={22} />
                            </span>
                            <strong>{t('child.startMediaHint')}</strong>
                          </div>
                        ) : (
                          <span className="child-live-tag">
                            <Eye size={14} />
                            {live.kind === 'screen'
                              ? t('child.screenPreview')
                              : live.kind === 'camera'
                                ? t('child.cameraPreview')
                                : t('child.audioPreview')}
                          </span>
                        )}
                        {live.kind === 'audio' && localStream ? (
                          <div className="child-audio-orb">
                            <Mic size={26} />
                          </div>
                        ) : null}
                      </div>

                      {connection === 'connected' ? (
                        <div className="session-connected">
                          <CheckCircle2 size={16} /> {t('child.connectedParent')}
                        </div>
                      ) : localStream ? (
                        <p className="child-live-note">{t('child.connectingParent')}</p>
                      ) : null}

                      {live.kind === 'screen' && localStream ? (
                        <p className="fineprint">{t('child.screenStopHint')}</p>
                      ) : null}
                      {localStream ? <p className="child-live-note">{t('child.mediaLive')}</p> : null}

                      <div className="child-live-actions">
                        {!localStream ? (
                          <Button
                            onClick={() => void startSharing(live)}
                            loading={mediaBusy}
                            icon={live.status === 'approved' ? <Play size={16} /> : <RefreshCw size={16} />}
                          >
                            {live.status === 'approved' ? t('child.startSharing') : t('child.resumeSharing')}
                          </Button>
                        ) : null}
                        <Button variant="danger" onClick={() => void endSharing(live)} icon={<PhoneOff size={16} />}>
                          {t('child.stop')}
                        </Button>
                      </div>
                      {mediaError ? <Notice tone="warning">{mediaError}</Notice> : null}
                    </div>
                  ) : null}

                  {pending.length ? (
                    pending.map((session) => (
                      <PendingRequest
                        key={session.id}
                        session={session}
                        onApprove={() => respond(session, true)}
                        onDecline={() => respond(session, false)}
                      />
                    ))
                  ) : live ? null : (
                    <p className="child-empty">
                      <Inbox size={16} /> {t('child.noRequests')}
                    </p>
                  )}

                  {finished.length ? (
                    <>
                      <div className="child-subhead">{t('child.history')}</div>
                      <ul className="child-history">
                        {finished.map((session) => (
                          <li key={session.id}>
                            <span className={`kind-icon small kind-${session.kind}`}>
                              {(() => {
                                const Icon = KIND_ICONS[session.kind];
                                return <Icon size={14} />;
                              })()}
                            </span>
                            <span>
                              <strong>{kindLabel(session.kind)}</strong>
                              <small>
                                {dateTime(session.endedAt ?? session.createdAt, locale)} ·{' '}
                                {session.status === 'denied'
                                  ? t('common.denied')
                                  : session.status === 'ended'
                                    ? t('common.ended')
                                    : session.status === 'expired'
                                      ? t('session.expired')
                                      : t('session.cancelled')}
                              </small>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </section>

                <section className="card child-card">
                  <div className="card-head">
                    <h2>{t('child.accessHistory')}</h2>
                    <History size={17} />
                  </div>
                  {accessRows.length ? (
                    <ul className="child-timeline">
                      {accessRows.slice(0, 8).map((row) => (
                        <li key={row.id}>
                          <span className={`timeline-dot ${row.actor_type}`} />
                          <div>
                            <strong>{auditText(row.action)}</strong>
                            <small>
                              {actorText(row.actor_type)} · {relativeTime(row.created_at, locale)}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="child-empty">{t('child.accessEmpty')}</p>
                  )}
                </section>
              </div>

              <div className="child-col">
                <section className="card child-card">
                  <div className="card-head">
                    <h2>{t('child.permissions')}</h2>
                    <Pill tone={granted === permissions.length ? 'success' : 'warning'}>
                      {granted}/{permissions.length}
                    </Pill>
                  </div>
                  <p className="card-sub">{t('child.permissionsBody')}</p>
                  <ul className="perm-list">
                    {permissions.map((permission) => {
                      const copy = PERMISSION_COPY[permission.key as keyof typeof PERMISSION_COPY];
                      return (
                        <li key={permission.key} className="perm-row">
                          <span className="perm-icon">
                            <ShieldCheck size={16} />
                          </span>
                          <span className="perm-text">
                            <strong>{copy ? t(copy[0]) : permission.label}</strong>
                            <small>{copy ? t(copy[1]) : permission.requiredFor}</small>
                          </span>
                          <Toggle
                            checked={permission.granted}
                            label={copy ? t(copy[0]) : permission.label}
                            onChange={(next) => void togglePermission(permission.key, next)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <p className="fineprint">{t('child.permissionsPreviewNote')}</p>
                </section>

                <section className="card child-card">
                  <div className="card-head">
                    <h2>{t('child.settings')}</h2>
                    <Smartphone size={17} />
                  </div>
                  <button type="button" className="child-action" onClick={shareNow}>
                    <span className="child-action-icon">
                      <MapPin size={19} />
                    </span>
                    <span>
                      <strong>{t('child.shareNow')}</strong>
                      <small>{t('child.shareLocation')}</small>
                    </span>
                  </button>
                  <div className="child-action-split">
                    <Button size="sm" variant="secondary" onClick={() => void sharePoint(DEMO_HOME)}>
                      {t('child.simulateHome')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void sharePoint(DEMO_SCHOOL_EXIT)}>
                      {t('child.simulateSchool')}
                    </Button>
                  </div>
                  <button type="button" className="child-action" onClick={() => void sendUsage()}>
                    <span className="child-action-icon">
                      <BarChart3 size={19} />
                    </span>
                    <span>
                      <strong>{t('child.sendUsage')}</strong>
                      <small>{t('child.usageDemoNote')}</small>
                    </span>
                  </button>

                  {sosConfirm ? (
                    <Notice tone="danger" icon={<Siren size={18} />}>
                      <p>{t('child.sosConfirm')}</p>
                      <div className="row">
                        <Button size="sm" variant="danger" onClick={() => void sendSos()}>
                          {t('common.confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSosConfirm(false)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </Notice>
                  ) : (
                    <button type="button" className="child-action danger" onClick={() => setSosConfirm(true)}>
                      <span className="child-action-icon">
                        <Siren size={19} />
                      </span>
                      <span>
                        <strong>{t('child.sos')}</strong>
                        <small>{t('child.sosConfirm')}</small>
                      </span>
                    </button>
                  )}
                </section>

                <section className="card child-card child-danger">
                  <div className="card-head">
                    <h2>{t('child.unlink')}</h2>
                    <Unlink size={17} />
                  </div>
                  <p className="card-sub">{t('child.unlinkWarning')}</p>
                  {unlinkConfirm ? (
                    <Notice tone="danger">
                      <strong>{t('child.unlinkConfirmTitle')}</strong>
                      <div className="row">
                        <Button size="sm" variant="danger" onClick={() => void unlink()}>
                          {t('common.confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setUnlinkConfirm(false)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </Notice>
                  ) : (
                    <Button variant="secondary" onClick={() => setUnlinkConfirm(true)} icon={<Unlink size={16} />}>
                      {t('child.unlink')}
                    </Button>
                  )}
                  <button type="button" className="link-btn" onClick={forget}>
                    {t('child.forgetDevice')}
                  </button>
                </section>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="child-foot">
        <ShieldCheck size={15} /> {t('child.never')}
      </footer>
    </div>
  );
}
