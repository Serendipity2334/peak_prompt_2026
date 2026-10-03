/**
 * Peak Prompt — passo 1
 * Percorso 3D + camera che segue lo scroll nativo.
 */
import './style.css';
import percorso from '../assets/data/percorso.json';
import { createScene } from './scene.js';

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const hudP = document.getElementById('hud-p');
const hudEle = document.getElementById('hud-ele');
const hudTime = document.getElementById('hud-time');
const hudPos = document.getElementById('hud-pos');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Setup scena
const ctx = createScene(canvas, percorso);
let pTarget = 0;
let pSmooth = 0;
let needsRender = true;
let raf = 0;

function readScrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

function formatQuota(ele) {
  // Formato italiano: 2.428 m
  const n = Math.round(ele);
  return `${n.toLocaleString('it-IT')} m`;
}

function updateHud() {
  const sample = ctx.sampleAt(pSmooth);
  hudP.textContent = pSmooth.toFixed(3);
  hudEle.textContent = formatQuota(sample.ele);
  hudTime.textContent = sample.t;
  hudPos.textContent = `X ${sample.lon.toFixed(3)} Y ${sample.lat.toFixed(3)}`;
}

function frame() {
  raf = 0;
  // Lerp morbido sullo scroll (niente scatti)
  const lerp = reducedMotion ? 1 : 0.075;
  const prev = pSmooth;
  pSmooth += (pTarget - pSmooth) * lerp;

  if (Math.abs(pTarget - pSmooth) < 0.00015) {
    pSmooth = pTarget;
  }

  ctx.updateCamera(pSmooth);
  updateHud();
  ctx.render();

  // Continua solo se c'è ancora interpolazione o richiesta
  if (Math.abs(pTarget - pSmooth) > 0.00015 || needsRender) {
    needsRender = Math.abs(pTarget - pSmooth) > 0.00015;
    raf = requestAnimationFrame(frame);
  }
}

function requestFrame() {
  needsRender = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

function onScroll() {
  pTarget = readScrollProgress();
  requestFrame();
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  ctx.resize();
  requestFrame();
});

// Tastiera: PageUp/PageDown e frecce spostano lo scroll a scatti (tappe dopo)
window.addEventListener('keydown', (e) => {
  const step = window.innerHeight * 0.35;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault();
    window.scrollBy({ top: step, behavior: reducedMotion ? 'auto' : 'smooth' });
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    window.scrollBy({ top: -step, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
});

// Avvio
pTarget = readScrollProgress();
pSmooth = pTarget;
ctx.updateCamera(pSmooth);
updateHud();
ctx.render();
boot.hidden = true;
requestFrame();

console.info(
  `[Peak Prompt] track=${percorso.track.length} punti · photos=${percorso.photos.length} · dist=${percorso.route.distTotal} m`
);
