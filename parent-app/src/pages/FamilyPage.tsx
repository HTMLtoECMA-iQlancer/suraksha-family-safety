import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  KeyRound,
  MailPlus,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import type { FamilyMember, UserRole } from '@suraksha/shared';
import { ROLE_LABELS } from '@suraksha/shared';
import { apiFetch, ApiError } from '../api';
import type { AuditResponse, MembersResponse } from '../api';
import { useAuth } from '../auth';
import { useDevices } from '../devices';
import { dateTime } from '../format';
import { useI18n } from '../i18n';
import { useRealtimeMessage } from '../realtime';
import { useToast } from '../toast';
import {
  Avatar,
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
} from '../ui';

export function FamilyPage() {
  const { t, locale } = useI18n();
  const { user, family, refreshMe } = useAuth();
  const { devices, refresh: refreshDevices, loading: devicesLoading } = useDevices();
  const toast = useToast();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [audit, setAudit] = useState<AuditResponse['audit']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canInvite = family?.role === 'owner' || family?.role === 'parent';
  const isOwner = family?.role === 'owner';

  const load = useCallback(async () => {
    if (!family) return;
    try {
      const [memberData, auditData] = await Promise.all([
        apiFetch<MembersResponse>(`/families/${family.id}/members`),
        apiFetch<AuditResponse>(`/families/${family.id}/audit`).catch(() => ({ audit: [] })),
      ]);
      setMembers(memberData.members);
      setAudit(auditData.audit);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the family');
    } finally {
      setLoading(false);
    }
  }, [family]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeMessage((message) => {
    if (message.type === 'family.changed') void load();
  });

  const changeRole = async (member: FamilyMember, role: UserRole) => {
    if (!family) return;
    setBusy(true);
    try {
      await apiFetch(`/families/${family.id}/members/${member.id}`, { method: 'PATCH', body: { role } });
      setMembers((prev) => prev.map((item) => (item.id === member.id ? { ...item, role } : item)));
      toast.success(t('common.done'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async () => {
    if (!family || !removing) return;
    setBusy(true);
    try {
      await apiFetch(`/families/${family.id}/members/${removing.id}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((item) => item.id !== removing.id));
      toast.success(t('common.done'));
      setRemoving(null);
      await refreshMe();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!unlinking) return;
    setBusy(true);
    try {
      await apiFetch(`/devices/${unlinking}`, { method: 'DELETE' });
      await refreshDevices();
      toast.success(t('family.unlink'));
      setUnlinking(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!family) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton height={28} width="35%" />
        <Skeleton height={260} />
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

  const active = members.filter((member) => member.status === 'active');
  const invited = members.filter((member) => member.status === 'invited');
  const unlinkTarget = devices.find((device) => device.id === unlinking);

  return (
    <div className="page">
      <PageHeader
        title={t('family.title')}
        subtitle={`${family.name} · ${t('family.subtitle')}`}
        actions={
          canInvite ? (
            <Button size="sm" onClick={() => setInviteOpen(true)} icon={<MailPlus size={16} />}>
              {t('family.invite')}
            </Button>
          ) : undefined
        }
      />

      <Notice tone="brand" icon={<ShieldCheck size={18} />}>
        {t('family.accessNote')}
      </Notice>

      <SectionHeader title={`${t('family.members')} · ${active.length}`} />
      <div className="member-list card">
        {active.map((member) => {
          const self = member.userId === user?.id;
          return (
            <div key={member.id} className="member-row">
              <Avatar name={member.displayName} size={42} />
              <div className="member-text">
                <strong>
                  {member.displayName} {self ? <span className="you-tag">{t('family.you')}</span> : null}
                </strong>
                <small>{member.email}</small>
              </div>
              {isOwner && member.role !== 'owner' && !self ? (
                <select
                  className="select compact"
                  value={member.role}
                  disabled={busy}
                  onChange={(event) => void changeRole(member, event.target.value as UserRole)}
                  aria-label={t('family.inviteRole')}
                >
                  <option value="parent">{t('family.roleParent')}</option>
                  <option value="caregiver">{t('family.roleCaregiver')}</option>
                </select>
              ) : (
                <Pill tone={member.role === 'owner' ? 'brand' : member.role === 'parent' ? 'info' : 'neutral'}>
                  {member.role === 'owner' ? t('family.roleOwner') : member.role === 'parent' ? t('family.roleParent') : t('family.roleCaregiver')}
                </Pill>
              )}
              {member.role !== 'owner' && (isOwner || self) ? (
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={self ? t('settings.signOut') : t('family.removeMember')}
                  onClick={() => setRemoving(member)}
                >
                  <UserMinus size={17} />
                </button>
              ) : null}
            </div>
          );
        })}
        {active.length === 0 ? <EmptyState icon={<Users size={20} />} title={t('family.noMembers')} /> : null}
      </div>

      {invited.length ? (
        <>
          <SectionHeader title={`${t('family.pending')} · ${invited.length}`} />
          <div className="member-list card">
            {invited.map((member) => (
              <div key={member.id} className="member-row">
                <Avatar name={member.displayName} size={42} />
                <div className="member-text">
                  <strong>{member.displayName}</strong>
                  <small>{member.email}</small>
                </div>
                <Pill tone="warning">{t('family.pending')}</Pill>
                <button type="button" className="icon-btn danger" aria-label={t('family.removeMember')} onClick={() => setRemoving(member)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionHeader title={t('family.devices')} />
      <div className="member-list card">
        {devices.map((device) => (
          <div key={device.id} className="member-row">
            <span className="device-row-icon">
              <Smartphone size={20} />
            </span>
            <div className="member-text">
              <strong>{device.name}</strong>
              <small>
                {device.model} · {device.online ? t('common.online') : t('common.offline')} · {device.lastSeenAt ? dateTime(device.lastSeenAt, locale) : '—'}
              </small>
            </div>
            <Pill tone={device.online ? 'success' : 'neutral'}>{device.platform}</Pill>
            <button type="button" className="icon-btn danger" aria-label={t('family.unlink')} onClick={() => setUnlinking(device.id)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {!devices.length && !devicesLoading ? <EmptyState icon={<Smartphone size={20} />} title={t('dashboard.addDevice')} /> : null}
      </div>

      <SectionHeader
        title={
          <span className="inline-title">
            <ScrollText size={17} /> {locale === 'gu' ? 'એક્સેસ ઓડિટ' : 'Access & audit'}
          </span>
        }
      />
      <div className="audit-list card">
        {audit.slice(0, 10).map((entry) => (
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
        <p className="audit-note">
          {locale === 'gu'
            ? 'સેશન વિનંતી, મંજૂરી, નકાર અને બંધ કરવાની દરેક ક્રિયા નોંધાય છે.'
            : 'Every session request, approval, denial and stop is written to this permanent audit history.'}
        </p>
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          void load();
        }}
        familyId={family.id}
        canInviteParent={isOwner}
      />

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={removing?.userId === user?.id ? (locale === 'gu' ? 'પરિવાર છોડવો છે?' : 'Leave the family?') : t('family.removeMember')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void removeMember()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('family.removeConfirm', { name: removing?.displayName ?? '' })}</p>
      </Modal>

      <Modal
        open={Boolean(unlinking)}
        onClose={() => setUnlinking(null)}
        title={t('family.unlink')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnlinking(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void unlink()}>
              {t('family.unlink')}
            </Button>
          </>
        }
      >
        <p>{t('family.unlinkConfirm', { name: unlinkTarget?.name ?? '' })}</p>
      </Modal>
    </div>
  );
}

function InviteModal({
  open,
  onClose,
  familyId,
  canInviteParent,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  canInviteParent: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('caregiver');
  const [invite, setInvite] = useState<{ email: string; role: string; code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInvite(null);
      setEmail('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ invite: { email: string; role: string; code: string; expiresAt: string } }>(
        `/families/${familyId}/invites`,
        { method: 'POST', body: { email: email.trim().toLowerCase(), role } },
      );
      setInvite(result.invite);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      toast.success(t('common.copied'));
    } catch {
      toast.error('Copy is not available');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={invite ? t('family.inviteCreated') : t('family.invite')}
      size="sm"
      footer={
        invite ? (
          <Button onClick={onClose}>{t('common.done')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={!email.includes('@')} onClick={() => void submit()}>
              {t('family.invite')}
            </Button>
          </>
        )
      }
    >
      {invite ? (
        <div className="stack invite-result">
          <span className="success-orb small">
            <KeyRound size={22} />
          </span>
          <p>{t('family.inviteHint', { email: invite.email })}</p>
          <div className="code-row">
            <span className="code-value small">{invite.code}</span>
            <Button variant="secondary" size="sm" onClick={() => void copy()} icon={<Copy size={15} />}>
              {t('common.copy')}
            </Button>
          </div>
          <p className="muted">{t('family.pending')} · {ROLE_LABELS[invite.role as UserRole]}</p>
        </div>
      ) : (
        <div className="stack">
          <Field label={t('family.inviteEmail')}>
            <input
              className="input"
              type="email"
              value={email}
              placeholder="nani@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t('family.inviteRole')}>
            <select className="select" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="caregiver">{t('family.roleCaregiver')}</option>
              {canInviteParent ? <option value="parent">{t('family.roleParent')}</option> : null}
            </select>
          </Field>
          <Notice tone="info">{t('family.accessNote')}</Notice>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
