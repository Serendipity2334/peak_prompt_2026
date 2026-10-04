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
const hudKeepGoing = document.getElementById('hud-keepgoing');
const btnBackDarkness = document.getElementById('btn-back-darkness');

const route = percorso.route || percorso;
const ELE_MIN = Number(route.eleMin) || 2065;
const ELE_MAX = Number(route.eleMax) || 2717;

function formatMetaDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}
if (metaDate) metaDate.textContent = formatMetaDate(route.date).toLowerCase();
if (metaPlace) {
  metaPlace.textContent = [route.from, route.to]
    .filter(Boolean)
    .join(' → ')
    .toLowerCase();
}

function formatEle(m) {
  if (!Number.isFinite(Number(m))) return '— m';
  return `${Math.round(Number(m)).toLocaleString('it-IT')} m`;
}

function formatLight(v) {
  const n = Number(v) * 100;
  if (n >= 99.95) return '100% light';
  const pct = n.toLocaleString('it-IT', {
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
 * Quote sul range percorso 2065→2717; allo sfondo finale luce = 100%.
 */
function syncSeqMetrics() {
  if (!hudEle && !hudLight) return;

  let opacity = 0;
  if (exp.getMode() === 'sequence') {
    const seq = exp.getSeq();
    const n = Math.max(timeline.length, 1);
    // seq arriva a n sull’end slide (meshes = timeline + end)
    const progress = Math.min(1, Math.max(0, seq / n));
    const item = exp.getItem();
    const onEnd = item?.kind === 'end' || progress >= 1 - 1e-4;

    // compare mentre la prima si dissolve; resta visibile anche sul finale
    opacity = onEnd ? 1 : Math.min(1, Math.max(0, seq));

    const idx = exp.getSeqIndex();
    const dataIdx = seq < 1 ? 1 : Math.min(idx, n - 1);
    const dataItem = timeline[dataIdx] || item;
    const metrics = metricsForItem(dataItem, timeline);

    if (opacity > 0) {
      const ele = onEnd
        ? ELE_MAX
        : ELE_MIN + (ELE_MAX - ELE_MIN) * progress;
      const light = onEnd ? 1 : (metrics?.light ?? 0);
      if (hudEle) hudEle.textContent = formatEle(ele);
      if (hudLight) hudLight.textContent = formatLight(light);
    }
  }

  for (const el of [hudEle, hudLight]) {
    if (!el) continue;
    el.style.opacity = String(opacity);
    el.style.visibility = opacity > 0.02 ? 'visible' : 'hidden';
  }

  // keep going è WebGL (stesso extract/threshold)
  if (hudKeepGoing) {
    hudKeepGoing.style.opacity = '0';
    hudKeepGoing.style.visibility = 'hidden';
  }

  syncBackButton();
}

/** Pagina bianca dopo la peak → torna alla landing. */
function syncBackButton() {
  if (!btnBackDarkness) return;
  // dopo che la mucca/montagna si è estratta sullo sfondo bianco
  const onWhite =
    exp.getMode() === 'sequence' && exp.getSeq() >= exp.count + 0.85;
  btnBackDarkness.classList.toggle('is-visible', onWhite);
  btnBackDarkness.setAttribute('aria-hidden', onWhite ? 'false' : 'true');
}

function goBackToDarkness() {
  if (!ready || exp.getMode() !== 'sequence') return;
  exp.exitToIntro(0);
  syncMode();
  kick();
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
btnBackDarkness?.addEventListener('click', goBackToDarkness);
bootApp();
