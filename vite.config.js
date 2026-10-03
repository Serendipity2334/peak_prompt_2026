import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(root, 'assets');
const cacheVideos = path.join(root, '.cache', 'videos');
const require = createRequire(import.meta.url);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMpg() {
  const dir = path.join(assetsRoot, 'videos');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.mpg$/i.test(f))
    .map((f) => path.join(dir, f));
}

function buildManifest() {
  ensureDir(cacheVideos);
  const items = listMpg()
    .map((file) => {
      const id = path.basename(file, path.extname(file));
      const st = fs.statSync(file);
      const birth = st.birthtime || st.mtime;
      const hh = String(birth.getHours()).padStart(2, '0');
      const mm = String(birth.getMinutes()).padStart(2, '0');
      const ss = String(birth.getSeconds()).padStart(2, '0');
      const time = `${hh}:${mm}:${ss}`;
      const sortKey =
        birth.getHours() * 3600 + birth.getMinutes() * 60 + birth.getSeconds();
      return {
        id,
        kind: 'video',
        source: `assets/videos/${path.basename(file)}`,
        src: `/cache/videos/${id}.mp4`,
        time,
        sortKey,
        light: 0,
        shadow: 0
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));

  fs.writeFileSync(
    path.join(cacheVideos, 'manifest.json'),
    JSON.stringify(items, null, 2)
  );
  return items;
}

function convertMpg(file, ffmpegPath) {
  return new Promise((resolve) => {
    const id = path.basename(file, path.extname(file));
    const out = path.join(cacheVideos, `${id}.mp4`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      resolve(true);
      return;
    }
    const args = [
      '-y',
      '-i',
      file,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out
    ];
    const child = spawn(ffmpegPath, args, { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function prepareVideos() {
  ensureDir(cacheVideos);
  let ffmpegPath = null;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    console.warn('[videos] ffmpeg-static non trovato — salto conversione');
  }

  const mpgs = listMpg();
  if (ffmpegPath && mpgs.length) {
    const missing = mpgs.filter((f) => {
      const id = path.basename(f, path.extname(f));
      const out = path.join(cacheVideos, `${id}.mp4`);
      return !fs.existsSync(out) || fs.statSync(out).size === 0;
    });
    if (missing.length) {
      console.log(`[videos] conversione ${missing.length} MPG → mp4…`);
      for (let i = 0; i < missing.length; i += 3) {
        await Promise.all(missing.slice(i, i + 3).map((f) => convertMpg(f, ffmpegPath)));
      }
    }
  }

  const manifest = buildManifest();
  console.log(`[videos] manifest: ${manifest.length} clip`);
}

/** Serve /assets/* dalla cartella esistente senza toccarne i file */
function serveAssets() {
  return {
    name: 'serve-assets',
    async configureServer(server) {
      await prepareVideos();

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        // cached web-friendly videos
        if (req.url.startsWith('/cache/videos/')) {
          const rel = decodeURIComponent(
            req.url.split('?')[0].replace(/^\/cache\/videos\//, '')
          );
          const file = path.normalize(path.join(cacheVideos, rel));
          if (!file.startsWith(cacheVideos) || !fs.existsSync(file)) return next();
          const ext = path.extname(file).toLowerCase();
          const types = {
            '.mp4': 'video/mp4',
            '.json': 'application/json'
          };
          if (!types[ext]) return next();
          res.setHeader('Content-Type', types[ext]);
          res.setHeader('Cache-Control', 'no-store');
          fs.createReadStream(file).pipe(res);
          return;
        }

        if (!req.url.startsWith('/assets/')) return next();
        if (req.url.includes('?import') || req.url.includes('?url')) return next();

        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/assets\//, ''));
        const file = path.normalize(path.join(assetsRoot, rel));
        if (!file.startsWith(assetsRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        const ext = path.extname(file).toLowerCase();
        const types = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gpx': 'application/gpx+xml',
          '.xlsx':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.mpg': 'video/mpeg',
          '.mpeg': 'video/mpeg',
          '.mp4': 'video/mp4'
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
  },
  build: {
    rollupOptions: {
      input: {
        main: path.join(root, 'index.html'),
        layers: path.join(root, 'layers.html'),
        stack: path.join(root, 'stack.html'),
        edges: path.join(root, 'edges.html')
      }
    }
  }
});
