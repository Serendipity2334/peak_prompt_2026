/**
 * Edges — B/N sotto + Sobel blu/rosso; foto e video in ordine cronologico.
 */
import './edges.css';
import percorso from '../../assets/data/percorso.json';
import { createEdgesScene } from './scene.js';

function timeToSec(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

async function loadVideos() {
  const res = await fetch('/cache/videos/manifest.json', { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

const canvas = document.getElementById('c');
const boot = document.getElementById('boot');
const hudIdx = document.getElementById('hud-idx');

const scene = createEdgesScene(canvas);

const WHEEL_SCALE = 0.00135;

let needsRender = true;
let raf = 0;

function pad(n) {
  return String(n).padStart(2, '0');
}

function updateHud(total) {
  const i = scene.getIndex() + 1;
  const n = total || scene.photoCount;
  const item = scene.getPhoto();
  const kind = item?.kind === 'video' ? 'VIDEO' : 'FOTO';
  hudIdx.textContent = `${pad(i)} / ${pad(n)} · ${kind}`;
}

function kick() {
  needsRender = true;
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  raf = 0;
  scene.render();
  // keep rendering while a video is active
  if (scene.hasActiveVideo() || needsRender) {
    needsRender = false;
    raf = requestAnimationFrame(loop);
  } else {
    needsRender = false;
  }
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

async function bootApp() {
  try {
    boot.textContent = 'caricamento edges…';
    const videos = await loadVideos();

    const photoItems = [...percorso.photos]
      .map((p) => ({
        ...p,
        kind: 'photo',
        sortKey: timeToSec(p.time)
      }))
      .sort((a, b) => a.sortKey - b.sortKey);

    // Video in ordine di ripresa (M2U / metadata). L'orologio del camcorder
    // è sfasato: lo allineo alla prima foto così foto e video si mischiano
    // lungo la cronologia del trekking, mantenendo le distanze relative.
    const videoRaw = [...videos]
      .map((v) => ({
        ...v,
        kind: 'video',
        sortKey: Number(v.sortKey) || timeToSec(v.time)
      }))
      .sort((a, b) => a.sortKey - b.sortKey || String(a.id).localeCompare(String(b.id)));

    const offset =
      photoItems.length && videoRaw.length
        ? photoItems[0].sortKey - videoRaw[0].sortKey
        : 0;

    const videoItems = videoRaw.map((v) => ({
      ...v,
      sortKey: v.sortKey + offset
    }));

    const items = [...photoItems, ...videoItems].sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      if (a.kind !== b.kind) return a.kind === 'photo' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });

    boot.textContent = `caricamento ${items.length} elementi…`;
    await scene.build(items);
    boot.classList.add('is-hidden');
    updateHud(items.length);
    kick();
  } catch (err) {
    console.error(err);
    boot.textContent = 'errore caricamento edges';
  }
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('resize', onResize);
bootApp();
