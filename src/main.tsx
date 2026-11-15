import { render } from 'preact';
import { loadLibrary } from './media/library';
import { loadProjects } from './model/store';
import { App } from './ui/app';
import './ui/styles.css';

async function start() {
  const root = document.getElementById('app')!;
  const missing: string[] = [];
  if (typeof VideoEncoder === 'undefined') missing.push('WebCodecs (Video)');
  if (!document.createElement('canvas').getContext('webgl2')) missing.push('WebGL 2');
  if (typeof indexedDB === 'undefined') missing.push('IndexedDB');
  if (missing.length) {
    root.innerHTML = `<div class="empty"><h2>Browser zu alt</h2><p class="note">Reel Studio braucht ${missing.join(', ')}. Bitte Safari ab iOS 17 bzw. einen aktuellen Chrome verwenden.</p></div>`;
    return;
  }
  await Promise.all([loadProjects(), loadLibrary()]);
  render(<App />, root);
}

void start();

// Nur in der Entwicklung: Hilfsfunktionen für automatische Tests
if (import.meta.env.DEV) {
  void Promise.all([import('./media/library'), import('./model/store')]).then(([lib, store]) => {
    (window as unknown as Record<string, unknown>).__reel = { lib, store };
  });
}

// Offline-Fähigkeit und Home-Bildschirm-App
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js'));
}
