import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      host: true,
      port: env.VITE_DEV_SERVER_PORT ? Number(env.VITE_DEV_SERVER_PORT) : 5173,
      strictPort: false
    },
    preview: {
      port: env.VITE_DEV_SERVER_PORT ? Number(env.VITE_DEV_SERVER_PORT) : 4173
    },
    build: {
      sourcemap: true
    }
  };
});
