import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /storyrower/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/storyrower/' : '/',
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      // The old PoC test page stays available at /poc/ble/
      input: { main: 'index.html', poc: 'poc/ble/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
