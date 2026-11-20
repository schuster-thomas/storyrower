import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

function gitCommit() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

// GitHub Pages serves the site under /storyrower/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/storyrower/' : '/',
  server: { host: true, port: 5173 },
  define: { __BUILD__: JSON.stringify(`${gitCommit()} ${new Date().toISOString().slice(0, 16)}Z`) },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
