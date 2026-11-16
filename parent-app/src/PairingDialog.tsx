import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, QrCode, RefreshCw, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import type { Device, Pairing } from '@suraksha/shared';
import { apiFetch, ApiError } from './api';
import type { PairingResponse } from './api';
import { useAuth } from './auth';
import { useDevices } from './devices';
import { useI18n } from './i18n';
import { useToast } from './toast';
import { Button, Field, Modal, Notice, Spinner } from './ui';

interface PairingDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'name' | 'code' | 'linked';

export function PairingDialog({ open, onClose }: PairingDialogProps) {
  const { t } = useI18n();
  const { family } = useAuth();
  const { refresh } = useDevices();
  const toast = useToast();
  const [step, setStep] = useState<Step>('name');
  const [childName, setChildName] = useState('');
  const [pairing, setPairing] = useState<(Pairing & { code?: string }) | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [linkedDevice, setLinkedDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep('name');
      setChildName('');
      setPairing(null);
      setQr(null);
      setLinkedDevice(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!pairing?.code) {
      setQr(null);
      return;
    }
    const url = `${window.location.origin}/child?code=${encodeURIComponent(pairing.code)}`;
    void QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [pairing?.code]);

  useEffect(() => {
    if (!open || !pairing || step !== 'code') return;
    const check = async () => {
      try {
        const result = await apiFetch<PairingResponse>(`/pairings/${pairing.id}`);
        setPairing((prev) => (prev ? { ...prev, ...result.pairing } : result.pairing));
        if (result.pairing.status === 'expired' || result.pairing.status === 'cancelled') {
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      } catch {
        // Keep polling; transient network errors are expected.
      }
    };
    void check();
    pollRef.current = window.setInterval(check, 2500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, pairing?.id, step]);

  const createPairing = async () => {
    if (!family || childName.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<PairingResponse>('/pairings', {
        method: 'POST',
        body: { familyId: family.id, childName: childName.trim() },
      });
      setPairing(result.pairing);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a pairing code');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!pairing) return;
    setApproving(true);
    setError(null);
    try {
      const result = await apiFetch<{ pairing: Pairing; device: Device }>(`/pairings/${pairing.id}/approve`, {
        method: 'POST',
      });
      setLinkedDevice(result.device);
      setStep('linked');
      await refresh();
      toast.success(`${result.device.name} linked`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the pairing');
    } finally {
      setApproving(false);
    }
  };

  const cancelPairing = async () => {
    if (pairing && (pairing.status === 'waiting_child' || pairing.status === 'awaiting_parent')) {
      await apiFetch(`/pairings/${pairing.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  };

  const close = () => {
    void cancelPairing();
    onClose();
  };

  const copyCode = async () => {
    if (!pairing?.code) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      toast.success(t('common.copied'));
    } catch {
      toast.error('Copy is not available in this browser');
    }
  };

  const childUrl = pairing?.code ? `${window.location.origin}/child?code=${encodeURIComponent(pairing.code)}` : '#';

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'linked' ? t('child.linkedTo', { name: linkedDevice?.childName ?? childName }) : t('dashboard.addDevice')}
      subtitle={step === 'name' ? 'A short-lived code keeps the link private' : undefined}
      size="md"
      dismissable={step !== 'linked'}
      footer={
        step === 'name' ? (
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={childName.trim().length < 2} onClick={() => void createPairing()} icon={<QrCode size={17} />}>
              {busy ? t('common.saving') : 'Create code'}
            </Button>
          </>
        ) : step === 'linked' ? (
          <Button onClick={close} icon={<Check size={17} />}>
            {t('common.done')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
        )
      }
    >
      {step === 'name' ? (
        <div className="pairing-name">
          <div className="pairing-illustration" aria-hidden>
            <span className="illus-phone">
              <Smartphone size={30} />
            </span>
            <span className="illus-link" />
            <span className="illus-parent">
              <ShieldCheck size={30} />
            </span>
          </div>
          <p className="pairing-copy">
            Pair the child’s phone with your family. You will approve the device before any data starts flowing.
          </p>
          <Field label={t('auth.name')} htmlFor="pairing-child-name">
            <div className="input-with-icon">
              <UserRound size={17} />
              <input
                id="pairing-child-name"
                className="input"
                value={childName}
                maxLength={60}
                autoFocus
                placeholder="e.g. Aarav"
                onChange={(event) => setChildName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && childName.trim().length >= 2) void createPairing();
                }}
              />
            </div>
          </Field>
          <Notice tone="info" icon={<ShieldCheck size={18} />}>
            Codes expire after 10 minutes. Only one device can use a code, and the child sees a visible pairing screen.
          </Notice>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : step === 'code' && pairing ? (
        <div className="pairing-code">
          <div className="code-row">
            <span className="code-value">{pairing.code}</span>
            <Button variant="secondary" size="sm" onClick={() => void copyCode()} icon={<Copy size={15} />}>
              {t('common.copy')}
            </Button>
          </div>

          <div className="qr-wrap">
            {qr ? <img src={qr} alt="Pairing QR code" className="qr-image" /> : <Spinner size={22} />}
            <div className="qr-copy">
              <strong>Scan on the child phone</strong>
              <p>Open Suraksha Child → “Pair with your parent”, then scan this code or type the 6 characters.</p>
              <a className="text-link" href={childUrl} target="_blank" rel="noreferrer">
                {t('child.browserPreview')} <ExternalLink size={14} />
              </a>
            </div>
          </div>

          <div className={`pairing-status status-${pairing.status}`}>
            {pairing.status === 'waiting_child' ? (
              <>
                <Spinner size={16} /> Waiting for the child device to enter the code…
              </>
            ) : pairing.status === 'awaiting_parent' ? (
              <>
                <span className="status-dot" />
                <div>
                  <strong>The child device is ready</strong>
                  <p>Approve it to link {pairing.childName}. No data is collected before you approve.</p>
                </div>
              </>
            ) : pairing.status === 'expired' ? (
              <>
                <RefreshCw size={16} /> This code expired. Close and create a new code.
              </>
            ) : (
              <>Pairing {pairing.status}</>
            )}
          </div>

          {pairing.status === 'awaiting_parent' ? (
            <Button block loading={approving} onClick={() => void approve()} icon={<ShieldCheck size={17} />}>
              {approving ? t('common.saving') : `Approve ${pairing.childName}`}
            </Button>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : step === 'linked' ? (
        <div className="pairing-linked">
          <span className="success-orb">
            <Check size={30} />
          </span>
          <h3>{linkedDevice?.name ?? childName} is linked</h3>
          <p>
            Location sharing, screen-time summaries and session requests are available. Camera, microphone and screen sharing still need your child’s
            approval each time.
          </p>
          <Button variant="secondary" block onClick={close}>
            {t('common.done')}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
