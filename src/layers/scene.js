import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { layerPaths } from './paths.js';
import bwVert from './bwThreshold.vert.js';
import bwFrag from './bwThreshold.frag.js';

const GAP = 1.15;
const PLANE_W = 4.2;
const MAX_TEX_W = 640;

function downscaleTexture(texture, maxW = MAX_TEX_W) {
  const img = texture.image;
  if (!img?.width || img.width <= maxW) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }
  const scale = maxW / img.width;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.drawImage(img, 0, 0, w, h);
  texture.image = canvas;
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Layer: rosso (davanti) → blu → bianco/nero threshold (sotto).
 * Il B/N si può spegnere per isolare rosso/blu.
 */
export function createLayerScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    40
  );
  camera.position.set(0, 0, GAP * 2.2);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = true;
  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 1.1;
  controls.minDistance = 0.4;
  controls.maxDistance = 10;
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.minPolarAngle = Math.PI * 0.08;

  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();

  /** @type {{ red?: THREE.Mesh, blue?: THREE.Mesh, bw?: THREE.Mesh }} */
  let planes = {};
  let loading = false;
  let currentPhoto = null;
  let bwVisible = true;
  const cache = new Map();

  function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    group.remove(mesh);
  }

  function clearPlanes() {
    disposeMesh(planes.red);
    disposeMesh(planes.blue);
    disposeMesh(planes.bw);
    planes = {};
  }

  function planeSize(texture) {
    const img = texture.image;
    const aspect = img?.width && img?.height ? img.width / img.height : 3 / 4;
    return { w: PLANE_W, h: PLANE_W / aspect };
  }

  function makeCutoutPlane(texture, z) {
    const { w, h } = planeSize(texture);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    return mesh;
  }

  function makeBwPlane(texture, z, threshold) {
    const { w, h } = planeSize(texture);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uThreshold: { value: threshold }
      },
      vertexShader: bwVert,
      fragmentShader: bwFrag,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    mesh.visible = bwVisible;
    return mesh;
  }

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  async function getCachedTriple(photo) {
    const key = photo.id;
    if (cache.has(key)) return cache.get(key);

    const paths = layerPaths(photo);
    const [rawRed, rawBlue, rawBw] = await Promise.all([
      loadTexture(paths.red),
      loadTexture(paths.blue),
      loadTexture(paths.bw)
    ]);

    rawRed.colorSpace = THREE.SRGBColorSpace;
    rawBlue.colorSpace = THREE.SRGBColorSpace;
    rawBw.colorSpace = THREE.SRGBColorSpace;

    const triple = {
      red: downscaleTexture(rawRed),
      blue: downscaleTexture(rawBlue),
      bw: downscaleTexture(rawBw)
    };
    cache.set(key, triple);

    if (cache.size > 6) {
      const first = cache.keys().next().value;
      const old = cache.get(first);
      old.red.dispose();
      old.blue.dispose();
      old.bw.dispose();
      cache.delete(first);
    }
    return triple;
  }

  async function showPhoto(photo) {
    if (loading) return;
    loading = true;
    currentPhoto = photo;

    try {
      const triple = await getCachedTriple(photo);
      clearPlanes();

      const thr = typeof photo.luma === 'number' ? photo.luma : 0.45;
      planes.bw = makeBwPlane(triple.bw, -GAP, thr);
      planes.blue = makeCutoutPlane(triple.blue, 0);
      planes.red = makeCutoutPlane(triple.red, +GAP * 0.55);

      planes.bw.userData.layerName = 'B/N';
      planes.blue.userData.layerName = 'BLU';
      planes.red.userData.layerName = 'ROSSO';

      group.add(planes.bw, planes.blue, planes.red);
      prefetchAround(photo);
    } finally {
      loading = false;
    }
  }

  function prefetchAround(photo) {
    const photos = photo.__list;
    if (!photos) return;
    const i = photos.findIndex((p) => p.id === photo.id);
    [i + 1, i - 1].forEach((j) => {
      if (j >= 0 && j < photos.length) {
        getCachedTriple(photos[j]).catch(() => {});
      }
    });
  }

  function setBwVisible(on) {
    bwVisible = !!on;
    if (planes.bw) planes.bw.visible = bwVisible;
  }

  function toggleBw() {
    setBwVisible(!bwVisible);
    return bwVisible;
  }

  function nearestLayerName() {
    const z = camera.position.z;
    const targets = [
      { name: 'ROSSO', z: GAP * 0.55 },
      { name: 'BLU', z: 0 }
    ];
    if (bwVisible) targets.push({ name: 'B/N', z: -GAP });
    let best = targets[0];
    let bestD = Infinity;
    for (const t of targets) {
      const d = Math.abs(z - t.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best.name;
  }

  function passageSignal() {
    const z = camera.position.z;
    const back = bwVisible ? -GAP - 1.3 : -GAP * 0.5 - 1.3;
    if (z < back) return 'next';
    if (z > GAP + 2.8) return 'prev';
    return null;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function render() {
    controls.update();
    renderer.render(scene, camera);
  }

  function resetFront() {
    camera.position.set(0.15, 0.1, GAP * 2.2);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resetBehindForPrev() {
    const z = bwVisible ? -GAP - 0.85 : -0.9;
    camera.position.set(0.1, 0.05, z);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  return {
    showPhoto,
    nearestLayerName,
    passageSignal,
    resize,
    render,
    resetFront,
    resetBehindForPrev,
    setBwVisible,
    toggleBw,
    get bwVisible() {
      return bwVisible;
    },
    get camera() {
      return camera;
    },
    get controls() {
      return controls;
    },
    get currentPhoto() {
      return currentPhoto;
    },
    get loading() {
      return loading;
    }
  };
}
