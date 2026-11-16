import { defineConfig } from 'vitest/config';

// GitHub Pages liefert die Seite unter /storyrower/ aus.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/storyrower/' : '/',
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      // Die alte PoC-Testseite bleibt unter /poc/ble/ erreichbar
      input: { main: 'index.html', poc: 'poc/ble/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
