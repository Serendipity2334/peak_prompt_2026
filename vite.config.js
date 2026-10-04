import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(root, 'assets');
const assetsVideos = path.join(assetsRoot, 'videos');
const assetsThumbs = path.join(assetsRoot, 'thumbs');
const require = createRequire(import.meta.url);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMp4() {
  if (!fs.existsSync(assetsVideos)) return [];
  return fs
    .readdirSync(assetsVideos)
    .filter((f) => /\.mp4$/i.test(f))
    .map((f) => path.join(assetsVideos, f));
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function makeThumb(ffmpegPath, input, output, { seek = false } = {}) {
  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    return Promise.resolve(true);
  }
  ensureDir(path.dirname(output));
  // foto: niente -ss (rompe gli still). video: cerca un frame a 0.12s
  const args = ['-nostdin', '-y'];
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
  const file = path.join(assetsVideos, 'manifest.json');
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
          luma: v.luma,
          time: v.time,
          sortKey: v.sortKey
        }
      ])
    );
  } catch {
    return new Map();
  }
}

function buildManifest() {
  ensureDir(assetsVideos);
  const prev = loadPrevVideoStats();
  const items = listMp4()
    .map((file) => {
      const id = path.basename(file, path.extname(file));
      const st = fs.statSync(file);
      const birth = st.birthtime || st.mtime;
      const kept = prev.get(id) || {};
      const sortKey =
        kept.sortKey != null
          ? Number(kept.sortKey)
          : birth.getHours() * 3600 + birth.getMinutes() * 60 + birth.getSeconds();
      const time =
        kept.time ||
        `${String(birth.getHours()).padStart(2, '0')}:${String(birth.getMinutes()).padStart(2, '0')}:${String(birth.getSeconds()).padStart(2, '0')}`;
      return {
        id,
        kind: 'video',
        source: `assets/videos/${id}.mp4`,
        src: `/assets/videos/${id}.mp4`,
        thumb: `/assets/thumbs/video-${id}.jpg`,
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
    path.join(assetsVideos, 'manifest.json'),
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
  ensureDir(assetsThumbs);

  const jobs = [];

  // foto B/N
  const bwDir = path.join(assetsRoot, 'images', 'bianco_nero');
  if (fs.existsSync(bwDir)) {
    for (const name of fs.readdirSync(bwDir)) {
      if (!/\.jpe?g$/i.test(name)) continue;
      const id = path.basename(name, path.extname(name));
      const input = path.join(bwDir, name);
      const output = path.join(assetsThumbs, `photo-${id}.jpg`);
      jobs.push(() => makeThumb(ffmpegPath, input, output, { seek: false }));
    }
  }

  // video (mp4 in assets/videos)
  for (const file of listMp4()) {
    const id = path.basename(file, path.extname(file));
    const output = path.join(assetsThumbs, `video-${id}.jpg`);
    jobs.push(() => makeThumb(ffmpegPath, file, output, { seek: true }));
  }

  if (!jobs.length) return;
  console.log(`[thumbs] generazione / verifica thumbs…`);
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map((fn) => fn()));
  }
  console.log(`[thumbs] pronti in assets/thumbs`);
}

async function prepareMedia() {
  ensureDir(assetsVideos);
  ensureDir(assetsThumbs);

  let ffmpegPath = null;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    console.warn('[media] ffmpeg-static non trovato');
  }

  const manifest = buildManifest();
  console.log(`[videos] manifest: ${manifest.length} clip → assets/videos/`);
  await prepareThumbs(ffmpegPath);
  const ok = await recomputeVideoLight();
  if (ok) console.log('[videos] light/shadow ricalcolati dai thumb');
}

function sendFile(req, res, file, type) {
  const stat = fs.statSync(file);
  const size = stat.size;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      if (start <= end && start < size) {
        const from = start;
        const to = Math.min(end, size - 1);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${from}-${to}/${size}`);
        res.setHeader('Content-Length', String(to - from + 1));
        fs.createReadStream(file, { start: from, end: to }).pipe(res);
        return;
      }
    }
  }

  res.setHeader('Content-Length', String(size));
  fs.createReadStream(file).pipe(res);
}

function pathnameOf(url) {
  return decodeURIComponent((url || '').split('?')[0]);
}

/** Serve /assets/* (anche sotto base di GitHub Pages). */
function serveAssets() {
  return {
    name: 'serve-assets',
    async configureServer(server) {
      await prepareMedia();

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const pathname = pathnameOf(req.url).replace(/^\/peak_prompt_2026/, '');

        if (!pathname.startsWith('/assets/')) return next();
        if (req.url.includes('?import') || req.url.includes('?url')) return next();

        const rel = pathname.replace(/^\/assets\//, '');
        const file = path.normalize(path.join(assetsRoot, rel));
        if (!file.startsWith(assetsRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        const ext = path.extname(file).toLowerCase();
        const types = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.json': 'application/json',
          '.otf': 'font/otf',
          '.ttf': 'font/ttf',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.gpx': 'application/gpx+xml',
          '.xlsx':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.mp4': 'video/mp4'
        };
        if (!types[ext]) return next();
        sendFile(req, res, file, types[ext]);
      });
    },
    async buildStart() {
      await prepareMedia();
    },
    closeBundle() {
      const dist = path.join(root, 'dist');
      ensureDir(dist);
      fs.cpSync(assetsRoot, path.join(dist, 'assets'), { recursive: true });
      console.log('[build] copiati assets/ (videos mp4 + thumbs) → dist/');
    }
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages: https://serendipity2334.github.io/peak_prompt_2026/
  base: command === 'build' ? '/peak_prompt_2026/' : '/',
  publicDir: false,
  plugins: [serveAssets()],
  server: {
    port: 5173,
    open: false
  },
  build: {
    rollupOptions: {
      input: path.join(root, 'index.html')
    }
  }
}));
