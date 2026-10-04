import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';

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

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function loadVideoTexture(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = src;
    video.crossOrigin = 'anonymous';
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';

    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      const texture = new THREE.VideoTexture(video);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.userData.video = video;
      resolve(texture);
    };
    const onError = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      reject(new Error(`video load failed: ${src}`));
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    video.load();
  });
}

/**
 * Stack: B/N + edge blu/rosso; foto e video in ordine cronologico.
 */
export function createEdgesScene(canvas) {
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
  let progress = 0;

  function resolution() {
    return new THREE.Vector2(window.innerWidth, window.innerHeight);
  }

  async function makeMesh(item, i, geo, res) {
    let tex;
    if (item.kind === 'video') {
      tex = await loadVideoTexture(item.src);
    } else {
      tex = downscaleTexture(await loadTexture(loader, `/${item.imageBW}`));
    }

    const img = tex.image;
    const w = img.videoWidth || img.width || 1;
    const h = img.videoHeight || img.height || 1;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: edgeFrag,
      uniforms: {
        uMap: { value: tex },
        uCutoff: { value: 1 },
        uLight: { value: Number(item.light) || 0 },
        uShadow: { value: Number(item.shadow) || 0 },
        uCover: { value: 1 },
        uOpacity: { value: 1 },
        uGrain: { value: 0.045 },
        uUseAlpha: { value: 0 },
        uRedOnly: { value: 0 },
        uResolution: { value: res.clone() },
        uImageSize: { value: new THREE.Vector2(w, h) }
      },
      transparent: false,
      depthWrite: true,
      depthTest: true,
      toneMapped: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = -i * Z_GAP;
    mesh.renderOrder = photos.length - i;
    mesh.userData.kind = item.kind || 'photo';
    mesh.userData.video = tex.userData?.video || null;
    mesh.userData.texture = tex;
    return mesh;
  }

  async function build(itemList) {
    photos = itemList;
    dispose();

    const res = resolution();
    const geo = new THREE.PlaneGeometry(2, 2);

    // load in batches to avoid stalling on many videos
    const batch = 4;
    meshes = [];
    for (let i = 0; i < photos.length; i += batch) {
      const slice = photos.slice(i, i + batch);
      const part = await Promise.all(
        slice.map((item, j) => makeMesh(item, i + j, geo, res))
      );
      meshes.push(...part);
    }

    for (const mesh of meshes) scene.add(mesh);
    applyProgress();
    syncVideos();
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
    syncVideos();
  }

  function syncVideos() {
    const active = getIndex();
    for (let i = 0; i < meshes.length; i++) {
      const video = meshes[i].userData.video;
      if (!video) continue;
      const near = Math.abs(i - active) <= 1 && meshes[i].visible;
      if (near) {
        if (video.paused) {
          video.play().catch(() => {});
        }
      } else if (!video.paused) {
        video.pause();
      }
    }
  }

  /** Porta la sequenza a `index` e avvia il video se presente. */
  function playAt(index) {
    const max = Math.max(meshes.length - 1, 0);
    const i = Math.min(Math.max(index, 0), max);
    progress = i;
    applyProgress();
    const video = meshes[i]?.userData.video;
    if (video) {
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      const kickPlay = () => video.play().catch(() => {});
      if (video.readyState >= 2) kickPlay();
      else video.addEventListener('loadeddata', kickPlay, { once: true });
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

  function getProgress() {
    return progress;
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

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    const res = new THREE.Vector2(w, h);
    for (const mesh of meshes) {
      mesh.material.uniforms.uResolution.value.copy(res);
      const tex = mesh.userData.texture;
      const img = tex?.image;
      if (img) {
        const iw = img.videoWidth || img.width || 1;
        const ih = img.videoHeight || img.height || 1;
        mesh.material.uniforms.uImageSize.value.set(iw, ih);
      }
    }
  }

  function render() {
    for (const mesh of meshes) {
      const tex = mesh.userData.texture;
      if (mesh.userData.video && mesh.visible && tex) {
        tex.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
  }

  function hasActiveVideo() {
    const i = getIndex();
    return Boolean(meshes[i]?.userData.video && meshes[i].visible);
  }

  function dispose() {
    for (const mesh of meshes) {
      scene.remove(mesh);
      const video = mesh.userData.video;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      mesh.material.uniforms.uMap.value?.dispose();
      mesh.material.dispose();
    }
    meshes = [];
  }

  return {
    build,
    setProgress,
    addProgress,
    playAt,
    getProgress,
    getIndex,
    getPhoto,
    hasActiveVideo,
    resize,
    render,
    get photoCount() {
      return photos.length;
    }
  };
}
