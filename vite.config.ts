import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localCloudDemo = process.env.RELAY_LOCAL_CLOUD_DEMO === '1';
const localGatewaySecret = process.env.RELAY_GATEWAY_SECRET || '';
if (localCloudDemo && localGatewaySecret.length < 32)
  throw new Error('The local billing demo needs its private Vite-to-server gateway secret.');

const demoRoutes = new Set([
  '/api/session',
  '/api/auth/get-session',
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/sign-out',
  '/api/billing/summary',
  '/api/billing/profiles',
  '/api/billing/profiles/select',
  '/api/billing/wallet/unlock',
  '/api/billing/wallet/challenge',
  '/api/billing/wallet/bind',
  '/api/billing/intent',
  '/api/billing/verify',
]);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.relay*/**',
        '**/*.db*',
        '**/*.private.json',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
        ...(localCloudDemo
          ? {
              configure(proxy) {
                proxy.on('proxyReq', (proxyRequest, request) => {
                  proxyRequest.removeHeader('x-relay-gateway');
                  if (demoRoutes.has((request.url || '').split('?')[0]))
                    proxyRequest.setHeader('x-relay-gateway', localGatewaySecret);
                });
              },
            }
          : {}),
      },
    },
  },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
