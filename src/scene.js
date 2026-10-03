import * as THREE from 'three';

/**
 * Conversione GPS → spazio locale e costruzione della scena percorso.
 * 1 unità scena ≈ 10 m. Asse Y = quota (esagerata × 1.5).
 */

const METERS_PER_UNIT = 10;
const VERTICAL_EXAG = 1.5;

/** Proietta lat/lon/ele in Vector3 scena, rispetto al primo punto track */
export function projectTrack(track, eleMin) {
  const lat0 = track[0].lat;
  const lon0 = track[0].lon;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  return track.map((p) => {
    const xM = (p.lon - lon0) * 111320 * cosLat;
    const zM = -(p.lat - lat0) * 110540;
    const yM = (p.ele - eleMin) * VERTICAL_EXAG;
    return new THREE.Vector3(
      xM / METERS_PER_UNIT,
      yM / METERS_PER_UNIT,
      zM / METERS_PER_UNIT
    );
  });
}

/** Indice lungo la curva per una distanza sul percorso (metri) */
export function indexAtDistance(track, dist) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < track.length; i++) {
    const d = Math.abs(track[i].dist - dist);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Parametro 0–1 sulla curva dato lo scroll p (allineato a dist) */
export function uFromProgress(track, p) {
  const dist = p * track[track.length - 1].dist;
  const i = indexAtDistance(track, dist);
  return i / Math.max(track.length - 1, 1);
}

export function createScene(canvas, percorso) {
  const { route, track } = percorso;
  const eleMin = route.eleMin;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'low-power'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x2348ff, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2348ff, 0.012);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );

  // Luci minime: lettura del rilievo, non realismo
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.35);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  const points = projectTrack(track, eleMin);
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.08);

  // Linea del percorso (sottile, luminosa)
  const pathGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(600));
  const pathLine = new THREE.Line(
    pathGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  );
  scene.add(pathLine);

  // Proiezione sul piano di base y = 0
  const groundPts = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const groundLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(groundPts),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })
  );
  scene.add(groundLine);

  // Fili verticali ogni N punti: leggono il dislivello
  const N = 8;
  const vertPositions = [];
  for (let i = 0; i < points.length; i += N) {
    const p = points[i];
    vertPositions.push(p.x, 0, p.z, p.x, p.y, p.z);
  }
  const vertGeo = new THREE.BufferGeometry();
  vertGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertPositions, 3));
  const vertLines = new THREE.LineSegments(
    vertGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
  );
  scene.add(vertLines);

  // Marker partenza / arrivo
  addMarker(scene, points[0], 0xffffff);
  addMarker(scene, points[points.length - 1], 0xff3a24);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /** Aggiorna camera lungo la curva; p e pSmooth in [0,1] */
  function updateCamera(pSmooth) {
    const u = THREE.MathUtils.clamp(uFromProgress(track, pSmooth), 0, 0.999);
    const lookU = Math.min(0.999, u + 0.018);

    const pos = curve.getPointAt(u);
    const ahead = curve.getPointAt(lookU);
    const tangent = curve.getTangentAt(u).normalize();

    // Camera leggermente sopra e dietro rispetto alla direzione di salita
    const back = tangent.clone().multiplyScalar(-2.8);
    const up = new THREE.Vector3(0, 1.6, 0);
    camera.position.copy(pos).add(back).add(up);
    camera.lookAt(ahead.x, ahead.y + 0.6, ahead.z);
  }

  /** Campione track alla distanza corrispondente a p */
  function sampleAt(p) {
    const dist = p * track[track.length - 1].dist;
    const i = indexAtDistance(track, dist);
    return track[i];
  }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    renderer,
    scene,
    camera,
    curve,
    points,
    track,
    route,
    resize,
    updateCamera,
    sampleAt,
    render
  };
}

function addMarker(scene, point, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(point.x, 0, point.z),
    new THREE.Vector3(point.x, point.y + 0.4, point.z)
  ]);
  scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  dot.position.copy(point);
  scene.add(dot);
}
