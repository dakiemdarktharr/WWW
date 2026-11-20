import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import './components.css';
import './foundation.css';

const App = lazy(() => import('./App'));
const PublicRouter = lazy(() => import('./PublicRouter'));
const DesktopGate = lazy(() => import('./DesktopGate'));
const PasswordRecoveryPage = lazy(() => import('./PasswordRecoveryPage'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {window.relayDesktop ? (
        <DesktopGate />
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
  </React.StrictMode>,
);
