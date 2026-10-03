import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';

const MAX_TEX_W = 960;
const Z_GAP = 0.02;

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

/** Dimensioni piano con aspect immagine (w/h), lato lungo = maxEdge */
function sizeWithAspect(maxEdge, aspect) {
  const a = Math.max(aspect, 0.05);
  if (a >= 1) return { w: maxEdge, h: maxEdge / a };
  return { w: maxEdge * a, h: maxEdge };
}

/** Piano con aspect immagine che fa cover del viewport (niente stretch) */
function coverSize(viewW, viewH, aspect) {
  const a = Math.max(aspect, 0.05);
  const viewA = viewW / viewH;
  if (viewA > a) return { w: viewW, h: viewW / a };
  return { w: viewH * a, h: viewH };
}

function prepTex(texture) {
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function downscaleTexture(texture, maxW = MAX_TEX_W) {
  const img = texture.image;
  if (!img?.width || img.width <= maxW) return prepTex(texture);
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
  return prepTex(texture);
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function pad2(n) {
  return String(Math.floor(Math.abs(n)) % 100).padStart(2, '0');
}

/** Orario da sortKey (sec) o da stringa HH:MM[:SS]. */
function formatClockTime(item) {
  if (item && Number.isFinite(Number(item.sortKey))) {
    const sec = Math.max(0, Math.floor(Number(item.sortKey)));
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  const parts = String(item?.time || '').split(':');
  if (parts.length >= 2) {
    return parts.length >= 3
      ? `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`
      : `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return '--:--';
}

/** Etichetta orario (canvas → plane) per la raggiera. */
function makeTimeLabel(text) {
  const w = 360;
  const h = 80;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '500 36px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.userData.aspect = w / h;
  mesh.renderOrder = 120;
  return mesh;
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
      const texture = prepTex(new THREE.VideoTexture(video));
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
 * Unica scena: thumbs veloci → morph con crossfade a full → sequenza.
 */
export function createExperience(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  let halfW = 1;
  let halfH = 1;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const loader = new THREE.TextureLoader();

  /** @type {THREE.Mesh[]} */
  let meshes = [];
  /** @type {THREE.Mesh[]} */
  let timeLabels = [];
  /** @type {Array<Record<string, unknown>>} */
  let items = [];
  /** @type {Map<number, Promise<void>>} */
  const fullJobs = new Map();

  let intro = 0;
  let seq = 0;
  /** @type {'intro' | 'sequence'} */
  let mode = 'intro';
  let animRaf = 0;

  function updateCameraFrustum() {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    halfH = 1;
    halfW = aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  function viewSize() {
    return { w: halfW * 2, h: halfH * 2 };
  }

  function meshAspect(mesh) {
    const s = mesh.material.uniforms.uImageSize.value;
    return Math.max(s.x, 1) / Math.max(s.y, 1);
  }

  function tileSizeFor(mesh) {
    const short = Math.min(halfW, halfH);
    return sizeWithAspect(short * 0.28, meshAspect(mesh));
  }

  function fitRadius() {
    // stima con aspect tipico verticale ~0.56; lascia spazio agli orari esterni
    const sample = sizeWithAspect(Math.min(halfW, halfH) * 0.28, 0.56);
    const diag = Math.hypot(sample.w, sample.h) * 0.5;
    const pad = Math.min(halfW, halfH) * 0.18;
    return Math.max(0.5, Math.min(halfW, halfH) - diag - pad);
  }

  function setImageSize(mesh, tex) {
    const img = tex.image;
    const w = img.videoWidth || img.width || 1;
    const h = img.videoHeight || img.height || 1;
    mesh.material.uniforms.uImageSize.value.set(w, h);
    mesh.userData.aspect = w / h;
  }

  async function makeMesh(item, index) {
    const thumbUrl = item.thumb || item.full || `/${item.imageBW}`;
    const thumbTex = prepTex(await loadTexture(loader, thumbUrl));
    const img = thumbTex.image;
    const iw = img.width || 1;
    const ih = img.height || 1;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: edgeFrag,
      uniforms: {
        uMap: { value: thumbTex },
        uMapHi: { value: thumbTex },
        uDetailMix: { value: 0 },
        uCutoff: { value: 1 },
        uLight: { value: Number(item.light) || 0 },
        uShadow: { value: Number(item.shadow) || 0 },
        uCover: { value: 0 },
        uOpacity: { value: 1 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(iw, ih) }
      },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.userData.kind = item.kind || 'photo';
    mesh.userData.index = index;
    mesh.userData.item = item;
    mesh.userData.video = null;
    mesh.userData.texture = thumbTex;
    mesh.userData.thumbTex = thumbTex;
    mesh.userData.fullReady = false;
    mesh.userData.detail = 0;
    mesh.userData.aspect = iw / ih;
    mesh.userData.angle0 = 0;
    return mesh;
  }

  function applyFull(mesh, fullTex) {
    const mat = mesh.material;
    mat.uniforms.uMapHi.value = fullTex;
    setImageSize(mesh, fullTex);
    mesh.userData.texture = fullTex;
    mesh.userData.video = fullTex.userData?.video || null;
    mesh.userData.fullReady = true;
  }

  function ensureFull(index) {
    if (index < 0 || index >= meshes.length) return Promise.resolve();
    if (fullJobs.has(index)) return fullJobs.get(index);

    const mesh = meshes[index];
    if (mesh.userData.fullReady) return Promise.resolve();

    const item = items[index];
    const job = (async () => {
      try {
        let fullTex;
        if (item.kind === 'video') {
          fullTex = await loadVideoTexture(item.full || item.src);
          // allinea al frame della thumb
          try {
            fullTex.userData.video.currentTime = 0.12;
          } catch {
            /* ignore */
          }
        } else {
          fullTex = downscaleTexture(
            await loadTexture(loader, item.full || `/${item.imageBW}`)
          );
        }
        applyFull(mesh, fullTex);
      } catch (err) {
        console.warn('full load failed', index, err);
        // resta sulla thumb
        mesh.userData.fullReady = true;
        mesh.material.uniforms.uMapHi.value = mesh.userData.thumbTex;
      }
    })();

    fullJobs.set(index, job);
    return job;
  }

  function setDetail(mesh, t) {
    const v = Math.min(Math.max(t, 0), 1);
    mesh.userData.detail = v;
    mesh.material.uniforms.uDetailMix.value = v;
  }

  async function build(itemList) {
    disposeMeshes();
    items = itemList;
    const n = items.length;
    if (!n) return;

    updateCameraFrustum();
    fullJobs.clear();

    // solo thumbs → boot veloce
    const batch = 8;
    for (let i = 0; i < n; i += batch) {
      const slice = items.slice(i, i + batch);
      const part = await Promise.all(
        slice.map((item, j) => makeMesh(item, i + j))
      );
      for (const mesh of part) {
        mesh.userData.angle0 =
          Math.PI / 2 - (mesh.userData.index / n) * Math.PI * 2;
        scene.add(mesh);
        meshes.push(mesh);
      }
      layout();
      renderer.render(scene, camera);
    }

    // 8 spicchi equiangolari: un orario per spicchio (primo elemento dello spicchio)
    const WEDGES = 8;
    let prevIdx = -1;
    for (let k = 0; k < WEDGES; k++) {
      const i0 = Math.floor((k * n) / WEDGES);
      if (i0 >= n || i0 === prevIdx) continue;
      prevIdx = i0;
      const label = makeTimeLabel(formatClockTime(items[i0]));
      label.userData.index = i0;
      label.userData.wedge = k;
      // bordo dello spicchio (ogni 45° da ore 12, senso orario)
      label.userData.angle0 = Math.PI / 2 - (k / WEDGES) * Math.PI * 2;
      scene.add(label);
      timeLabels.push(label);
    }

    intro = 0;
    seq = 0;
    mode = 'intro';
    layout();

    // preload full dei primi (transizione senza stacco)
    ensureFull(0);
    ensureFull(1);
    ensureFull(2);
  }

  function updateDetailMix() {
    // durante morph (intro 1→2) porta il dettaglio a 1 se full pronto
    const m = easeInOut(Math.min(Math.max(intro - 1, 0), 1));
    const mesh0 = meshes[0];
    if (!mesh0) return;

    if (mesh0.userData.fullReady) {
      // crossfade allineato al morph (stesso UV cover)
      setDetail(mesh0, Math.max(mesh0.userData.detail, m));
    }

    if (mode === 'sequence') {
      const active = getSeqIndex();
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        if (!mesh.userData.fullReady) continue;
        const near = Math.abs(i - active) <= 1;
        const target = near ? 1 : mesh.userData.detail;
        if (near && mesh.userData.detail < 1) {
          setDetail(mesh, Math.min(1, mesh.userData.detail + 0.08));
        } else if (near) {
          setDetail(mesh, 1);
        }
      }
    }
  }

  function layout() {
    const n = meshes.length;
    if (!n) return;

    const { w: fullW, h: fullH } = viewSize();

    if (mode === 'sequence') {
      layoutSequence(fullW, fullH);
      setTimeLabelsVisible(false);
      updateDetailMix();
      return;
    }

    // prefetch quando si inizia a raggruppare
    if (intro > 0.15) {
      ensureFull(0);
      ensureFull(1);
    }

    // g 0→1: chiusura a ventaglio verso le 12 (niente spin).
    // Elemento 0 resta fermo sulle 12; gli altri chiudono su di lui.
    // m 0→1: lo 0 slitta al centro e scala a cover.
    const g = easeInOut(Math.min(Math.max(intro, 0), 1));
    const m = easeInOut(Math.min(Math.max(intro - 1, 0), 1));
    const spacing = 1 - g;
    const rRing = fitRadius();
    const angleHome = Math.PI / 2; // 12 / posizione fissa dell’elemento 0
    const hideBehind = m > 0.02;

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      const angle0 = mesh.userData.angle0;
      const isFirst = i === 0;
      const aspect = meshAspect(mesh);
      const tile = tileSizeFor(mesh);

      if (isFirst) {
        // fermo sulle 12 per tutta la chiusura; poi slitta al centro
        const homeX = Math.cos(angleHome) * rRing;
        const homeY = Math.sin(angleHome) * rRing;
        const cover = coverSize(fullW, fullH, aspect);

        const x = THREE.MathUtils.lerp(homeX, 0, m);
        const y = THREE.MathUtils.lerp(homeY, 0, m);
        const z = THREE.MathUtils.lerp(0.06, 0, m);
        const sw = THREE.MathUtils.lerp(tile.w, cover.w, m);
        const sh = THREE.MathUtils.lerp(tile.h, cover.h, m);

        mesh.position.set(x, y, z);
        mesh.scale.set(sw, sh, 1);
        mesh.rotation.z = 0; // già dritto alle 12
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.renderOrder = n + 20;
        mesh.visible = true;
      } else {
        // chiusura angolare verso le 12, stesso raggio (ventaglio)
        const angle = angleHome + (angle0 - angleHome) * spacing;
        const rimRot = angle - angleHome;
        const depth = g * (0.02 - Math.abs(i) * 0.0003);
        const sc = THREE.MathUtils.lerp(1, 0.72, g);

        mesh.position.set(
          Math.cos(angle) * rRing,
          Math.sin(angle) * rRing,
          depth
        );
        mesh.scale.set(tile.w * sc, tile.h * sc, 1);
        mesh.rotation.z = THREE.MathUtils.lerp(rimRot, 0, g);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = hideBehind ? 0 : 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.renderOrder = n - i;
        mesh.visible = !hideBehind;
      }
    }

    layoutTimeLabels(rRing, m);
    updateDetailMix();
  }

  function setTimeLabelsVisible(on) {
    for (const label of timeLabels) label.visible = on;
  }

  function layoutTimeLabels(rRing, m) {
    if (!timeLabels.length) return;
    const short = Math.min(halfW, halfH);
    const rLabel = rRing + short * 0.18;
    const labelW = short * 0.3;

    // bounds della prima immagine mentre zoom-a (per “sovrastare” gli orari)
    const mesh0 = meshes[0];
    const cx = mesh0?.position.x ?? 0;
    const cy = mesh0?.position.y ?? 0;
    const halfImgW = (mesh0?.scale.x ?? 0) * 0.5;
    const halfImgH = (mesh0?.scale.y ?? 0) * 0.5;

    for (const label of timeLabels) {
      // posizione fissa di landing — non segue la chiusura a ventaglio
      const angle = label.userData.angle0;
      const x = Math.cos(angle) * rLabel;
      const y = Math.sin(angle) * rLabel;
      const aspect = label.userData.aspect || 4;
      const lw = labelW;
      const lh = lw / aspect;

      label.position.set(x, y, 0.08);
      label.scale.set(lw, lh, 1);
      label.rotation.z = 0;

      let opacity = 1;
      if (m > 0.001 && mesh0) {
        // quanto il bordo dell’immagine in zoom ha raggiunto il centro dell’etichetta
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const marginX = lw * 0.35;
        const marginY = lh * 0.35;
        const coverX = (halfImgW - (dx - marginX)) / Math.max(lw * 0.6, 1e-3);
        const coverY = (halfImgH - (dy - marginY)) / Math.max(lh * 0.6, 1e-3);
        const cover = Math.min(1, Math.max(0, Math.min(coverX, coverY)));
        opacity = 1 - cover;
      }
      if (m > 0.95) opacity = 0;

      label.material.opacity = opacity;
      label.visible = opacity > 0.02;
    }
  }

  function layoutSequence(fullW, fullH) {
    const n = meshes.length;
    const max = Math.max(n - 1, 0);
    const p = Math.min(Math.max(seq, 0), max);
    const active = Math.min(Math.floor(p), n - 1);

    // lazy full intorno all’attivo
    ensureFull(active);
    ensureFull(active + 1);
    ensureFull(active - 1);

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      const cover = coverSize(fullW, fullH, meshAspect(mesh));
      mesh.position.set(0, 0, -i * Z_GAP);
      // stesso sizing del morph finale (aspect immagine, cover viewport)
      mesh.scale.set(cover.w, cover.h, 1);
      mesh.rotation.z = 0;
      mesh.material.uniforms.uCover.value = 0;
      mesh.material.uniforms.uOpacity.value = 1;
      mesh.renderOrder = n - i;

      if (i === n - 1) {
        mesh.visible = true;
        mesh.material.uniforms.uCutoff.value = 1;
        continue;
      }
      if (p >= i + 1) {
        mesh.material.uniforms.uCutoff.value = 0;
        mesh.visible = false;
      } else if (p > i) {
        mesh.visible = true;
        mesh.material.uniforms.uCutoff.value = 1 - (p - i);
      } else {
        mesh.visible = true;
        mesh.material.uniforms.uCutoff.value = 1;
      }
    }
    syncVideos();
  }

  function syncVideos() {
    // in landing: nessun video in play
    if (mode !== 'sequence') {
      for (let i = 0; i < meshes.length; i++) {
        const video = meshes[i].userData.video;
        if (video && !video.paused) video.pause();
      }
      return;
    }
    const active = getSeqIndex();
    for (let i = 0; i < meshes.length; i++) {
      const video = meshes[i].userData.video;
      if (!video) continue;
      const near = Math.abs(i - active) <= 1 && meshes[i].visible;
      if (near) {
        if (video.paused) video.play().catch(() => {});
      } else if (!video.paused) {
        video.pause();
      }
    }
  }

  function getSeqIndex() {
    const n = meshes.length;
    if (!n) return 0;
    if (seq >= n - 1) return n - 1;
    return Math.min(Math.floor(seq), n - 1);
  }

  function setIntro(value) {
    intro = Math.min(Math.max(value, 0), 2);
    if (intro >= 2 - 1e-4) {
      if (mode !== 'sequence') enterSequence();
    } else {
      mode = 'intro';
      layout();
      syncVideos();
    }
  }

  function addIntro(delta) {
    setIntro(intro + delta);
  }

  async function enterSequence() {
    intro = 2;
    // garantisci full sul primo prima del cut (crossfade già in corso)
    await ensureFull(0);
    if (meshes[0]) setDetail(meshes[0], 1);

    mode = 'sequence';
    seq = 0;
    const { w, h } = viewSize();
    layoutSequence(w, h);
    const video = meshes[0]?.userData.video;
    if (video) {
      try {
        video.currentTime = Math.min(video.currentTime || 0.12, 0.2);
      } catch {
        /* ignore */
      }
      video.play().catch(() => {});
    }
    syncVideos();
  }

  function exitToIntro(at = 1.85) {
    mode = 'intro';
    seq = 0;
    intro = Math.min(Math.max(at, 0), 1.999);
    for (const mesh of meshes) {
      mesh.material.uniforms.uCutoff.value = 1;
      mesh.visible = true;
    }
    layout();
    syncVideos();
  }

  function setSeq(value) {
    const max = Math.max(meshes.length - 1, 0);
    seq = Math.min(Math.max(value, 0), max);
    layout();
  }

  function addSeq(delta) {
    setSeq(seq + delta);
  }

  function animateIntroTo(target, { duration = 1400, onUpdate } = {}) {
    if (animRaf) cancelAnimationFrame(animRaf);
    const from = intro;
    const to = Math.min(Math.max(target, 0), 2);
    const t0 = performance.now();
    // avvia full subito
    ensureFull(0);
    ensureFull(1);

    return new Promise((resolve) => {
      const step = async (now) => {
        const u = Math.min(1, (now - t0) / duration);
        setIntro(from + (to - from) * easeInOut(u));
        onUpdate?.(intro, mode);
        if (u < 1) animRaf = requestAnimationFrame(step);
        else {
          animRaf = 0;
          if (mode !== 'sequence' && to >= 2) await enterSequence();
          resolve(intro);
        }
      };
      animRaf = requestAnimationFrame(step);
    });
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateCameraFrustum();
    const res = new THREE.Vector2(window.innerWidth, window.innerHeight);
    for (const mesh of meshes) {
      mesh.material.uniforms.uResolution.value.copy(res);
    }
    layout();
  }

  function render() {
    updateDetailMix();
    if (mode === 'sequence' || intro > 1.3) {
      for (const mesh of meshes) {
        if (mesh.userData.video && mesh.visible && mesh.userData.detail > 0.2) {
          mesh.userData.texture.needsUpdate = true;
        }
      }
    }
    if (mode === 'intro') syncVideos();
    renderer.render(scene, camera);
  }

  function hasActiveVideo() {
    if (mode !== 'sequence') return false;
    return Boolean(meshes[getSeqIndex()]?.userData.video);
  }

  function getItem() {
    if (mode === 'sequence') return items[getSeqIndex()] || null;
    return items[0] || null;
  }

  function disposeMeshes() {
    for (const mesh of meshes) {
      scene.remove(mesh);
      const video = mesh.userData.video;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      const thumb = mesh.userData.thumbTex;
      const hi = mesh.material.uniforms.uMapHi.value;
      thumb?.dispose();
      if (hi && hi !== thumb) hi.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
    meshes = [];
    for (const label of timeLabels) {
      scene.remove(label);
      label.material.map?.dispose();
      label.material.dispose();
      label.geometry.dispose();
    }
    timeLabels = [];
    fullJobs.clear();
  }

  updateCameraFrustum();

  return {
    build,
    addIntro,
    setIntro,
    getIntro: () => intro,
    isIntroComplete: () => mode === 'sequence' || intro >= 2 - 1e-4,
    animateIntroTo,
    enterSequence,
    exitToIntro,
    addSeq,
    setSeq,
    getSeq: () => seq,
    getSeqIndex,
    getMode: () => mode,
    getItem,
    hasActiveVideo,
    get count() {
      return items.length;
    },
    resize,
    render
  };
}
