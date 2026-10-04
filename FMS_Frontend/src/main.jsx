import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { PhaseScopeProvider } from './phase/PhaseScope.jsx';
import './index.css';
import { installGlobalHandlers } from './lib/reporting.js';

// Before the first render, so an error during mount is still reported.
installGlobalHandlers();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          {/* Inside AuthProvider: the phase list is an authenticated call, and
              outside it the provider would fire a pointless 401 on the login
              page and on the student flow, which never signs in at all. */}
          <AuthProvider>
            <PhaseScopeProvider>
              <App />
            </PhaseScopeProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
