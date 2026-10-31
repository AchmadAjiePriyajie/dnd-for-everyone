import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Font dibundel bersama build (tanpa CDN): host LAN tetap jalan tanpa internet.
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/crimson-pro/latin-400.css';
import '@fontsource/crimson-pro/latin-600.css';
import { App } from './app/App';
import './app/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
