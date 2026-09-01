import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@teca/shared'],
  },
  server: {
    port: 5173,
    // Bind IPv4 explicitly: on Windows the default resolves to ::1 only.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.TECA_API_URL ?? 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
