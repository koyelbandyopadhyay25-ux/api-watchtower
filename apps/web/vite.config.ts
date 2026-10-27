import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const demoMode = env.VITE_DEMO_MODE === 'true';

  return {
    base: demoMode ? (env.VITE_BASE_PATH || '/') : '/',
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(demoMode),
      'import.meta.env.VITE_REPOSITORY_URL': JSON.stringify(env.VITE_REPOSITORY_URL || ''),
    },
    server: {
      port: 5173,
      strictPort: true,
      // Keep the local API prefix distinct from the GitHub Pages /api-watchtower/ base.
      proxy: { '/api/': 'http://127.0.0.1:3001' },
    },
  };
});
