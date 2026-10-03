import * as THREE from 'three';
import eraseVert from './erase.vert.js';
import eraseFrag from './erase.frag.js';

const MAX_TEX_W = 960;
const Z_GAP = 0.02;

function downscaleTexture(texture, maxW = MAX_TEX_W) {
  const img = texture.image;
  if (!img?.width || img.width <= maxW) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const scale = maxW / img.width;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(img, 0, 0, w, h);
  texture.image = canvas;
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function solidTexture(hex) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 4, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/**
 * Stack of fullscreen photo planes on Z.
 * Wheel drives luminance cutoff: darkest pixels erase first, revealing the plane below.
 */
export function createStackScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const loader = new THREE.TextureLoader();

  /** @type {THREE.Mesh[]} */
  let meshes = [];
  /** @type {Array<Record<string, unknown>>} */
  let photos = [];
  /** Continuous progress 0 … n-1 (last slide never erases) */
  let progress = 0;
  /** 0 = original, 1 = full blue→red luminance grade */
  let colorMix = 0;

  function resolution() {
    return new THREE.Vector2(window.innerWidth, window.innerHeight);
  }

  async function makeMesh(photo, i, geo, res) {
    let tex;
    if (photo.solid) {
      tex = solidTexture(photo.solid);
    } else {
      tex = downscaleTexture(await loadTexture(loader, `/${photo.imageBW}`));
    }
    const img = tex.image;
    const mat = new THREE.ShaderMaterial({
      vertexShader: eraseVert,
      fragmentShader: eraseFrag,
      uniforms: {
        uMap: { value: tex },
        uCutoff: { value: 1 },
        uColorMix: { value: photo.solid ? 0 : colorMix },
        uResolution: { value: res.clone() },
        uImageSize: {
          value: new THREE.Vector2(img.width || 1, img.height || 1)
        }
      },
      transparent: false,
      depthWrite: true,
      depthTest: true,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = -i * Z_GAP;
    mesh.renderOrder = photos.length - i;
    mesh.userData.solid = Boolean(photo.solid);
    return mesh;
  }

  async function build(photoList) {
    photos = photoList;
    dispose();

    const res = resolution();
    const geo = new THREE.PlaneGeometry(2, 2);

    meshes = await Promise.all(photos.map((photo, i) => makeMesh(photo, i, geo, res)));
    for (const mesh of meshes) scene.add(mesh);
    applyProgress();
    setColorMix(colorMix);
  }

  function applyProgress() {
    const n = meshes.length;
    if (!n) return;

    const max = Math.max(n - 1, 0);
    const p = Math.min(Math.max(progress, 0), max);

    for (let i = 0; i < n; i++) {
      const mat = meshes[i].material;
      if (i === n - 1) {
        meshes[i].visible = true;
        mat.uniforms.uCutoff.value = 1;
        continue;
      }
      if (p >= i + 1) {
        mat.uniforms.uCutoff.value = 0;
        meshes[i].visible = false;
      } else if (p > i) {
        meshes[i].visible = true;
        mat.uniforms.uCutoff.value = 1 - (p - i);
      } else {
        meshes[i].visible = true;
        mat.uniforms.uCutoff.value = 1;
      }
    }
  }

  function setProgress(value) {
    const max = Math.max(meshes.length - 1, 0);
    progress = Math.min(Math.max(value, 0), max);
    applyProgress();
  }

  function addProgress(delta) {
    setProgress(progress + delta);
  }

  function getIndex() {
    const n = meshes.length;
    if (!n) return 0;
    if (progress >= n - 1) return n - 1;
    return Math.min(Math.floor(progress), n - 1);
  }

  function getPhoto() {
    return photos[getIndex()] || null;
  }

  function getProgress() {
    return progress;
  }

  function setColorMix(value) {
    colorMix = Math.min(Math.max(value, 0), 1);
    for (const mesh of meshes) {
      // solid bookends keep their pure blue / red
      mesh.material.uniforms.uColorMix.value = mesh.userData.solid ? 0 : colorMix;
    }
  }

  function getColorMix() {
    return colorMix;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    const res = new THREE.Vector2(w, h);
    for (const mesh of meshes) {
      mesh.material.uniforms.uResolution.value.copy(res);
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    for (const mesh of meshes) {
      scene.remove(mesh);
      mesh.material.uniforms.uMap.value?.dispose();
      mesh.material.dispose();
    }
    meshes = [];
  }

  return {
    build,
    setProgress,
    addProgress,
    getIndex,
    getPhoto,
    getProgress,
    setColorMix,
    getColorMix,
    resize,
    render,
    get photoCount() {
      return photos.length;
    }
  };
}
