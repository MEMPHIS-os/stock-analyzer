import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        // 127.0.0.1 (not localhost): the server binds to 127.0.0.1 only, and
        // 'localhost' can resolve to ::1 first on IPv6-preferring systems.
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy third-party libs into separate, long-cacheable chunks so the
    // initial app bundle stays small and the chart library only loads with the
    // (already lazy) routes that use it.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('lightweight-charts') || id.includes('fancy-canvas')) return 'charts';
          if (id.includes('react-router') || id.includes('@remix-run')) return 'router';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          return 'vendor';
        },
      },
    },
  },
});
