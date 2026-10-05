import { withBase } from './base.js';

const DEG = Math.PI / 180;
const R_EARTH = 6371000;

/**
 * Carica Peak Prompt.gpx e lo proietta in coordinate locali (metri → world).
 * XY = mappa (est, nord), Z = quota (rilievo leggero).
 */
export async function loadRoutePath() {
  const url = withBase('assets/') + encodeURIComponent('Peak Prompt.gpx');
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`GPX ${res.status}`);
  const xml = await res.text();
  const raw = parseTrkpts(xml);
  if (raw.length < 2) throw new Error('GPX senza traccia');

  const lat0 = (raw[0].lat + raw[raw.length - 1].lat) * 0.5;
  const lon0 = (raw[0].lon + raw[raw.length - 1].lon) * 0.5;
  const cosLat = Math.cos(lat0 * DEG);
  const ele0 = raw[0].ele;

  const local = raw.map((p) => {
    const east = (p.lon - lon0) * DEG * R_EARTH * cosLat;
    const north = (p.lat - lat0) * DEG * R_EARTH;
    const up = p.ele - ele0;
    return { east, north, up, lat: p.lat, lon: p.lon, ele: p.ele };
  });

  // distanze cumulative
  let total = 0;
  const cum = [0];
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1];
    const b = local[i];
    total += Math.hypot(b.east - a.east, b.north - a.north);
    cum.push(total);
  }

  // fit in un riquadro world (~1.55 sul lato lungo)
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const p of local) {
    minE = Math.min(minE, p.east);
    maxE = Math.max(maxE, p.east);
    minN = Math.min(minN, p.north);
    maxN = Math.max(maxN, p.north);
  }
  const span = Math.max(maxE - minE, maxN - minN, 1);
  const target = 1.55;
  const scale = target / span;
  const cx = (minE + maxE) * 0.5;
  const cy = (minN + maxN) * 0.5;
  const elevScale = scale * 0.55;

  const points = local.map((p, i) => ({
    x: (p.east - cx) * scale,
    y: (p.north - cy) * scale,
    z: p.up * elevScale,
    dist: cum[i],
    t: total > 0 ? cum[i] / total : 0,
    lat: p.lat,
    lon: p.lon,
    ele: p.ele
  }));

  return {
    points,
    totalDist: total,
    scale,
    projectLatLon(lat, lon, ele = ele0) {
      const east = (lon - lon0) * DEG * R_EARTH * cosLat;
      const north = (lat - lat0) * DEG * R_EARTH;
      const up = ele - ele0;
      return {
        x: (east - cx) * scale,
        y: (north - cy) * scale,
        z: up * elevScale
      };
    },
    /** Posizione lungo la traccia [0..1]. */
    atT(t) {
      const u = Math.min(1, Math.max(0, t));
      const d = u * total;
      return atDistance(points, cum, d);
    },
    nearestLatLon(lat, lon) {
      const east = (lon - lon0) * DEG * R_EARTH * cosLat;
      const north = (lat - lat0) * DEG * R_EARTH;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < local.length; i++) {
        const d = Math.hypot(local[i].east - east, local[i].north - north);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return points[best];
    }
  };
}

function parseTrkpts(xml) {
  const out = [];
  const re =
    /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>[\s\S]*?<ele>([^<]+)/gi;
  let m;
  while ((m = re.exec(xml))) {
    out.push({ lat: Number(m[1]), lon: Number(m[2]), ele: Number(m[3]) });
  }
  return out;
}

function atDistance(points, cum, d) {
  if (d <= 0) return { ...points[0] };
  const last = cum[cum.length - 1];
  if (d >= last) return { ...points[points.length - 1] };
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(points.length - 1, i);
  const span = cum[i1] - cum[i0] || 1;
  const u = (d - cum[i0]) / span;
  const a = points[i0];
  const b = points[i1];
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
    t: a.t + (b.t - a.t) * u,
    dist: d,
    ele:
      Number.isFinite(a.ele) && Number.isFinite(b.ele)
        ? a.ele + (b.ele - a.ele) * u
        : a.ele
  };
}

/**
 * Assegna a ogni item della timeline una posizione world sul percorso.
 */
export function placeItemsOnRoute(items, route) {
  if (!route || !items?.length) return [];

  const t0 = items[0].sortKey;
  const t1 = items[items.length - 1].sortKey || t0 + 1;

  return items.map((it, index) => {
    if (Number.isFinite(it.lat) && Number.isFinite(it.lon)) {
      // agganciata al tracciato (nearest) così lo scroll in raccolta resta sul path
      const p = route.nearestLatLon(it.lat, it.lon);
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        t: p.t
      };
    }
    // video / senza GPS: interpola lungo il tempo tra foto con GPS
    const tNorm =
      t1 === t0 ? index / Math.max(items.length - 1, 1) : (it.sortKey - t0) / (t1 - t0);
    return route.atT(tNorm);
  });
}
