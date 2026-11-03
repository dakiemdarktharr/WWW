import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/400.css';
import App from './App';
import CloudWorkspace from './CloudWorkspace';
import './styles.css';
import './components.css';
import './foundation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname) ? (
      <App />
    ) : (
      <CloudWorkspace />
    )}
  </React.StrictMode>,
);
