/**
 * Stack — foto una sull'altra in Z; wheel cancella dal buio alla luce.
 */
import './stack.css';
import percorso from '../../assets/data/percorso.json';
import { createStackScene } from './scene.js';

/** Più ombra (blu) / meno luce (rosso) → prima; più luce / meno ombra → dopo */
const ranked = [...percorso.photos].sort((a, b) => {
  const byLight = a.light - b.light;
  if (Math.abs(byLight) > 1e-9) return byLight;
  return b.shadow - a.shadow;
});

/** Bookends: 100% buio (blu) → foto → 100% luce (rosso) */
const photos = [
  {
    id: 'buio',
    solid: '#1f2dff',
    light: 0,
    shadow: 1,
    lightRank: 0
  },
  ...ranked,
  {
    id: 'luce',
    solid: '#ff3a24',
    light: 1,
    shadow: 0,
    lightRank: 31
  }
];

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const hudIdx = document.getElementById('hud-idx');
const hudBuio = document.getElementById('hud-buio');
const hudLuce = document.getElementById('hud-luce');
const colorSlider = document.getElementById('color-slider');
const colorPct = document.getElementById('color-pct');

const scene = createStackScene(canvas);

/** How much of one image a "full" wheel notch erases */
const WHEEL_SCALE = 0.00135;

let needsRender = true;
let raf = 0;

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtPct(v) {
  return `${(Number(v) * 100).toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

function updateHud() {
  const i = scene.getIndex() + 1;
  const total = scene.photoCount || photos.length;
  hudIdx.textContent = `${pad(i)} / ${pad(total)}`;

  const photo = scene.getPhoto() || photos[0];
  hudBuio.textContent = fmtPct(photo.shadow ?? 0);
  hudLuce.textContent = fmtPct(photo.light ?? 0);
}

function kick() {
  needsRender = true;
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  raf = 0;
  if (!needsRender) return;
  needsRender = false;
  scene.render();
}

function onWheel(e) {
  e.preventDefault();
  scene.addProgress(e.deltaY * WHEEL_SCALE);
  updateHud();
  kick();
}

function onResize() {
  scene.resize();
  kick();
}

function onColorInput() {
  const t = Number(colorSlider.value) / 100;
  scene.setColorMix(t);
  colorPct.textContent = `${Math.round(t * 100)}%`;
  kick();
}

async function bootApp() {
  try {
    await scene.build(photos);
    boot.classList.add('is-hidden');
    updateHud();
    onColorInput();
    kick();
  } catch (err) {
    console.error(err);
    boot.textContent = 'errore caricamento stack';
  }
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', onResize);
colorSlider.addEventListener('input', onColorInput);
bootApp();
