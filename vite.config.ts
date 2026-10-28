import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { collectLicenses } from './scripts/licenses';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Chemins relatifs : l'app est servie depuis le système de fichiers de la WebView Capacitor.
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
  // Version affichée dans « À propos » (la même que celle de l'APK, voir android/app/build.gradle).
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      // licenses.txt : logiciels libres livrés dans l'app et textes de leurs licences.
      name: 'liseuse-licences',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: collectLicenses(process.cwd()) });
      },
      configureServer(server) {
        server.middlewares.use('/licenses.txt', (_req, res) => {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(collectLicenses(process.cwd()));
        });
      },
    },
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['tests/unit/setup.ts'],
  },
});
