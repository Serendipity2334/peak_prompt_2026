import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(root, 'assets');

/** Serve /assets/* dalla cartella esistente senza toccarne i file */
function serveAssets() {
  return {
    name: 'serve-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/assets/')) return next();
        // Lascia a Vite gli import moduli (?import, .json come module)
        if (req.url.includes('?import') || req.url.includes('?url')) return next();

        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/assets\//, ''));
        const file = path.normalize(path.join(assetsRoot, rel));
        if (!file.startsWith(assetsRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        const ext = path.extname(file).toLowerCase();
        // Solo asset binari/statici; i .json importati restano a Vite
        const types = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gpx': 'application/gpx+xml',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
        if (!types[ext]) return next();
        res.setHeader('Content-Type', types[ext]);
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [serveAssets()],
  server: {
    port: 5173,
    open: false
  }
});
