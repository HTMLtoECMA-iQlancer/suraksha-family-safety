import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { DevicesProvider } from './devices';
import { I18nProvider, useI18n } from './i18n';
import { RealtimeProvider } from './realtime';
import { AppShell } from './Shell';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import { Spinner } from './ui';
import { ContentSafetyPage } from './pages/ContentSafetyPage';
import { ChildPreviewPage } from './pages/ChildPreviewPage';
import { DashboardPage } from './pages/DashboardPage';
import { EventsPage } from './pages/EventsPage';
import { FamilyPage } from './pages/FamilyPage';
import { HelpPage } from './pages/HelpPage';
import { LocationPage } from './pages/LocationPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { SafeBrowsingPage } from './pages/SafeBrowsingPage';
import { ScreenTimePage } from './pages/ScreenTimePage';
import { SessionsPage } from './pages/SessionsPage';
import { SettingsPage } from './pages/SettingsPage';

function BootScreen() {
  const { t } = useI18n();
  return (
    <div className="boot-screen">
      <span className="brand-mark large">
        <ShieldCheck size={30} />
      </span>
      <strong>Suraksha</strong>
      <Spinner size={20} label={t('common.loading')} />
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <BootScreen />;
  if (status === 'guest') {
    return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <RealtimeProvider>
                <DevicesProvider>
                  <Routes>
                    <Route path="/child" element={<ChildPreviewPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                      path="/privacy"
                      element={
                        <div className="standalone-page">
                          <PrivacyPage />
                        </div>
                      }
                    />
                    <Route
                      path="/"
                      element={
                        <Protected>
                          <AppShell />
                        </Protected>
                      }
                    >
                      <Route index element={<DashboardPage />} />
                      <Route path="location" element={<LocationPage />} />
                      <Route path="family" element={<FamilyPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="screen-time" element={<ScreenTimePage />} />
                      <Route path="events" element={<EventsPage />} />
                      <Route path="notifications" element={<NotificationsPage />} />
                      <Route path="permissions" element={<PermissionsPage />} />
                      <Route path="safe-browsing" element={<SafeBrowsingPage />} />
                      <Route path="content-safety" element={<ContentSafetyPage />} />
                      <Route path="sessions" element={<SessionsPage />} />
                      <Route path="help" element={<HelpPage />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </DevicesProvider>
              </RealtimeProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
