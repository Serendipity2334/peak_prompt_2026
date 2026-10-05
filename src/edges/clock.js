import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';
import { withBase } from './base.js';

const THUMB_W = 280;
const TILE_W = 0.38;
const TILE_H = 0.38 * 1.35;

function downscaleToCanvas(source, maxW = THUMB_W) {
  const w0 = source.videoWidth || source.width || 1;
  const h0 = source.videoHeight || source.height || 1;
  const scale = Math.min(1, maxW / w0);
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function textureFromSource(source) {
  const canvas = downscaleToCanvas(source);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function loadVideoFrame(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        resolve(textureFromSource(video));
      } catch (err) {
        reject(err);
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };

    const onErr = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`video thumb failed: ${src}`));
    };

    video.addEventListener('error', onErr);
    video.addEventListener(
      'loadeddata',
      () => {
        const capture = () => finish();
        video.addEventListener('seeked', capture, { once: true });
        try {
          const t = Math.min(0.15, Math.max(0.01, (video.duration || 1) * 0.04));
          if (Math.abs(video.currentTime - t) < 0.001) finish();
          else video.currentTime = t;
        } catch {
          finish();
        }
        setTimeout(finish, 400);
      },
      { once: true }
    );
    video.load();
  });
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

function makeEdgeMaterial(tex, item) {
  const img = tex.image;
  const w = img.videoWidth || img.width || 1;
  const h = img.videoHeight || img.height || 1;
  return new THREE.ShaderMaterial({
    vertexShader: edgeVert,
    fragmentShader: edgeFrag,
    uniforms: {
      uMap: { value: tex },
      uMapHi: { value: tex },
      uDetailMix: { value: 0 },
      uCutoff: { value: 1 },
      uLight: { value: Number(item.light) || 0 },
      uShadow: { value: Number(item.shadow) || 0 },
      uCover: { value: 0 },
      uOpacity: { value: 1 },
      uGrain: { value: 0 },
      uUseAlpha: { value: 0 },
      uRedOnly: { value: 0 },
      uEdgeAmt: { value: 1 },
      uEdgeOnly: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageSize: { value: new THREE.Vector2(w, h) }
    },
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

/**
 * Landing a orologio: stesso ordine e look della sequenza edges.
 * progress 0 → 1: gather CCW; 1 → 2: zoom verso camera; >= 2: complete.
 */
export function createClockLanding(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    80
  );
  camera.position.set(0, 0, 8);

  const root = new THREE.Group();
  scene.add(root);

  /** @type {{ mesh: THREE.Mesh, angle0: number, item: object }[]} */
  let tiles = [];
  let progress = 0;
  let complete = false;
  let animRaf = 0;
  /** Sempre 0: inizio sequenza = primo elemento della raggiera */
  let focusIndex = 0;

  function fitRadius(camZ = camera.position.z) {
    const fov = (camera.fov * Math.PI) / 180;
    const halfH = Math.tan(fov / 2) * camZ;
    const halfW = halfH * camera.aspect;
    const tileDiag = Math.hypot(TILE_W / 2, TILE_H / 2);
    const pad = Math.min(halfW, halfH) * 0.08;
    return Math.max(1.05, Math.min(halfW, halfH) - tileDiag - pad);
  }

  function tileScaleForView() {
    const short = Math.min(window.innerWidth, window.innerHeight);
    return short < 700 ? 0.82 : short < 1000 ? 0.92 : 1;
  }

  async function build(items) {
    disposeTiles();
    const n = items.length;
    if (!n) return;

    focusIndex = 0;
    const geo = new THREE.PlaneGeometry(TILE_W, TILE_H);

    const batch = 6;
    for (let i = 0; i < n; i += batch) {
      const slice = items.slice(i, i + batch);
      const part = await Promise.all(
        slice.map(async (item, j) => {
          const index = i + j;
          let tex;
          try {
            if (item.kind === 'video') {
              tex = await loadVideoFrame(item.src);
            } else {
              tex = textureFromSource(await loadImage(withBase(item.imageBW)));
            }
          } catch {
            const c = document.createElement('canvas');
            c.width = 8;
            c.height = 8;
            const ctx = c.getContext('2d');
            ctx.fillStyle = item.kind === 'video' ? '#ff3a24' : '#1f2dff';
            ctx.fillRect(0, 0, 8, 8);
            tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
          }

          const mat = makeEdgeMaterial(tex, item);
          const mesh = new THREE.Mesh(geo, mat);
          // stesso ordine della sequenza: index 0 alle 12, orario = cronologico
          const angle0 = Math.PI / 2 - (index / n) * Math.PI * 2;
          mesh.userData.kind = item.kind;
          mesh.userData.index = index;
          return { mesh, angle0, item };
        })
      );
      for (const t of part) {
        root.add(t.mesh);
        tiles.push(t);
      }
      layout();
      renderer.render(scene, camera);
    }
    layout();
  }

  function layout() {
    const n = tiles.length;
    if (!n) return;

    const g = easeInOut(Math.min(Math.max(progress, 0), 1));
    const z = easeInOut(Math.min(Math.max(progress - 1, 0), 1));

    const spacing = 1 - g;
    const spin = g * Math.PI * 2;

    camera.position.set(0, 0, THREE.MathUtils.lerp(8, 4.2, z));
    const rMax = fitRadius(camera.position.z);
    const radius = THREE.MathUtils.lerp(rMax, 0, g);

    root.position.set(0, 0, THREE.MathUtils.lerp(0, 5.2, z));
    // zoom più aggressivo: il primo elemento riempie il centro come la sequenza
    root.scale.setScalar(THREE.MathUtils.lerp(1, 4.2, z));
    root.rotation.z = 0;

    const viewScale = tileScaleForView();

    for (let i = 0; i < n; i++) {
      const { mesh, angle0 } = tiles[i];
      const angle = Math.PI / 2 + spin + (angle0 - Math.PI / 2) * spacing;
      const r = radius;
      const isFocus = i === focusIndex;
      const depth =
        g * (isFocus ? 0.1 : 0.015 - Math.abs(i - focusIndex) * 0.0004);
      mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, depth);
      mesh.renderOrder = isFocus ? n + 10 : n - i;
      const rimRot = angle - Math.PI / 2;
      mesh.rotation.z = THREE.MathUtils.lerp(rimRot, 0, g);
      // in zoom solo il primo (inizio sequenza) resta grande e opaco
      const s = viewScale * THREE.MathUtils.lerp(1, isFocus ? 1.55 : 0.55, g);
      mesh.scale.setScalar(s);
      const opacity = isFocus ? 1 : THREE.MathUtils.lerp(1, 0, Math.min(1, g * 1.1 + z));
      mesh.material.uniforms.uCutoff.value = 1;
      mesh.material.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.02;
    }

    camera.lookAt(0, 0, root.position.z);
  }

  function setProgress(value) {
    progress = Math.min(Math.max(value, 0), 2);
    layout();
    complete = progress >= 2 - 1e-4;
  }

  function addProgress(delta) {
    setProgress(progress + delta);
  }

  function getProgress() {
    return progress;
  }

  function isComplete() {
    return progress >= 2 - 1e-4;
  }

  function exitTo(value = 1.85) {
    if (animRaf) {
      cancelAnimationFrame(animRaf);
      animRaf = 0;
    }
    complete = false;
    setProgress(value);
  }

  function animateTo(target, { duration = 1100, onUpdate, onDone } = {}) {
    if (animRaf) cancelAnimationFrame(animRaf);
    const from = progress;
    const to = Math.min(Math.max(target, 0), 2);
    const t0 = performance.now();

    return new Promise((resolve) => {
      const step = (now) => {
        const u = Math.min(1, (now - t0) / duration);
        const e = easeInOut(u);
        setProgress(from + (to - from) * e);
        onUpdate?.(progress);
        if (u < 1) {
          animRaf = requestAnimationFrame(step);
        } else {
          animRaf = 0;
          onDone?.(progress);
          resolve(progress);
        }
      };
      animRaf = requestAnimationFrame(step);
    });
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layout();
  }

  function render() {
    layout();
    renderer.render(scene, camera);
  }

  function disposeTiles() {
    for (const { mesh } of tiles) {
      root.remove(mesh);
      mesh.material.uniforms?.uMap?.value?.dispose();
      mesh.material.dispose();
    }
    tiles = [];
  }

  function dispose() {
    disposeTiles();
    renderer.dispose();
  }

  return {
    build,
    setProgress,
    addProgress,
    getProgress,
    isComplete,
    exitTo,
    animateTo,
    resize,
    render,
    dispose
  };
}
