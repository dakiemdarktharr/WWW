import { ArrowLeft } from 'lucide-react';
import PasswordRecovery from './PasswordRecovery';
import { PortalLocaleProvider, usePortalLocale } from './PortalLocale';
import { PortalThemeProvider, PortalThemeToggle } from './PortalTheme';
import './billing.css';

function RecoveryContent() {
  const { locale } = usePortalLocale();
  return (
    <main className="billing-page recovery-page">
      <header className="billing-header">
        <a className="billing-brand" href="/" aria-label="Kivuno">
          <img src="/kivuno.svg" alt="" /> Kivuno
        </a>
        <div className="billing-header-actions">
          <PortalThemeToggle />
          <a className="billing-back" href="/?login">
            <ArrowLeft size={16} />
            {locale === 'vi' ? 'Đăng nhập' : 'Log in'}
          </a>
        </div>
      </header>
      <section className="billing-panel recovery-page-panel">
        <PasswordRecovery reset={location.pathname === '/reset-password'} />
      </section>
    </main>
  );
}

export default function PasswordRecoveryPage() {
  return (
    <PortalLocaleProvider>
      <PortalThemeProvider>
        <RecoveryContent />
      </PortalThemeProvider>
    </PortalLocaleProvider>
  );
}
