import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Self-hosted fonts (no Google Fonts CDN — offline-capable, no FOUT).
// Family names match tailwind.config.js: "Inter" and "JetBrains Mono".
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import './index.css';

// Inside the Windows 11 Electron shell the window has a native acrylic backdrop
// (see electron/main.ts). Flag the document so index.css makes the app's base
// layer translucent (frosted glass) and plays the intro fade. In a plain
// browser this class is absent → the app stays fully opaque (safe fallback).
{
  const ua = navigator.userAgent;
  if (ua.includes('Electron') && ua.includes('Windows')) {
    document.documentElement.classList.add('acrylic');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
