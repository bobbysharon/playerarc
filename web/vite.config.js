import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const demo = env.VITE_DEMO_MODE === 'true';

  return {
    plugins: [react()],
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
