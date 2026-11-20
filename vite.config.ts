import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /storyrower/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/storyrower/' : '/',
  server: { host: true, port: 5173 },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
