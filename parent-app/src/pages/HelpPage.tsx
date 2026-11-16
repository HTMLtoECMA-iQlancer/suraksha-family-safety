import { Link } from 'react-router-dom';
import {
  ChevronRight,
  CircleHelp,
  LifeBuoy,
  Mail,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { Notice, PageHeader, SectionHeader } from '../ui';

const FAQ = [
  { icon: Smartphone, q: 'help.setup', a: 'help.setupBody' },
  { icon: Video, q: 'help.sessions', a: 'help.sessionsBody' },
  { icon: ShieldCheck, q: 'help.permissions', a: 'help.permissionsBody' },
  { icon: TriangleAlert, q: 'help.background', a: 'help.backgroundBody' },
  { icon: Video, q: 'help.turn', a: 'help.turnBody' },
  { icon: ShieldCheck, q: 'help.limits', a: 'help.limitsBody' },
] as const;

export function HelpPage() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader title={t('help.title')} subtitle={t('help.contactBody')} />

      <section className="help-hero card">
        <span className="help-orb">
          <LifeBuoy size={32} />
        </span>
        <div>
          <h2>{t('help.title')}</h2>
          <p>{t('help.setupBody')}</p>
        </div>
      </section>

      <SectionHeader title="Common questions" />
      <div className="faq-list">
        {FAQ.map((item) => {
          const Icon = item.icon;
          return (
            <details key={item.q} className="faq card">
              <summary>
                <span className="faq-icon">
                  <Icon size={18} />
                </span>
                <span>{t(item.q)}</span>
                <ChevronRight size={17} className="faq-chevron" />
              </summary>
              <p>{t(item.a)}</p>
            </details>
          );
        })}
      </div>

      <SectionHeader title={t('permissions.title')} />
      <div className="help-links">
        <Link to="/permissions" className="help-link card">
          <ShieldCheck size={20} />
          <span>
            <strong>{t('dashboard.requiredPermissions')}</strong>
            <small>{t('permissions.subtitle')}</small>
          </span>
          <ChevronRight size={16} />
        </Link>
        <Link to="/privacy" className="help-link card">
          <CircleHelp size={20} />
          <span>
            <strong>{t('settings.privacyPolicy')}</strong>
            <small>{t('privacy.updated')}</small>
          </span>
          <ChevronRight size={16} />
        </Link>
      </div>

      <Notice tone="brand" icon={<Mail size={18} />}>
        <strong>{t('help.contact')}</strong> {t('help.contactBody')}{' '}
        <a className="inline-link" href="mailto:support@suraksha.example">
          support@suraksha.example
        </a>
      </Notice>

      <p className="audit-note">
        Suraksha never asks you to disable Android privacy indicators, hide the app icon, or approve a session on someone else’s behalf.
      </p>
    </div>
  );
}
