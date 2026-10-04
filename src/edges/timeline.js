import percorso from '../../assets/data/percorso.json';
import { withBase } from './base.js';

export function timeToSec(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

export function secToTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export async function loadVideos() {
  const res = await fetch(withBase('assets/videos/manifest.json'), {
    cache: 'no-store'
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Se gli orari video sono “collassati” (es. tutti da copia file),
 * ridistribuiscili lungo l’arco delle foto in ordine ID camcorder.
 */
function placeVideosOnPhotoTimeline(videoRaw, photoItems) {
  if (!videoRaw.length) return [];
  if (!photoItems.length) {
    return [...videoRaw].sort(
      (a, b) => a.sortKey - b.sortKey || String(a.id).localeCompare(String(b.id))
    );
  }

  const byId = [...videoRaw].sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  const vMin = Math.min(...byId.map((v) => v.sortKey));
  const vMax = Math.max(...byId.map((v) => v.sortKey));
  const collapsed = vMax - vMin < 5 * 60; // < 5 minuti → non sono orari reali

  if (!collapsed) {
    const offset = photoItems[0].sortKey - byId[0].sortKey;
    return byId
      .map((v) => ({
        ...v,
        sortKey: v.sortKey + offset,
        time: secToTime(v.sortKey + offset)
      }))
      .sort(
        (a, b) => a.sortKey - b.sortKey || String(a.id).localeCompare(String(b.id))
      );
  }

  const t0 = photoItems[0].sortKey;
  const t1 = photoItems[photoItems.length - 1].sortKey;
  const n = byId.length;
  return byId.map((v, i) => {
    const sortKey = n === 1 ? t0 : t0 + (i / (n - 1)) * (t1 - t0);
    return { ...v, sortKey, time: secToTime(sortKey) };
  });
}

/**
 * Foto + video in ordine cronologico lungo il percorso.
 */
export async function buildTimeline() {
  const videos = await loadVideos();

  const photoItems = [...percorso.photos]
    .map((p) => ({
      ...p,
      kind: 'photo',
      sortKey: timeToSec(p.time),
      thumb: withBase(`assets/thumbs/photo-${p.id}.jpg`),
      full: withBase(p.imageBW)
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  const videoRaw = [...videos].map((v) => ({
    ...v,
    kind: 'video',
    sortKey: Number(v.sortKey) || timeToSec(v.time),
    thumb: withBase(v.thumb || `assets/thumbs/video-${v.id}.jpg`),
    full: withBase(v.src)
  }));

  const videoItems = placeVideosOnPhotoTimeline(videoRaw, photoItems);

  return [...photoItems, ...videoItems].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    if (a.kind !== b.kind) return a.kind === 'photo' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}
