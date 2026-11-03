import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import App from './App';
import RunnerBridge from './RunnerBridge';
import { localHostname } from '../shared/browser-bridge';
import './styles.css';
import './components.css';
import './foundation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {localHostname(window.location.hostname) && window.location.hash === '#connect' ? (
      <RunnerBridge />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
