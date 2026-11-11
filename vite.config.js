import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WebContainers require cross-origin isolation (SharedArrayBuffer).
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    headers,
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: { headers },
});
