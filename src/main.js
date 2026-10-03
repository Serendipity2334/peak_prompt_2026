/**
 * Peak Prompt — home passo 1
 * Sfondo granuloso blu→rosso + struttura scroll (intro / 30 foto / vetta).
 */
import './style.css';
import { createGrainPlane } from './home/plane.js';
import {
  buildScrollPanels,
  locateScroll,
  backgroundMix,
  globalProgress
} from './home/scroll.js';

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const centerCopy = document.getElementById('center-copy');
const centerTitle = document.getElementById('center-title');
const cta = document.getElementById('cta');

const photos = buildScrollPanels(document.getElementById('photo-panels'));
const plane = createGrainPlane(canvas);

let raf = 0;
let running = false;
const clock = { t0: performance.now() };

function updateUI(loc) {
  if (loc.zone === 'intro') {
    centerCopy.hidden = false;
    centerTitle.textContent = 'PEAK PROMPT';
    cta.hidden = false;
  } else if (loc.zone === 'summit') {
    centerCopy.hidden = false;
    centerTitle.textContent = 'VETTA · 2.682 m';
    cta.hidden = true;
  } else {
    // Nei passi successivi qui ci saranno le foto a pieno schermo
    centerCopy.hidden = true;
  }
}

function frame() {
  raf = 0;
  const loc = locateScroll(photos);
  const mix = backgroundMix(loc, photos);
  plane.setMix(mix);

  const t = (performance.now() - clock.t0) / 1000;
  plane.render(t);
  updateUI(loc);

  // Grana sempre in movimento → loop continuo (sobrio: solo questo shader)
  if (running) raf = requestAnimationFrame(frame);
}

function start() {
  running = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

function onScroll() {
  // il frame loop legge già lo scroll; kick immediato
  if (!raf) raf = requestAnimationFrame(frame);
}

cta.addEventListener('click', () => {
  const first = document.getElementById('photo-1');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  plane.resize();
  onScroll();
});

boot.hidden = true;
start();

console.info(
  `[Peak Prompt] passo 1 · photos by lightRank=${photos.length} · p=${globalProgress().toFixed(3)}`
);
