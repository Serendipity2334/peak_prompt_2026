/**
 * Finestra Layers — loop di render solo durante interazione / damping.
 */
import '../style.css';
import './layers.css';
import percorso from '../../assets/data/percorso.json';
import { createLayerScene } from './scene.js';

const photos = percorso.photos;
photos.forEach((p) => {
  p.__list = photos;
});

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');

const hudIdx = document.getElementById('hud-idx');
const hudId = document.getElementById('hud-id');
const hudLayer = document.getElementById('hud-layer');
const hudBw = document.getElementById('hud-bw');
const hudZ = document.getElementById('hud-z');
const hudEle = document.getElementById('hud-ele');
const hudTime = document.getElementById('hud-time');
const btnBw = document.getElementById('btn-bw');

const scene = createLayerScene(canvas);
let index = 0;
let raf = 0;
let settle = 0;
let gate = false;
let hudTick = 0;

function formatQuota(ele) {
  return `${Math.round(ele).toLocaleString('it-IT')} m`;
}

function syncBwButton() {
  const on = scene.bwVisible;
  btnBw.textContent = on ? 'B/N on' : 'B/N off';
  btnBw.setAttribute('aria-pressed', on ? 'true' : 'false');
  hudBw.textContent = on ? 'ON' : 'OFF';
}

function updateHud() {
  const photo = photos[index];
  hudIdx.textContent = `${index + 1}/${photos.length}`;
  hudId.textContent = photo.id;
  hudLayer.textContent = scene.nearestLayerName();
  hudBw.textContent = scene.bwVisible ? 'ON' : 'OFF';
  hudZ.textContent = scene.camera.position.z.toFixed(2);
  hudEle.textContent = formatQuota(photo.ele);
  hudTime.textContent = photo.timeEstimated ? `${photo.time}*` : photo.time;
}

async function goTo(i, { from = 'front' } = {}) {
  index = (i + photos.length) % photos.length;
  await scene.showPhoto(photos[index]);
  if (from === 'back') scene.resetBehindForPrev();
  else scene.resetFront();
  updateHud();
  syncBwButton();
  kick(20);
}

async function next() {
  if (scene.loading || gate) return;
  gate = true;
  try {
    await goTo(index + 1, { from: 'front' });
  } finally {
    setTimeout(() => {
      gate = false;
    }, 350);
  }
}

async function prev() {
  if (scene.loading || gate) return;
  gate = true;
  try {
    await goTo(index - 1, { from: 'back' });
  } finally {
    setTimeout(() => {
      gate = false;
    }, 350);
  }
}

function frame() {
  raf = 0;

  if (!gate) {
    const signal = scene.passageSignal();
    if (signal === 'next') next();
    else if (signal === 'prev') prev();
  }

  scene.render();

  if ((hudTick++ & 3) === 0) updateHud();

  if (settle > 0) {
    settle--;
    raf = requestAnimationFrame(frame);
  }
}

function kick(frames = 24) {
  settle = Math.max(settle, frames);
  if (!raf) raf = requestAnimationFrame(frame);
}

scene.controls.addEventListener('start', () => kick(60));
scene.controls.addEventListener('change', () => kick(30));
scene.controls.addEventListener('end', () => kick(20));
canvas.addEventListener('pointerdown', () => kick(40));
window.addEventListener('wheel', () => kick(30), { passive: true });

window.addEventListener('resize', () => {
  scene.resize();
  kick(2);
});

document.getElementById('btn-next').onclick = () => next();
document.getElementById('btn-prev').onclick = () => prev();

btnBw.onclick = () => {
  scene.toggleBw();
  syncBwButton();
  kick(8);
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  } else if (e.key === 'b' || e.key === 'B') {
    scene.toggleBw();
    syncBwButton();
    kick(8);
  }
});

goTo(0)
  .then(() => {
    boot.hidden = true;
    syncBwButton();
    kick(20);
  })
  .catch((err) => {
    boot.textContent = `errore layer: ${err.message}`;
    console.error(err);
  });
