/**
 * Edges — un solo passaggio continuo: raggiera → morph tile0 → sequenza.
 */
import './edges.css';
import percorso from '../../assets/data/percorso.json';
import { buildTimeline } from './timeline.js';
import { createExperience } from './experience.js';

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const metaDate = document.getElementById('meta-date');
const metaPlace = document.getElementById('meta-place');
const peakTitle = document.getElementById('peak-title');
const hudEle = document.getElementById('hud-ele');
const hudLight = document.getElementById('hud-light');

const route = percorso.route || percorso;
function formatMetaDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}
if (metaDate) metaDate.textContent = formatMetaDate(route.date);
if (metaPlace) {
  metaPlace.textContent = [route.from, route.to].filter(Boolean).join(' → ');
}

function formatEle(m) {
  if (!Number.isFinite(Number(m))) return '— m';
  return `${Math.round(Number(m)).toLocaleString('it-IT')} m`;
}

function formatLight(v) {
  const pct = (Number(v) * 100).toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return `${pct}% light`;
}

/** Per video senza ele: foto più vicina nel tempo. light dai thumb se presente. */
function metricsForItem(item, list) {
  if (!item || item.kind === 'end') return null;
  if (item.kind === 'photo') {
    return { ele: item.ele, light: item.light };
  }
  const t = Number(item.sortKey) || 0;
  let best = null;
  let bestD = Infinity;
  for (const p of list) {
    if (p.kind !== 'photo' || p.ele == null) continue;
    const d = Math.abs((Number(p.sortKey) || 0) - t);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const light = item.light != null ? item.light : (best?.light ?? 0);
  if (!best) return { ele: item.ele, light };
  return {
    ele: item.ele ?? best.ele,
    light
  };
}

const exp = createExperience(canvas);

const INTRO_WHEEL = 0.00075;
const SEQ_WHEEL = 0.00135;

let ready = false;
let needsRender = true;
let raf = 0;
/** @type {Array<Record<string, unknown>>} */
let timeline = [];

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

function syncMode() {
  const mode = exp.getMode();
  if (mode === 'intro') {
    document.body.classList.add('is-landing');
    document.body.classList.remove('is-stack');
  } else {
    document.body.classList.remove('is-landing');
    document.body.classList.add('is-stack');
  }
  syncTitleErase();
  syncMetaWithOrari();
  syncSeqMetrics();
}

/**
 * Intro: titolo DOM.
 * Sequenza: titolo WebGL legato all’erase della prima immagine (stesso cutoff/luma).
 */
function syncTitleErase() {
  if (!peakTitle) return;
  if (exp.getMode() === 'intro') {
    peakTitle.style.opacity = '1';
    peakTitle.style.visibility = 'visible';
    return;
  }
  // in sequenza il titolo segue la prima immagine nel canvas
  peakTitle.style.opacity = '0';
  peakTitle.style.visibility = 'hidden';
}

/** Stessa curva di fade degli orari sulla raggiera (durante lo zoom). */
function syncMetaWithOrari() {
  let opacity = 1;
  if (exp.getMode() !== 'intro') {
    opacity = 0;
  } else {
    const m = easeInOut(Math.min(Math.max(exp.getIntro() - 1, 0), 1));
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;
  }
  for (const el of [metaDate, metaPlace]) {
    if (!el) continue;
    el.style.opacity = String(opacity);
    el.style.visibility = opacity > 0.02 ? 'visible' : 'hidden';
  }
}

/**
 * Dopo la prima immagine (titolo sparito): altitudine sx / luce dx
 * compaiono insieme al secondo elemento (seq 0→1).
 */
function syncSeqMetrics() {
  if (!hudEle && !hudLight) return;

  let opacity = 0;
  if (exp.getMode() === 'sequence') {
    const seq = exp.getSeq();
    // compare mentre la prima si dissolve e il secondo emerge
    opacity = Math.min(1, Math.max(0, seq));
    const item = exp.getItem();
    if (item?.kind === 'end') opacity = 0;

    const idx = exp.getSeqIndex();
    // dati dell’elemento attivo (dal secondo in poi usa idx; durante erase 0→1 già il secondo sotto)
    const dataItem =
      seq < 1
        ? timeline[1] || timeline[0]
        : timeline[idx] || item;
    const metrics = metricsForItem(dataItem, timeline);
    if (metrics && opacity > 0) {
      if (hudEle) hudEle.textContent = formatEle(metrics.ele);
      if (hudLight) hudLight.textContent = formatLight(metrics.light);
    }
  }

  for (const el of [hudEle, hudLight]) {
    if (!el) continue;
    el.style.opacity = String(opacity);
    el.style.visibility = opacity > 0.02 ? 'visible' : 'hidden';
  }
}

function kick() {
  needsRender = true;
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  raf = 0;
  exp.render();
  syncTitleErase();
  syncMetaWithOrari();
  syncSeqMetrics();
  if (exp.hasActiveVideo() || exp.needsIdleMotion() || needsRender) {
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
    exp.addIntro(e.deltaY * INTRO_WHEEL);
    syncMode();
    kick();
    return;
  }

  // sequenza: all’inizio, ↑ torna alla raggiera (stesso render)
  if (e.deltaY < 0 && exp.getSeq() <= 0.02) {
    exp.exitToIntro(1.85);
    exp.addIntro(e.deltaY * INTRO_WHEEL);
    syncMode();
    kick();
    return;
  }

  exp.addSeq(e.deltaY * SEQ_WHEEL);
  syncMode();
  kick();
}

function onResize() {
  exp.resize();
  kick();
}

async function bootApp() {
  try {
    timeline = await buildTimeline();
    await exp.build(timeline);
    ready = true;
    boot?.classList.add('is-hidden');
    syncMode();
    kick();
  } catch (err) {
    console.error(err);
  }
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', onResize);
bootApp();
