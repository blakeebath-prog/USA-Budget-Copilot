import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const USASPENDING = process.env.VITE_USASPENDING_BASE ?? 'https://api.usaspending.gov';
const FISCALDATA = process.env.VITE_FISCALDATA_BASE ?? 'https://api.fiscaldata.treasury.gov';

/**
 * The dev server proxies both upstream APIs so the browser never makes a
 * cross-origin request. Both APIs do send permissive CORS headers, so
 * VITE_DATA_MODE=direct also works — the proxy is the failure-proof default.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/proxy/usaspending': {
        target: USASPENDING,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/usaspending/, ''),
      },
      '/proxy/fiscaldata': {
        target: FISCALDATA,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/fiscaldata/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
