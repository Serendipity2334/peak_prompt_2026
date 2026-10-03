import percorso from '../../assets/data/percorso.json';

/** Foto ordinate da più buia (lightRank 1) a più luminosa (30) */
export function photosByLight() {
  return [...percorso.photos].sort((a, b) => a.lightRank - b.lightRank);
}

/**
 * Costruisce i pannelli scroll: intro · 30 foto · vetta.
 * Altezza foto generosa (per i passi successivi: soglie + zoom).
 */
export function buildScrollPanels(photoPanelsEl) {
  const photos = photosByLight();
  photoPanelsEl.innerHTML = '';

  photos.forEach((photo) => {
    const sec = document.createElement('section');
    sec.className = 'panel photo-panel';
    sec.dataset.panel = 'photo';
    sec.dataset.id = photo.id;
    sec.dataset.rank = String(photo.lightRank);
    sec.id = `photo-${photo.lightRank}`;
    photoPanelsEl.appendChild(sec);
  });

  return photos;
}

/**
 * Progresso globale 0–1 sullo scroll della pagina.
 */
export function globalProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

/**
 * In quale zona siamo: intro | photo | summit
 * e indice foto 0..n-1 se in photo.
 */
export function locateScroll(photos) {
  const intro = document.getElementById('intro');
  const summit = document.getElementById('summit');
  const y = window.scrollY + window.innerHeight * 0.35;
  const introEnd = intro.offsetTop + intro.offsetHeight;
  const summitStart = summit.offsetTop;

  if (y < introEnd) {
    const local = (window.scrollY) / Math.max(intro.offsetHeight, 1);
    return { zone: 'intro', photoIndex: -1, local: Math.min(1, Math.max(0, local)) };
  }
  if (y >= summitStart) {
    const local = (window.scrollY - summitStart) / Math.max(summit.offsetHeight - window.innerHeight, 1);
    return { zone: 'summit', photoIndex: photos.length - 1, local: Math.min(1, Math.max(0, local)) };
  }

  // Tra intro e summit: pannelli foto
  const panels = document.querySelectorAll('.photo-panel');
  let idx = 0;
  for (let i = 0; i < panels.length; i++) {
    const el = panels[i];
    if (y >= el.offsetTop && y < el.offsetTop + el.offsetHeight) {
      idx = i;
      const local = (window.scrollY + window.innerHeight * 0.35 - el.offsetTop) / el.offsetHeight;
      return { zone: 'photo', photoIndex: idx, local: Math.min(1, Math.max(0, local)) };
    }
    if (y >= el.offsetTop) idx = i;
  }
  return { zone: 'photo', photoIndex: idx, local: 0 };
}

/** Mix colore sfondo: blu in intro, verso rosso sulla vetta */
export function backgroundMix(loc, photos) {
  if (loc.zone === 'intro') return 0;
  if (loc.zone === 'summit') return 1;
  // lungo le foto: da quasi-blu a quasi-rosso
  const t = (loc.photoIndex + loc.local) / Math.max(photos.length, 1);
  return Math.min(1, Math.max(0, t));
}
