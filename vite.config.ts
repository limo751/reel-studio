import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages liefert die Seite unter /<repo-name>/ aus.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
});
