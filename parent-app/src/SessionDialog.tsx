import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CircleSlash,
  Mic,
  Monitor,
  PhoneOff,
  ShieldCheck,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Device, SessionKind, SessionRequest } from '@suraksha/shared';
import { apiFetch, ApiError } from './api';
import type { ConfigResponse, SessionResponse } from './api';
import { useI18n } from './i18n';
import { useRealtime, useRealtimeMessage } from './realtime';
import { useToast } from './toast';
import { Button, Modal, Notice, Pill, Spinner } from './ui';

interface SessionDialogProps {
  open: boolean;
  device: Device | null;
  initialKind?: SessionKind | null;
  onClose: () => void;
  onChanged?: () => void;
}

const KIND_ICONS = { camera: Camera, audio: Mic, screen: Monitor } as const;

export function SessionDialog({ open, device, initialKind = null, onClose, onChanged }: SessionDialogProps) {
  const { t, locale } = useI18n();
  const { send: wsSend, connected } = useRealtime();
  const toast = useToast();
  const [kind, setKind] = useState<SessionKind>(initialKind ?? 'camera');
  const [reason, setReason] = useState('');
  const [session, setSession] = useState<SessionRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<RTCPeerConnectionState>('new');
  const [muted, setMuted] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<SessionRequest | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const configRef = useRef<ConfigResponse | null>(null);
  const pollRef = useRef<number | null>(null);

  sessionRef.current = session;

  const kindLabels = useMemo(
    () =>
      locale === 'gu'
        ? { camera: 'કેમેરા', audio: 'ઓડિયો', screen: 'સ્ક્રીન' }
        : { camera: 'camera', audio: 'audio', screen: 'screen' },
    [locale],
  );

  const cleanupPeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    iceQueue.current = [];
    setRemoteStream(null);
    setConnection('new');
  }, []);

  useEffect(() => {
    if (open) {
      setKind(initialKind ?? 'camera');
      setReason('');
      setError(null);
      setMediaError(null);
      setSession(null);
      setConfirmEnd(false);
      setElapsed(0);
      setMuted(false);
      void apiFetch<ConfigResponse>('/config', { auth: false })
        .then((config) => {
          configRef.current = config;
        })
        .catch(() => undefined);
    } else {
      cleanupPeer();
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [open, initialKind, cleanupPeer]);

  useEffect(() => {
    if (session) onChanged?.();
  }, [session, onChanged]);

  useEffect(() => {
    if (!open || !session) return;
    if (session.status !== 'pending') {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = window.setInterval(() => {
      void apiFetch<SessionResponse>(`/sessions/${session.id}`)
        .then((data) => setSession((prev) => (prev?.id === data.session.id ? data.session : prev)))
        .catch(() => undefined);
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, session]);

  useEffect(() => {
    if (session?.status !== 'active') return;
    const started = session.startedAt ? Date.parse(session.startedAt) : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session?.status, session?.startedAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && remoteStream) {
      video.srcObject = remoteStream;
      void video.play().catch(() => undefined);
    }
  }, [remoteStream, session?.status]);

  const ensurePeer = useCallback((): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current;
    const turnUrls = configRef.current?.turnUrls ?? [];
    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (turnUrls.length && configRef.current?.turnUsername) {
      iceServers.push({
        urls: turnUrls,
        username: configRef.current.turnUsername,
        credential: configRef.current.turnCredential,
      });
    }
    const pc = new RTCPeerConnection({ iceServers });
    pc.onicecandidate = (event) => {
      const active = sessionRef.current;
      if (event.candidate && active) {
        wsSend({
          type: 'signal',
          sessionId: active.id,
          payload: { kind: 'ice', candidate: event.candidate.toJSON() },
        });
      }
    };
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      setConnection(pc.connectionState);
      if (pc.connectionState === 'failed') {
        setMediaError(t('session.mediaFailed'));
      }
    };
    pcRef.current = pc;
    return pc;
  }, [wsSend, t]);

  useEffect(() => {
    if (!open || !session) return;
    if (session.status === 'approved' && !pcRef.current) {
      ensurePeer();
      wsSend({ type: 'webrtc.ready', sessionId: session.id });
    }
    if (session.status === 'ended' || session.status === 'denied' || session.status === 'expired' || session.status === 'cancelled') {
      cleanupPeer();
    }
  }, [open, session, ensurePeer, wsSend, cleanupPeer]);

  useRealtimeMessage((message) => {
    const active = sessionRef.current;
    if (!active) return;
    if (message.type === 'session.update' && message.data.session.id === active.id) {
      setSession(message.data.session);
      return;
    }
    if (message.type === 'webrtc.ready' && message.sessionId === active.id && message.from === 'child') {
      if (!pcRef.current) ensurePeer();
      return;
    }
    if (message.type !== 'signal' || message.sessionId !== active.id || message.from !== 'child') return;

    const payload = message.payload as
      | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
      | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
      | { kind: 'ice'; candidate: RTCIceCandidateInit };

    void (async () => {
      try {
        const pc = ensurePeer();
        if (payload.kind === 'offer') {
          await pc.setRemoteDescription(payload.sdp);
          for (const candidate of iceQueue.current.splice(0)) {
            await pc.addIceCandidate(candidate).catch(() => undefined);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend({ type: 'signal', sessionId: active.id, payload: { kind: 'answer', sdp: answer } });
        } else if (payload.kind === 'ice') {
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate).catch(() => undefined);
          else iceQueue.current.push(payload.candidate);
        }
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : t('session.mediaFailed'));
      }
    })();
  });

  const requestSession = async () => {
    if (!device) return;
    setSending(true);
    setError(null);
    try {
      const result = await apiFetch<SessionResponse>(`/devices/${device.id}/sessions`, {
        method: 'POST',
        body: { kind, reason: reason.trim() },
      });
      setSession(result.session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request');
    } finally {
      setSending(false);
    }
  };

  const cancelRequest = async () => {
    if (!session) return;
    try {
      const result = await apiFetch<SessionResponse>(`/sessions/${session.id}/cancel`, { method: 'POST' });
      setSession(result.session);
      toast.show(t('session.cancelled'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel');
    }
  };

  const endSession = async () => {
    if (!session) return;
    try {
      const result = await apiFetch<SessionResponse>(`/sessions/${session.id}/end`, {
        method: 'POST',
        body: { reason: 'Stopped by parent' },
      });
      setSession(result.session);
      cleanupPeer();
      setConfirmEnd(false);
      toast.show(t('session.ended'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not stop the session');
    }
  };

  const closeDialog = () => {
    if (session && (session.status === 'pending' || session.status === 'approved' || session.status === 'active')) return;
    cleanupPeer();
    onClose();
  };

  const finished = session && ['ended', 'denied', 'expired', 'cancelled'].includes(session.status);
  const dismissable = !session || session.status === 'ended' || session.status === 'denied' || session.status === 'expired' || session.status === 'cancelled';
  const KindIcon = KIND_ICONS[kind];
  const status = session?.status;
  const trustedEnabled = device?.trustedCheckIn?.enabled === true;
  const canQuickStart = trustedEnabled && (kind === 'camera' || kind === 'audio');

  return (
    <Modal
      open={open}
      onClose={closeDialog}
      dismissable={dismissable}
      title={
        !session
          ? t('session.requestTitle')
          : finished
            ? t('session.title')
            : `${kindLabels[session.kind][0].toUpperCase()}${kindLabels[session.kind].slice(1)} ${locale === 'gu' ? 'સેશન' : 'session'}`
      }
      subtitle={!session ? device?.childName : undefined}
      size="md"
      footer={
        !session ? (
          <>
            <Button variant="ghost" onClick={closeDialog}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void requestSession()}
              loading={sending}
              disabled={!device?.online || (!canQuickStart && reason.trim().length < 3)}
              icon={<ShieldCheck size={17} />}
            >
              {sending ? t('session.sending') : canQuickStart ? t('session.quickCheckStart') : t('session.send')}
            </Button>
          </>
        ) : status === 'pending' ? (
          <Button variant="secondary" onClick={() => void cancelRequest()}>
            {t('session.cancelRequest')}
          </Button>
        ) : status === 'active' || status === 'approved' ? (
          confirmEnd ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => void endSession()} icon={<PhoneOff size={17} />}>
                {t('session.end')}
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmEnd(true)} icon={<PhoneOff size={17} />}>
              {t('session.end')}
            </Button>
          )
        ) : (
          <Button variant="secondary" onClick={closeDialog}>
            {t('common.close')}
          </Button>
        )
      }
    >
      {!session ? (
        <div className="session-form">
          <div className="kind-grid" role="radiogroup" aria-label={t('session.requestTitle')}>
            {(['camera', 'audio', 'screen'] as SessionKind[]).map((option) => {
              const Icon = KIND_ICONS[option];
              const selected = kind === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`kind-option${selected ? ' selected' : ''}`}
                  onClick={() => setKind(option)}
                >
                  <span className={`kind-icon kind-${option}`}>
                    <Icon size={20} />
                  </span>
                  <span className="kind-title">{kindLabels[option][0].toUpperCase() + kindLabels[option].slice(1)}</span>
                  <span className="kind-desc">
                    {option === 'camera' ? t('session.cameraDesc') : option === 'audio' ? t('session.audioDesc') : t('session.screenDesc')}
                  </span>
                </button>
              );
            })}
          </div>

          {!device?.online ? (
            <Notice tone="warning" icon={<TriangleAlert size={18} />}>
              {t('common.deviceOffline')}. {locale === 'gu' ? 'બાળકને એપ ખોલવા કહો.' : 'Ask your child to open the Suraksha Child app.'}
            </Notice>
          ) : null}

          {trustedEnabled ? (
            <Notice tone={kind === 'screen' ? 'info' : 'brand'} icon={<ShieldCheck size={18} />}>
              {kind === 'screen' ? t('session.quickCheckScreen') : t('session.quickCheckOn')}
            </Notice>
          ) : null}

          <label className="field">
            <span className="field-label">{t('session.reason')}</span>
            <textarea
              className="input textarea"
              value={reason}
              maxLength={280}
              rows={3}
              placeholder={t('session.reasonPlaceholder')}
              onChange={(event) => setReason(event.target.value)}
            />
            <span className="field-hint">
              {canQuickStart ? t('session.quickCheckReasonHint') : `${reason.trim().length}/280`}
            </span>
          </label>

          <Notice tone="brand" icon={<ShieldCheck size={18} />}>
            {t('auth.privacyNote')}
          </Notice>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : status === 'pending' ? (
        <div className="session-waiting">
          <div className="pulse-ring" aria-hidden>
            <KindIcon size={26} />
          </div>
          <h3>{t('session.waiting')}</h3>
          <p>{t('session.waitingHint')}</p>
          <div className="waiting-meta">
            <span>{device?.name}</span>
            <span>{connected ? 'Realtime connected' : 'Reconnecting…'}</span>
          </div>
          <Notice tone="info">{t('session.historyNote')}</Notice>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : status === 'approved' || status === 'active' ? (
        <div className="session-live">
          <div className="live-bar">
            <span className="live-dot" aria-hidden />
            <strong>{status === 'active' ? t('session.live') : t('session.connecting')}</strong>
            <span className="live-timer">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <Pill tone="success">{kindLabels[session.kind]}</Pill>
            {session.trusted ? <Pill tone="info">{t('session.quickCheckBadge')}</Pill> : null}
          </div>

          <div className={`media-stage${muted ? ' muted' : ''}`}>
            {session.kind === 'audio' ? (
              <div className="audio-stage">
                <span className="audio-orb">
                  <Volume2 size={30} />
                </span>
                <p>{t('session.audioOnly', { name: device?.childName ?? '' })}</p>
              </div>
            ) : null}
            <video
              ref={videoRef}
              className={`remote-video${session.kind === 'audio' ? ' audio-only' : ''}`}
              autoPlay
              playsInline
              muted={muted}
            />
            {!remoteStream ? (
              <div className="media-placeholder">
                <Spinner size={22} label={t('session.connectingMedia')} />
              </div>
            ) : null}
            {session.kind !== 'audio' ? (
              <div className="media-controls">
                <button type="button" className="glass-btn" onClick={() => setMuted((value) => !value)} aria-label="Mute playback">
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
              </div>
            ) : null}
          </div>

          {connection === 'connected' ? (
            <div className="session-connected">
              <CheckCircle2 size={16} /> {locale === 'gu' ? 'બાળક સાથે જોડાયું' : 'Connected to the child device'} · {device?.name}
            </div>
          ) : null}
          {confirmEnd ? (
            <Notice tone="danger" icon={<PhoneOff size={18} />}>
              <strong>{t('session.endConfirmTitle')}</strong> {t('session.endConfirmBody')}
            </Notice>
          ) : (
            <p className="session-note">{t('session.visibleNote')}</p>
          )}
          {mediaError ? <Notice tone="warning">{mediaError}</Notice> : null}
        </div>
      ) : (
        <div className="session-finished">
          {status === 'denied' ? (
            <CircleSlash size={34} />
          ) : status === 'ended' ? (
            <CheckCircle2 size={34} />
          ) : (
            <TriangleAlert size={34} />
          )}
          <h3>
            {status === 'denied'
              ? t('session.denied')
              : status === 'ended'
                ? t('session.ended')
                : status === 'expired'
                  ? t('session.expired')
                  : t('session.cancelled')}
          </h3>
          <p>
            {status === 'denied'
              ? t('session.noApproval')
              : locale === 'gu'
                ? 'દરેક સેશન એક્સેસ ઇતિહાસમાં નોંધાયું છે.'
                : 'This session is recorded in the access history.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
