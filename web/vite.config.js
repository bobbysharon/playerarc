import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Stamped at build time so a running copy can always be identified. Without
// this it is guesswork whether a browser is showing a fresh build or a cached
// one, which wastes more time than the stamp costs.
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const demo = env.VITE_DEMO_MODE === 'true';

  return {
    plugins: [react()],
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
    // A project page lives at /<repo>/, so the demo build needs that base path.
    // Override with VITE_BASE if your repository has a different name.
    base: demo ? (env.VITE_BASE || '/playerarc/') : '/',
    server: {
      port: 5173,
      proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});
