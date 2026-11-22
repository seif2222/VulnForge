import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The CLI's dashboard server serves these assets from packages/cli/assets/dashboard
// under a strict CSP (script-src 'self', no inline anything). Everything ships in
// the bundle: fonts, 3D, styles. No remote request is ever made by the app itself.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../cli/assets/dashboard',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
