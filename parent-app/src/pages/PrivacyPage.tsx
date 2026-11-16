import { Link } from 'react-router-dom';
import { ArrowLeft, Database, Eye, Lock, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useI18n } from '../i18n';
import { PageHeader } from '../ui';

const DATA_ROWS = [
  ['Account', 'Name, email, phone, hashed password, locale', 'Until you delete the account'],
  ['Family', 'Family name, members, roles, invites', 'Until you delete the account or leave'],
  ['Devices', 'Device model, Android version, battery, network, last seen', 'While the device is linked'],
  ['Location', 'Coordinates with accuracy and timestamp', '30 days (configurable, then deleted)'],
  ['Usage', 'App names, categories and daily minutes from the child app', '180 days'],
  ['Safety events', 'Alert titles, details, device and time', '180 days'],
  ['Sessions', 'Kind, reason, requester, approval, start, end, who stopped', 'Retained in access history'],
  ['Audit', 'Session, pairing and permission actions', 'Retained for accountability'],
  ['Media', 'Camera, microphone and screen streams', 'Not recorded by default'],
];

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <div className="page privacy-page">
      <PageHeader title={t('privacy.title')} subtitle={t('privacy.updated')} />

      <section className="privacy-hero card">
        <span className="privacy-shield">
          <ShieldCheck size={34} />
        </span>
        <div>
          <h2>Consent-based by design</h2>
          <p>{t('privacy.p1')}</p>
        </div>
      </section>

      <div className="privacy-grid">
        <article className="privacy-card card">
          <Eye size={20} />
          <h3>Visible, never hidden</h3>
          <p>{t('privacy.p3')}</p>
        </article>
        <article className="privacy-card card">
          <Lock size={20} />
          <h3>Encrypted in transit</h3>
          <p>{t('privacy.p2')}</p>
        </article>
        <article className="privacy-card card">
          <Database size={20} />
          <h3>Data we store</h3>
          <p>{t('privacy.p4')}</p>
        </article>
        <article className="privacy-card card">
          <Users size={20} />
          <h3>Family roles</h3>
          <p>
            Owners and parents can manage devices and limits. Caregivers can view safety information and request approved sessions. Every member is
            visible to every other member.
          </p>
        </article>
      </div>

      <h2 className="privacy-heading">What is stored, and for how long</h2>
      <div className="table-wrap card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Examples</th>
              <th>Retention</th>
            </tr>
          </thead>
          <tbody>
            {DATA_ROWS.map(([name, example, retention]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{example}</td>
                <td>{retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="privacy-heading">Your rights</h2>
      <div className="rights-list card">
        <div>
          <Trash2 size={18} />
          <p>
            <strong>Export or delete.</strong> Download a JSON copy of your data, or delete your account, under Settings → Privacy. Deleting an account
            transfers ownership where possible or removes the family data.
          </p>
        </div>
        <div>
          <ShieldCheck size={18} />
          <p>
            <strong>Revoke a device.</strong> Unlinking revokes child-device refresh tokens immediately and notifies the child app.
          </p>
        </div>
        <div>
          <Lock size={18} />
          <p>
            <strong>No surveillance extras.</strong> We do not hide the app, suppress privacy indicators, read encrypted messages, bypass consent, or
            record camera/screen sessions by default.
          </p>
        </div>
      </div>

      <h2 className="privacy-heading">Before you publish</h2>
      <p className="privacy-text">{t('privacy.legal')}</p>

      <div className="privacy-footer">
        <Link to="/settings" className="link-btn">
          <ArrowLeft size={15} /> Back to settings
        </Link>
        <a href="mailto:privacy@suraksha.example" className="link-btn">
          privacy@suraksha.example
        </a>
      </div>
    </div>
  );
}
