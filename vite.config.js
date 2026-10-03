import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(root, 'assets');
const cacheVideos = path.join(root, '.cache', 'videos');
const cacheThumbs = path.join(root, '.cache', 'thumbs');
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

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function convertMpg(file, ffmpegPath) {
  const id = path.basename(file, path.extname(file));
  const out = path.join(cacheVideos, `${id}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return Promise.resolve(true);
  return runFfmpeg(ffmpegPath, [
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
  ]);
}

function makeThumb(ffmpegPath, input, output, { seek = false } = {}) {
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    return Promise.resolve(true);
  }
  ensureDir(path.dirname(output));
  // foto: niente -ss (rompe gli still). video: cerca un frame a 0.12s
  const args = ['-y'];
  if (seek) args.push('-ss', '0.12');
  args.push(
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2',
    '-q:v',
    '5',
    output
  );
  return runFfmpeg(ffmpegPath, args);
}

function loadPrevVideoStats() {
  const file = path.join(cacheVideos, 'manifest.json');
  if (!fs.existsSync(file)) return new Map();
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Map(
      (Array.isArray(prev) ? prev : []).map((v) => [
        v.id,
        {
          light: v.light,
          shadow: v.shadow,
          neutral: v.neutral,
          luma: v.luma
        }
      ])
    );
  } catch {
    return new Map();
  }
}

function buildManifest() {
  ensureDir(cacheVideos);
  const prev = loadPrevVideoStats();
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
      const kept = prev.get(id) || {};
      return {
        id,
        kind: 'video',
        source: `assets/videos/${path.basename(file)}`,
        src: `/cache/videos/${id}.mp4`,
        thumb: `/cache/thumbs/video-${id}.jpg`,
        time,
        sortKey,
        light: kept.light ?? 0,
        shadow: kept.shadow ?? 0,
        ...(kept.neutral != null ? { neutral: kept.neutral } : {}),
        ...(kept.luma != null ? { luma: kept.luma } : {})
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));

  fs.writeFileSync(
    path.join(cacheVideos, 'manifest.json'),
    JSON.stringify(items, null, 2)
  );
  return items;
}

function recomputeVideoLight() {
  const py = path.join(root, '.venv', 'bin', 'python');
  const script = path.join(root, 'scripts', 'recompute_light.py');
  if (!fs.existsSync(py) || !fs.existsSync(script)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(py, [script, 'videos'], { stdio: 'inherit', cwd: root });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function prepareThumbs(ffmpegPath) {
  if (!ffmpegPath) return;
  ensureDir(cacheThumbs);

  const jobs = [];

  // foto B/N
  const bwDir = path.join(assetsRoot, 'images', 'bianco_nero');
  if (fs.existsSync(bwDir)) {
    for (const name of fs.readdirSync(bwDir)) {
      if (!/\.jpe?g$/i.test(name)) continue;
      const id = path.basename(name, path.extname(name));
      const input = path.join(bwDir, name);
      const output = path.join(cacheThumbs, `photo-${id}.jpg`);
      jobs.push(() => makeThumb(ffmpegPath, input, output, { seek: false }));
    }
  }

  // video (da mp4 in cache)
  if (fs.existsSync(cacheVideos)) {
    for (const name of fs.readdirSync(cacheVideos)) {
      if (!/\.mp4$/i.test(name)) continue;
      const id = path.basename(name, path.extname(name));
      const input = path.join(cacheVideos, name);
      const output = path.join(cacheThumbs, `video-${id}.jpg`);
      jobs.push(() => makeThumb(ffmpegPath, input, output, { seek: true }));
    }
  }

  const missing = jobs.length;
  if (!missing) return;
  console.log(`[thumbs] generazione / verifica thumbs…`);
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map((fn) => fn()));
  }
  console.log(`[thumbs] pronti in .cache/thumbs`);
}

async function prepareMedia() {
  ensureDir(cacheVideos);
  ensureDir(cacheThumbs);

  let ffmpegPath = null;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    console.warn('[media] ffmpeg-static non trovato');
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
  await prepareThumbs(ffmpegPath);
  const ok = await recomputeVideoLight();
  if (ok) console.log('[videos] light/shadow ricalcolati dai thumb');
}

function sendFile(res, file, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(file).pipe(res);
}

/** Serve /assets/* e /cache/* senza toccare assets/ */
function serveAssets() {
  return {
    name: 'serve-assets',
    async configureServer(server) {
      await prepareMedia();

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        if (req.url.startsWith('/cache/videos/')) {
          const rel = decodeURIComponent(
            req.url.split('?')[0].replace(/^\/cache\/videos\//, '')
          );
          const file = path.normalize(path.join(cacheVideos, rel));
          if (!file.startsWith(cacheVideos) || !fs.existsSync(file)) return next();
          const ext = path.extname(file).toLowerCase();
          const types = { '.mp4': 'video/mp4', '.json': 'application/json' };
          if (!types[ext]) return next();
          sendFile(res, file, types[ext]);
          return;
        }

        if (req.url.startsWith('/cache/thumbs/')) {
          const rel = decodeURIComponent(
            req.url.split('?')[0].replace(/^\/cache\/thumbs\//, '')
          );
          const file = path.normalize(path.join(cacheThumbs, rel));
          if (!file.startsWith(cacheThumbs) || !fs.existsSync(file)) return next();
          sendFile(res, file, 'image/jpeg');
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
        sendFile(res, file, types[ext]);
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
