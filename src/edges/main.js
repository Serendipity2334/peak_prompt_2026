/**
 * Edges — un solo passaggio continuo: raggiera → morph tile0 → sequenza.
 */
import './edges.css';
import percorso from '../../assets/data/percorso.json';
import { buildTimeline } from './timeline.js';
import { createExperience } from './experience.js';

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const metaCluster = document.getElementById('meta-cluster');
const metaDate = document.getElementById('meta-date');
const metaPlace = document.getElementById('meta-place');
const modeClock = document.getElementById('mode-clock');
const modeLight = document.getElementById('mode-light');
const modePath = document.getElementById('mode-path');
const peakTitle = document.getElementById('peak-title');
const hudEle = document.getElementById('hud-ele');
const hudLight = document.getElementById('hud-light');
const hudKeepGoing = document.getElementById('hud-keepgoing');
const btnBackDarkness = document.getElementById('btn-back-darkness');
const seqTransport = document.getElementById('seq-transport');
const seqRew = document.getElementById('seq-rew');
const seqToggle = document.getElementById('seq-toggle');
const seqFf = document.getElementById('seq-ff');

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
/** Memorizza dove eri: al reload/HMR riparti da lì, non dall’inizio. */
const POS_KEY = 'edges-dev-pos';
/** Velocità indietro (click) e avanti (click) — solo navigazione accelerata. */
const REW_SPEEDS = [1, 2, 3, 5];
const FF_SPEEDS = [1, 2, 3, 4, 5];
/** ×1 già “accelerato” rispetto allo scroll (verso cima / darkness). */
const PLAY_SEQ_PER_SEC = 2.2;
/** Rewind in landing: intro 0→2 (aperta → chiusa → zoom). */
const PLAY_INTRO_PER_SEC = 1.05;

let ready = false;
let needsRender = true;
let raf = 0;
/** @type {Array<Record<string, unknown>>} */
let timeline = [];
/** Indici timeline dei primi 3 video (per scurire i controlli). */
let firstVideoIdxs = [];

const playback = {
  playing: false,
  dir: 1,
  rewIdx: 0,
  ffIdx: 0,
  speed: 1,
  lastTs: 0
};

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

function savePos() {
  if (!ready) return;
  try {
    sessionStorage.setItem(
      POS_KEY,
      JSON.stringify({
        mode: exp.getMode(),
        intro: exp.getIntro(),
        seq: exp.getSeq()
      })
    );
  } catch {
    /* ignore */
  }
}

/**
 * Salto rapido in preview:
 * - ?at=end | ?end  → pagina bianca (dopo la peak)
 * - ?at=peak        → mucca/montagna
 * - ?at=keep        → “keep going”
 * - ?fresh          → ignora posizione salvata
 * Altrimenti ripristina l’ultima posizione (sessionStorage).
 */
async function applyPreviewJump() {
  const params = new URLSearchParams(window.location.search);
  const at =
    params.get('at') ||
    (params.has('end') ? 'end' : params.has('peak') ? 'peak' : '');

  const jumpSeq = async (seq) => {
    await exp.enterSequence();
    exp.setSeq(seq);
    syncMode();
    kick();
  };

  if (at === 'end') {
    await jumpSeq(exp.count + 1);
    return;
  }
  if (at === 'peak') {
    await jumpSeq(exp.count);
    return;
  }
  if (at === 'keep') {
    const k = exp.getKeepGoingIndex?.() ?? -1;
    await jumpSeq(k >= 0 ? k : Math.max(exp.count * 0.55, 1));
    return;
  }
  if (at === '2' || at === 'second') {
    await jumpSeq(1);
    return;
  }

  if (params.has('fresh')) {
    try {
      sessionStorage.removeItem(POS_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (pos?.mode === 'sequence') {
      await jumpSeq(Number(pos.seq) || 0);
      return;
    }
    if (typeof pos?.intro === 'number' && pos.intro > 0.02) {
      exp.setIntro(pos.intro);
    }
  } catch {
    /* ignore */
  }
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
  for (const el of [metaCluster, modeClock, modeLight, modePath]) {
    if (!el) continue;
    el.style.opacity = String(opacity);
    el.style.visibility = opacity > 0.02 ? 'visible' : 'hidden';
  }
  const onLanding = exp.getMode() === 'intro' && opacity > 0.02;
  const view = exp.getLandingView?.() || 'clock';
  if (modeClock) {
    const on = onLanding && view === 'clock';
    modeClock.classList.toggle('is-active', on);
    modeClock.setAttribute('aria-pressed', on ? 'true' : 'false');
    modeClock.style.pointerEvents = opacity > 0.02 ? 'auto' : 'none';
  }
  if (modeLight) {
    const on = onLanding && view === 'light';
    modeLight.classList.toggle('is-active', on);
    modeLight.setAttribute('aria-pressed', on ? 'true' : 'false');
    modeLight.style.pointerEvents = opacity > 0.02 ? 'auto' : 'none';
  }
  if (modePath) {
    const on = onLanding && view === 'path';
    modePath.classList.toggle('is-active', on);
    modePath.setAttribute('aria-pressed', on ? 'true' : 'false');
    modePath.style.pointerEvents = opacity > 0.02 ? 'auto' : 'none';
  }
}

/** Prima modalità: orologio piatto / ruotabile. */
function goClockMode() {
  if (!ready) return;
  stopPlayback();
  exp.setLandingView?.('clock');
  if (exp.getMode() !== 'intro' || exp.getIntro() > 0.02) {
    exp.exitToIntro(0);
  } else {
    exp.resetRingSpin?.();
    exp.setIntro(0);
  }
  kick();
}

/** Terza modalità: asse ombra → luce (lightRank). */
function goLightMode() {
  if (!ready) return;
  stopPlayback();
  exp.setLandingView?.('light');
  if (exp.getMode() !== 'intro' || exp.getIntro() > 0.02) {
    exp.exitToIntro(0);
  } else {
    exp.resetRingSpin?.();
    exp.setIntro(0);
  }
  kick();
}

/** Seconda modalità: media sul percorso GPX. */
function goPathMode() {
  if (!ready) return;
  stopPlayback();
  exp.setLandingView?.('path');
  if (exp.getMode() !== 'intro' || exp.getIntro() > 0.02) {
    exp.exitToIntro(0);
  } else {
    exp.resetRingSpin?.();
    exp.setIntro(0);
  }
  kick();
}

/**
 * Altitudine sx / luce dx: legate alla media in primo piano.
 * Compaiono col 2° elemento; con l’extract della media corrente
 * sfumano insieme a lei (non restano / non saltano a quella dopo).
 * Peak: luce 100%; quote sul range 2065→2717.
 */
function syncSeqMetrics() {
  if (!hudEle && !hudLight) return;

  let opacity = 0;
  let darkerHud = false;
  if (exp.getMode() === 'sequence') {
    const seq = exp.getSeq();
    const n = Math.max(timeline.length, 1);
    // meshes = timeline + end; seq in [i, i+1) = media i in extract
    const progress = Math.min(1, Math.max(0, seq / n));
    const onEnd = seq >= n - 1e-4;

    let dataIdx = 0;
    if (seq < 1) {
      // compare della 1ª: compare la luce della 2ª
      opacity = Math.min(1, Math.max(0, seq));
      dataIdx = Math.min(1, n - 1);
    } else if (onEnd) {
      // mucca + bianco finale: 2717 m / 100% light restano (non svaniscono)
      opacity = 1;
      dataIdx = n - 1;
    } else {
      // media i: piena a local=0, extract → opacity 1→0 (stesso cutoff)
      const i = Math.min(Math.floor(seq), n - 1);
      const local = seq - i;
      opacity = local <= 1e-4 ? 1 : Math.max(0, 1 - local);
      dataIdx = i;
    }

    darkerHud = dataIdx >= 1 && dataIdx <= 3;

    if (opacity > 0.02) {
      const dataItem = timeline[dataIdx];
      const metrics = metricsForItem(dataItem, timeline);
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
    el.classList.toggle('is-darker', darkerHud);
  }

  // keep going è WebGL (stesso extract/threshold)
  if (hudKeepGoing) {
    hudKeepGoing.style.opacity = '0';
    hudKeepGoing.style.visibility = 'hidden';
  }

  syncBackButton();
  syncSeqTransport();
  savePos();
}

function updateTransportLabels() {
  if (seqRew) {
    seqRew.textContent = `◀◀ ×${REW_SPEEDS[playback.rewIdx]}`;
  }
  if (seqFf) {
    seqFf.textContent = `▶▶ ×${FF_SPEEDS[playback.ffIdx]}`;
  }
  if (seqToggle) {
    // solo stop durante lo scrub accelerato; a riposo = riprendi ultima direzione
    seqToggle.textContent = playback.playing ? 'stop' : 'play';
  }
}

/** Dal 2° file fino al media prima della mucca (peak esclusa). */
function inTransportRange() {
  if (exp.getMode() !== 'sequence') return false;
  const seq = exp.getSeq();
  return seq >= 1 - 1e-4 && seq < exp.count - 1e-4;
}

function isOnFirstVideos() {
  if (exp.getMode() !== 'sequence') return false;
  const seqIdx = Math.floor(exp.getSeq());
  return firstVideoIdxs.includes(seqIdx);
}

/** Controlli in basso: scroll = navigazione; pulsanti = solo scrub accelerato. */
function syncSeqTransport() {
  if (!seqTransport) return;
  updateTransportLabels();

  const seqIdx =
    exp.getMode() === 'sequence' ? Math.floor(exp.getSeq()) : -1;
  const darkerHud = seqIdx >= 1 && seqIdx <= 3;
  const darkerVideo = isOnFirstVideos();
  const color = darkerVideo ? '#3a3a3a' : darkerHud ? '#7a7a7a' : '#ffffff';

  // prima i hit DOM (per misurare le posizioni), poi paint WebGL allineato
  const inRange = inTransportRange();
  seqTransport.classList.add('is-hit-only');
  seqTransport.classList.toggle('is-visible', inRange);
  seqTransport.setAttribute('aria-hidden', inRange ? 'false' : 'true');

  exp.setTransportLabels?.(
    seqRew?.textContent || '◀◀ ×1',
    seqToggle?.textContent || 'play',
    seqFf?.textContent || '▶▶ ×1',
    color
  );

  // durante l’extract pre-peak: hit solo finché il WebGL è ancora leggibile
  const hit = exp.isTransportHitActive?.() ?? inRange;
  if (!hit) {
    seqTransport.classList.remove('is-visible');
    seqTransport.setAttribute('aria-hidden', 'true');
  }
}

function startPlayback(dir, speed) {
  playback.playing = true;
  playback.dir = dir;
  playback.speed = speed;
  playback.lastTs = performance.now();
  updateTransportLabels();
  kick();
}

function stopPlayback() {
  playback.playing = false;
  updateTransportLabels();
  syncSeqTransport();
  kick();
}

function onRewClick() {
  if (!ready || exp.getMode() !== 'sequence') return;
  // accelerato verso darkness
  if (playback.playing && playback.dir < 0) {
    playback.rewIdx = (playback.rewIdx + 1) % REW_SPEEDS.length;
  } else {
    playback.rewIdx = 0;
  }
  startPlayback(-1, REW_SPEEDS[playback.rewIdx]);
  syncSeqTransport();
}

function onFfClick() {
  if (!ready || exp.getMode() !== 'sequence') return;
  // accelerato verso la cima (peak)
  if (playback.playing && playback.dir > 0) {
    playback.ffIdx = (playback.ffIdx + 1) % FF_SPEEDS.length;
  } else {
    playback.ffIdx = 0;
  }
  startPlayback(1, FF_SPEEDS[playback.ffIdx]);
  syncSeqTransport();
}

function onToggleClick() {
  if (!ready || exp.getMode() !== 'sequence') return;
  if (playback.playing) {
    stopPlayback();
    return;
  }
  // riprendi scrub accelerato (non sostituto dello scroll)
  if (playback.dir < 0) {
    startPlayback(-1, REW_SPEEDS[playback.rewIdx]);
  } else {
    startPlayback(1, FF_SPEEDS[playback.ffIdx]);
  }
  syncSeqTransport();
}

function tickPlayback(now) {
  if (!playback.playing) return false;
  if (!playback.lastTs) playback.lastTs = now;
  const dt = Math.min(0.05, Math.max(0, (now - playback.lastTs) / 1000));
  playback.lastTs = now;

  if (exp.getMode() === 'sequence') {
    const delta = playback.dir * playback.speed * PLAY_SEQ_PER_SEC * dt;
    const before = exp.getSeq();
    exp.addSeq(delta);
    const after = exp.getSeq();

    // avanti: si ferma sulla peak (mucca), non oltre
    if (playback.dir > 0 && after >= exp.count - 1e-4) {
      exp.setSeq(exp.count);
      stopPlayback();
      return false;
    }
    // indietro: dalla 1ª media continua sulla landing fino alla vista iniziale
    if (playback.dir < 0 && after <= 0.001) {
      exp.exitToIntro(1.85);
      syncMode();
      return true;
    }
    if (Math.abs(after - before) < 1e-6) {
      stopPlayback();
      return false;
    }
    return true;
  }

  // landing: rewind fino alla raggiera aperta (prima vista)
  if (exp.getMode() === 'intro' && playback.dir < 0) {
    const delta = playback.dir * playback.speed * PLAY_INTRO_PER_SEC * dt;
    const before = exp.getIntro();
    exp.addIntro(delta);
    const after = exp.getIntro();
    syncMode();
    if (after <= 0.001) {
      exp.setIntro(0);
      stopPlayback();
      syncMode();
      return false;
    }
    return Math.abs(after - before) >= 1e-6;
  }

  stopPlayback();
  return false;
}

/** Pie’ di pagina dopo la peak → torna alla landing. */
function syncBackButton() {
  if (!btnBackDarkness) return;
  // DOM visibile (difference + GT Cinetype regular, stessa size degli HUD)
  const hit = exp.isBackHitActive?.() ?? false;
  btnBackDarkness.classList.remove('is-hit-only');
  btnBackDarkness.classList.toggle('is-visible', hit);
  btnBackDarkness.setAttribute('aria-hidden', hit ? 'false' : 'true');
}

function goBackToDarkness() {
  if (!ready || exp.getMode() !== 'sequence') return;
  stopPlayback();
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
  const now = performance.now();
  const playing = tickPlayback(now);
  exp.render();
  syncTitleErase();
  syncMetaWithOrari();
  syncSeqMetrics();
  if (
    playing ||
    playback.playing ||
    exp.hasActiveVideo() ||
    exp.needsIdleMotion() ||
    needsRender
  ) {
    needsRender = false;
    raf = requestAnimationFrame(loop);
  } else {
    needsRender = false;
  }
}

function onWheel(e) {
  e.preventDefault();
  if (!ready) return;

  if (playback.playing) stopPlayback();

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
    firstVideoIdxs = timeline
      .map((item, i) => (item.kind === 'video' ? i : -1))
      .filter((i) => i >= 0)
      .slice(0, 3);
    await exp.build(timeline);
    ready = true;
    boot?.classList.add('is-hidden');
    await applyPreviewJump();
    syncMode();
    kick();
  } catch (err) {
    console.error(err);
  }
}

/** Scorciatoie preview: E = end, P = peak, K = keep, 0 = landing. */
function onPreviewKey(e) {
  if (!ready || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const go = async (seqOrNull, intro = null) => {
    if (intro != null) {
      exp.exitToIntro(intro);
    } else {
      await exp.enterSequence();
      exp.setSeq(seqOrNull);
    }
    syncMode();
    kick();
  };

  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    go(exp.count + 1);
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    go(exp.count);
  } else if (e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    const ki = exp.getKeepGoingIndex?.() ?? 0;
    go(Math.max(ki, 0));
  } else if (e.key === '2') {
    e.preventDefault();
    stopPlayback();
    go(1);
  } else if (e.key === '0') {
    e.preventDefault();
    stopPlayback();
    go(null, 0);
  }
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', onResize);
window.addEventListener('keydown', onPreviewKey);
btnBackDarkness?.addEventListener('click', goBackToDarkness);
modeClock?.addEventListener('click', goClockMode);
modeLight?.addEventListener('click', goLightMode);
modePath?.addEventListener('click', goPathMode);
seqRew?.addEventListener('click', onRewClick);
seqFf?.addEventListener('click', onFfClick);
seqToggle?.addEventListener('click', onToggleClick);
bootApp();
