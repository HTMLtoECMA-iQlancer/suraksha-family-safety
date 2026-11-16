import { useCallback, useEffect, useState } from 'react';
import { EyeOff, Globe2, Lock, Plus, ShieldCheck, ShieldOff, X } from 'lucide-react';
import type { PolicyMap } from '@suraksha/shared';
import { apiFetch, ApiError, updatePolicy } from '../api';
import type { PoliciesResponse } from '../api';
import { useDevices } from '../devices';
import { useI18n } from '../i18n';
import { useToast } from '../toast';
import {
  Button,
  ErrorState,
  Notice,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toggle,
} from '../ui';

const CATEGORIES = [
  { key: 'adult', labelKey: 'browsing.categoryAdult' },
  { key: 'gambling', labelKey: 'browsing.categoryGambling' },
  { key: 'violence', labelKey: 'browsing.categoryViolence' },
  { key: 'social', labelKey: 'browsing.categorySocial' },
] as const;

export function SafeBrowsingPage() {
  const { t } = useI18n();
  const { selected } = useDevices();
  const toast = useToast();
  const [policy, setPolicy] = useState<PolicyMap['safe_browsing'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState('');

  const load = useCallback(async () => {
    if (!selected) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<PoliciesResponse>(`/devices/${selected.id}/policies`);
      setPolicy(data.policies.safe_browsing);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load browsing rules');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const save = async (next: PolicyMap['safe_browsing']) => {
    if (!selected) return;
    setPolicy(next);
    setBusy(true);
    try {
      await updatePolicy(selected.id, 'safe_browsing', next);
      toast.success(t('common.done'));
    } catch (err) {
      await load();
      toast.error(err instanceof ApiError ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
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

  if (error || !policy) {
    return (
      <div className="page">
        <ErrorState message={error ?? 'Could not load browsing rules'} onRetry={() => void load()} />
      </div>
    );
  }

  const addDomain = () => {
    const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleaned || !cleaned.includes('.')) return;
    if (policy.allowList.includes(cleaned)) {
      setDomain('');
      return;
    }
    void save({ ...policy, allowList: [...policy.allowList, cleaned] });
    setDomain('');
  };

  return (
    <div className="page">
      <PageHeader
        title={t('browsing.title')}
        subtitle={`${selected.childName} · ${t('browsing.subtitle')}`}
        actions={
          <Toggle
            label={t('browsing.enabled')}
            checked={policy.enabled}
            disabled={busy}
            onChange={(next) => void save({ ...policy, enabled: next })}
          />
        }
      />

      <section className={`safe-hero card${policy.enabled ? ' on' : ''}`}>
        <span className="safe-shield">{policy.enabled ? <ShieldCheck size={38} /> : <ShieldOff size={38} />}</span>
        <div>
          <h2>{policy.enabled ? t('browsing.statusOn') : t('browsing.statusOff')}</h2>
          <p>{t('browsing.osNote')}</p>
        </div>
      </section>

      <SectionHeader title={t('browsing.method')} />
      <div className="card method-list">
        {(
          [
            ['dns', t('browsing.methodDns'), 'Android Private DNS hostname — works in every browser.'],
            ['vpn', t('browsing.methodVpn'), 'A local VPN filter — needs VPN consent on every restart.'],
            ['browser-extension', t('browsing.methodExtension'), 'Only inside a browser that supports the filter extension.'],
          ] as const
        ).map(([key, label, description]) => (
          <button
            key={key}
            type="button"
            className={`method-row${policy.method === key ? ' selected' : ''}`}
            onClick={() => void save({ ...policy, method: key })}
            disabled={busy}
          >
            <span className="radio-dot" />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>

      <SectionHeader title={t('browsing.blockedCategories')} />
      <div className="card category-grid">
        {CATEGORIES.map((category) => {
          const checked = policy.blockedCategories.includes(category.key);
          return (
            <label key={category.key} className={`category-check${checked ? ' checked' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  void save({
                    ...policy,
                    blockedCategories: event.target.checked
                      ? [...policy.blockedCategories, category.key]
                      : policy.blockedCategories.filter((item) => item !== category.key),
                  })
                }
              />
              <span className="check-box">{checked ? '✓' : ''}</span>
              {t(category.labelKey)}
            </label>
          );
        })}
      </div>

      <SectionHeader title={t('browsing.allowList')} />
      <div className="card">
        <div className="domain-add">
          <input
            className="input"
            value={domain}
            placeholder="school.example.edu"
            onChange={(event) => setDomain(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addDomain();
            }}
          />
          <Button variant="secondary" onClick={addDomain} icon={<Plus size={16} />} disabled={busy}>
            {t('common.add')}
          </Button>
        </div>
        <div className="tag-wrap">
          {policy.allowList.map((item) => (
            <span key={item} className="domain-tag">
              <Globe2 size={13} /> {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => void save({ ...policy, allowList: policy.allowList.filter((entry) => entry !== item) })}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {!policy.allowList.length ? <p className="muted">{t('common.noData')}</p> : null}
        </div>
      </div>

      <Notice tone="warning" icon={<Lock size={18} />}>
        <strong>{t('browsing.history')}: </strong>
        {t('browsing.historyNote')}
      </Notice>

      <div className="card browsing-history">
        <span className="history-lock">
          <EyeOff size={24} />
        </span>
        <div>
          <strong>{t('browsing.history')}</strong>
          <p>{t('browsing.historyNote')}</p>
        </div>
        <span className="mini-badge">{t('common.notAllowed')}</span>
      </div>

      <Notice tone="info">
        {t('browsing.osNote')} {t('help.limitsBody')}
      </Notice>
    </div>
  );
}
