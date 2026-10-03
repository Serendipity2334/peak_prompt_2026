import percorso from '../../assets/data/percorso.json';

export function timeToSec(t) {
  const [h, m, s] = String(t).split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

export async function loadVideos() {
  const res = await fetch('/cache/videos/manifest.json', { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Foto + video in ordine cronologico, con thumb e src full.
 */
export async function buildTimeline() {
  const videos = await loadVideos();

  const photoItems = [...percorso.photos]
    .map((p) => ({
      ...p,
      kind: 'photo',
      sortKey: timeToSec(p.time),
      thumb: `/cache/thumbs/photo-${p.id}.jpg`,
      full: `/${p.imageBW}`
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  const videoRaw = [...videos]
    .map((v) => ({
      ...v,
      kind: 'video',
      sortKey: Number(v.sortKey) || timeToSec(v.time),
      thumb: v.thumb || `/cache/thumbs/video-${v.id}.jpg`,
      full: v.src
    }))
    .sort(
      (a, b) => a.sortKey - b.sortKey || String(a.id).localeCompare(String(b.id))
    );

  const offset =
    photoItems.length && videoRaw.length
      ? photoItems[0].sortKey - videoRaw[0].sortKey
      : 0;

  const videoItems = videoRaw.map((v) => ({
    ...v,
    sortKey: v.sortKey + offset
  }));

  return [...photoItems, ...videoItems].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    if (a.kind !== b.kind) return a.kind === 'photo' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}
