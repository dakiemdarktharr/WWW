import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import './components.css';
import './foundation.css';

const App = lazy(() => import('./App'));
const Portal = lazy(() => import('./Portal'));
const DesktopGate = lazy(() => import('./DesktopGate'));
const Billing = lazy(() => import('./Billing'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {window.relayDesktop ? (
        <DesktopGate />
      ) : window.location.pathname === '/billing' ? (
        <Billing />
      ) : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname) &&
        !new URLSearchParams(location.search).has('portal') ? (
        <App />
      ) : (
        <Portal />
      )}
    </Suspense>
  </React.StrictMode>,
);
