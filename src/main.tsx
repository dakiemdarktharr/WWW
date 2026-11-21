import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import './components.css';
import './foundation.css';
import { WorkspaceThemeProvider } from './WorkspaceTheme';

const App = lazy(() => import('./App'));
const PublicRouter = lazy(() => import('./PublicRouter'));
const DesktopGate = lazy(() => import('./DesktopGate'));
const PasswordRecoveryPage = lazy(() => import('./PasswordRecoveryPage'));
const ClaudeConsent = lazy(() => import('./ClaudeConsent'));

const content = (
  <Suspense fallback={null}>
    {window.relayDesktop ? (
      <DesktopGate />
    ) : window.location.pathname === '/claude/connect' ? (
      <ClaudeConsent />
    ) : ['/forgot-password', '/reset-password'].includes(window.location.pathname) ? (
      <PasswordRecoveryPage />
    ) : window.location.pathname === '/billing' ? (
      <PublicRouter />
    ) : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname) &&
      !new URLSearchParams(location.search).has('portal') ? (
      <App />
    ) : (
      <PublicRouter />
    )}
  </Suspense>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.relayDesktop ? <WorkspaceThemeProvider>{content}</WorkspaceThemeProvider> : content}
  </React.StrictMode>,
);
