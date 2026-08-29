import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { DEMO_MODE } from './lib/api';
import './index.css';

// Static hosts such as GitHub Pages cannot rewrite deep links to index.html,
// so the demo build routes on the hash instead.
const Router = DEMO_MODE ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);
