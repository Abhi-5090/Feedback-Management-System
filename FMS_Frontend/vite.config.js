import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The API base is read from VITE_API_URL at build/dev time. In dev we also
// proxy /api to the backend so cookies are first-party (same origin).
//
// NOTE: vite does NOT put .env values on `process.env` for this config file, so
// we must loadEnv() explicitly — otherwise VITE_API_PROXY in .env is silently
// ignored and the proxy keeps pointing at the default port (which surfaces in
// the browser as a confusing 500 from the dev server).
export default defineConfig(({ mode }) => {
  const envVars = loadEnv(mode, process.cwd(), '');
  const apiTarget = envVars.VITE_API_PROXY || 'http://localhost:5550';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: false,
      include: ['src/**/*.{test,spec}.{js,jsx}'],
    },
    build: {
      rollupOptions: {
        output: {
          // Split heavy, rarely-changing vendor libs into their own long-cached
          // chunks so an app-code change doesn't force users to re-download them,
          // and the charting/animation weight isn't in the initial bundle.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            motion: ['framer-motion'],
          },
        },
      },
    },
  };
});
