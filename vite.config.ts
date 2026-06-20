import path from 'path';
import http from 'http';
import { Plugin, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApp } from './harinos-website-main/harinos-website-main/backend/src/app.js';

const appRoot = path.resolve(__dirname, 'harinos-website-main/harinos-website-main');

const checkDjangoRunning = (): Promise<boolean> => {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 8000,
      path: '/api/settings',
      method: 'GET',
      timeout: 500
    }, () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
};

const createNoCacheVersionPlugin = (buildVersion: string): Plugin => ({
  name: 'harinos-no-cache-version',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const requestPath = req.url?.split('?')[0] ?? '';

      if (
        requestPath === '/' ||
        requestPath.endsWith('.html') ||
        requestPath.endsWith('/manifest.json') ||
        requestPath.endsWith('/version.json') ||
        requestPath.endsWith('/sw.js')
      ) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      next();
    });
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify(
        {
          version: buildVersion,
          generatedAt: buildVersion,
        },
        null,
        2,
      ),
    });
  },
});

const createLocalApiPlugin = (): Plugin => ({
  name: 'harinos-local-api',
  configureServer(server) {
    server.middlewares.use('/api', createApp());
  },
});

export default defineConfig(async () => {
  const buildVersion = new Date().toISOString();
  const useDjango = await checkDjangoRunning();

  if (useDjango) {
    console.log('\x1b[36m%s\x1b[0m', 'Django backend detected on port 8000. Proxying /api to Django.');
  } else {
    console.log('\x1b[33m%s\x1b[0m', 'Django backend not detected. Falling back to local Express server.');
  }

  return {
    root: appRoot,
    base: '/',
    publicDir: path.resolve(appRoot, 'public'),
    envDir: __dirname,
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: useDjango ? {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        }
      } : undefined,
    },
    plugins: [
      react(),
      createNoCacheVersionPlugin(buildVersion),
      ...(!useDjango ? [createLocalApiPlugin()] : [])
    ],

    build: {
      outDir: path.resolve(appRoot, 'dist'),
      emptyOutDir: true,
      target: ['es2018', 'safari13'],
      cssTarget: 'safari13',
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/firestore'],
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(buildVersion),
    },
    resolve: {
      alias: {
        '@': appRoot,
      },
    },
  };
});
