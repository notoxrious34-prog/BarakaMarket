import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Activation Desk station: the Vite dev server forwards /api/desk/*
      // to the local signing server (`npm run desk`, 127.0.0.1:3200).
      proxy: {
        '/api/desk': {
          target: 'http://127.0.0.1:3200',
          changeOrigin: false,
        },
      },
    },
    build: {
      rollupOptions: {
        // Main POS + staff Activation Desk (desk.html) ship from one build.
        input: {
          main: 'index.html',
          desk: 'desk.html',
        },
      },
    },
  };
});
