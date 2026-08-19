import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const USASPENDING = process.env.VITE_USASPENDING_BASE ?? 'https://api.usaspending.gov';
const FISCALDATA = process.env.VITE_FISCALDATA_BASE ?? 'https://api.fiscaldata.treasury.gov';

/**
 * The dev server proxies both upstream APIs so the browser never makes a
 * cross-origin request. Both APIs do send permissive CORS headers, so
 * VITE_DATA_MODE=direct also works — the proxy is the failure-proof default.
 *
 * The `/api/...` prefixes match the serverless functions in `api/`, so proxy
 * mode behaves identically here and on Vercel.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/usaspending': {
        target: USASPENDING,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/usaspending/, ''),
      },
      '/api/fiscaldata': {
        target: FISCALDATA,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fiscaldata/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'api/**/*.test.js'],
  },
});
