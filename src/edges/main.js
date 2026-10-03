/**
 * Edges — un solo passaggio continuo: raggiera → morph tile0 → sequenza.
 */
import './edges.css';
import { buildTimeline } from './timeline.js';
import { createExperience } from './experience.js';

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const hudIdx = document.getElementById('hud-idx');
const hudHint = document.getElementById('hud-hint');
const brand = document.querySelector('.brand');

const exp = createExperience(canvas);

const INTRO_WHEEL = 0.00075;
const SEQ_WHEEL = 0.00135;

let items = [];
let ready = false;
let needsRender = true;
let raf = 0;

function pad(n) {
  return String(n).padStart(2, '0');
}

function syncHud() {
  const mode = exp.getMode();
  if (mode === 'intro') {
    document.body.classList.add('is-landing');
    document.body.classList.remove('is-stack');
    if (brand) brand.textContent = 'PEAK PROMPT · OROLOGIO';
    hudHint.textContent = 'scroll ↓ chiudi / ↑ apre';
    const p = exp.getIntro();
    if (p < 1) hudIdx.textContent = `CHIUDI ${Math.round(p * 100)}%`;
    else hudIdx.textContent = `SLITTA ${Math.round((p - 1) * 100)}%`;
  } else {
    document.body.classList.remove('is-landing');
    document.body.classList.add('is-stack');
    if (brand) brand.textContent = 'PEAK PROMPT · EDGES';
    hudHint.textContent = 'scroll · sequenza · ↑ raggiera all’inizio';
    const i = exp.getSeqIndex() + 1;
    const item = exp.getItem();
    const kind = item?.kind === 'video' ? 'VIDEO' : 'FOTO';
    hudIdx.textContent = `${pad(i)} / ${pad(exp.count || items.length)} · ${kind}`;
  }
}

function kick() {
  needsRender = true;
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  raf = 0;
  exp.render();
  if (exp.hasActiveVideo() || needsRender) {
    needsRender = false;
    raf = requestAnimationFrame(loop);
  } else {
    needsRender = false;
  }
}

function onWheel(e) {
  e.preventDefault();
  if (!ready) return;

  if (exp.getMode() === 'intro') {
    const before = exp.getIntro();
    exp.addIntro(e.deltaY * INTRO_WHEEL);
    syncHud();
    kick();
    if (e.deltaY > 0 && exp.getMode() === 'sequence' && before < 2) {
      syncHud();
    }
    return;
  }

  // sequenza: all’inizio, ↑ torna alla raggiera (stesso render)
  if (e.deltaY < 0 && exp.getSeq() <= 0.02) {
    exp.exitToIntro(1.85);
    exp.addIntro(e.deltaY * INTRO_WHEEL);
    syncHud();
    kick();
    return;
  }

  exp.addSeq(e.deltaY * SEQ_WHEEL);
  syncHud();
  kick();
}

function onResize() {
  exp.resize();
  kick();
}

async function bootApp() {
  try {
    boot.textContent = 'caricamento timeline…';
    items = await buildTimeline();
    boot.textContent = `thumbs · ${items.length}…`;
    await exp.build(items);
    ready = true;
    boot.classList.add('is-hidden');
    syncHud();
    kick();
  } catch (err) {
    console.error(err);
    boot.textContent = 'errore caricamento';
  }
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', onResize);
bootApp();
