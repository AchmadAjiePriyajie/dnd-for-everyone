import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const host = process.env.DND_HOST_URL ?? 'http://127.0.0.1:3000';

// Development: Vite menyajikan UI dan mem-proxy API/Socket.IO ke host Nest.
// Host header tidak diubah agar pemeriksaan same-origin di server tetap berlaku.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: { conditions: [...defaultClientConditions, 'source'] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: host, changeOrigin: false },
      '/socket.io': { target: host, changeOrigin: false, ws: true },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
