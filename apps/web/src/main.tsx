import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui';
import { LangRoot } from './lib/i18n';

// After a new version is deployed, a page that was already open still points at the old version's
// files, which no longer exist. Reload once to pick up the new version instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('arena.reloadedAt') ?? 0);
    if (Date.now() - last < 30_000) return; // already tried: let the normal error show
    sessionStorage.setItem('arena.reloadedAt', String(Date.now()));
  } catch {
    // storage blocked: still reload once
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <LangRoot>
          <App />
        </LangRoot>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
