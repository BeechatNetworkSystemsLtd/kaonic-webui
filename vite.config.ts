import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The build is a plain static bundle. kaonic-hub serves `dist/` from `/` and
// must fall back to `index.html` for unknown paths (client-side routing).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The device is offline: everything the UI needs must be in the bundle.
    assetsInlineLimit: 0,
  },
  server: {
    // Set VITE_HUB_URL to proxy API calls to a real hub during development.
    // The hub accepts writes only from its own origin, so the proxy presents that one.
    proxy: process.env.VITE_HUB_URL
      ? {
          '/api': {
            target: process.env.VITE_HUB_URL,
            changeOrigin: true,
            secure: false,
            ws: true,
            headers: { origin: new URL(process.env.VITE_HUB_URL).origin },
          },
        }
      : undefined,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
