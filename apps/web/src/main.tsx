import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui';
import { LangRoot } from './lib/i18n';

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
