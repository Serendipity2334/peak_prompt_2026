import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';

const MAX_TEX_W = 960;
const Z_GAP = 0.02;

/** Titolo: stesso erase-luma della prima immagine; texture fissa (niente ripaint → niente drift). */
const titleFollowFrag = /* glsl */ `
uniform sampler2D uTitle;
uniform sampler2D uMap;
uniform sampler2D uMapHi;
uniform float uDetailMix;
uniform float uCutoff;
uniform vec2 uResolution;
uniform vec2 uImageSize;
varying vec2 vUv;

vec2 coverUV(vec2 uv, vec2 res, vec2 img) {
  float sA = res.x / max(res.y, 1.0);
  float iA = img.x / max(img.y, 1.0);
  vec2 outUv = uv;
  if (sA > iA) {
    outUv.y = 0.5 + (uv.y - 0.5) * (iA / sA);
  } else {
    outUv.x = 0.5 + (uv.x - 0.5) * (sA / iA);
  }
  return outUv;
}

float photoLuma(vec2 puv) {
  vec3 lo = texture2D(uMap, puv).rgb;
  vec3 hi = texture2D(uMapHi, puv).rgb;
  vec3 photo = mix(lo, hi, clamp(uDetailMix, 0.0, 1.0));
  return dot(photo, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 puv = coverUV(vUv, uResolution, uImageSize);
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) discard;

  // max luma nel vicinato: evita che i bordi dei glifi spariscano prima (= “shrink”)
  vec2 texel = 1.0 / max(uImageSize, vec2(1.0));
  float L = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 q = puv + vec2(float(i), float(j)) * texel * 1.5;
      L = max(L, photoLuma(clamp(q, vec2(0.0), vec2(1.0))));
    }
  }
  if (L < (1.0 - uCutoff)) discard;

  vec4 t = texture2D(uTitle, vUv);
  if (t.a < 0.05) discard;
  vec3 photo = mix(texture2D(uMap, puv).rgb, texture2D(uMapHi, puv).rgb, clamp(uDetailMix, 0.0, 1.0));
  vec3 diff = abs(t.rgb - photo);
  gl_FragColor = vec4(diff, t.a);
}
`;

const TITLE_WORDS = ['reach', 'the', 'light', 'at', 'the', 'peak'];

/** Sfondo morph B/N + noise. uLift 0 = landing scura, 1 = finale chiaro. */
const morphBgFrag = /* glsl */ `
uniform sampler2D uTop;
uniform sampler2D uBot;
uniform float uCutoff;
uniform float uTime;
uniform float uDim;
uniform float uLift;
uniform vec2 uResolution;
uniform vec2 uTopSize;
uniform vec2 uBotSize;
varying vec2 vUv;

vec2 coverUV(vec2 uv, vec2 res, vec2 img) {
  float sA = res.x / max(res.y, 1.0);
  float iA = img.x / max(img.y, 1.0);
  vec2 outUv = uv;
  if (sA > iA) {
    outUv.y = 0.5 + (uv.y - 0.5) * (iA / sA);
  } else {
    outUv.x = 0.5 + (uv.x - 0.5) * (sA / iA);
  }
  return outUv;
}

float sampleLuma(sampler2D map, vec2 uv, vec2 imgSize) {
  vec2 cuv = coverUV(uv, uResolution, imgSize);
  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
    return 0.12;
  }
  vec3 c = texture2D(map, cuv).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float grain(vec2 uv) {
  // grana fine e statica (niente flicker)
  return hash(floor(uv * uResolution * 1.6)) * 2.0 - 1.0;
}

void main() {
  vec2 drift = vec2(
    sin(uTime * 0.11) * 0.018,
    cos(uTime * 0.085 + 1.2) * 0.014
  );
  vec2 uvTop = vUv + drift;
  // offset diverso sul bot → il passaggio si legge meglio
  vec2 uvBot = vUv - drift * 0.7 + vec2(0.03, -0.02);

  float Lt = sampleLuma(uTop, uvTop, uTopSize);
  float Lb = sampleLuma(uBot, uvBot, uBotSize);

  // erase netto tipo sequenza (soglia stretta)
  float edge = step(1.0 - uCutoff, Lt);
  float L = mix(Lb, Lt, edge);

  // invertito; uLift porta la gamma dal molto scuro al quasi bianco
  L = 1.0 - clamp(L, 0.0, 1.0);
  float lo = mix(0.01, 0.90, uLift);
  float hi = mix(0.14, 0.995, uLift);
  L = mix(lo, hi, pow(L, mix(1.2, 0.85, uLift)));
  L += grain(vUv) * mix(0.045, 0.04, uLift);
  float dim = mix(uDim, 1.0, uLift);
  L = clamp(L * dim, 0.0, 1.0);
  gl_FragColor = vec4(vec3(L), 1.0);
}
`;

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

const CLOCK_WEDGES = 10;

function pad2(n) {
  return String(Math.floor(Math.abs(n)) % 100).padStart(2, '0');
}

function formatClockTime(item) {
  if (item && Number.isFinite(Number(item.sortKey))) {
    const sec = Math.max(0, Math.floor(Number(item.sortKey)));
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${pad2(h)}:${pad2(m)}`;
  }
  const parts = String(item?.time || '').split(':');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return '--:--';
}

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
  ctx.font = '700 36px "GT Cinetype", "GTCinetype", sans-serif';
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
  /** @type {THREE.Group | null} */
  let clockGroup = null;
  /** @type {THREE.Mesh[]} */
  let clockLabels = [];
  /** @type {THREE.Mesh | null} */
  let titleMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let titleCanvas = null;
  /** @type {THREE.Mesh | null} */
  let morphBg = null;
  /** @type {THREE.Texture[]} */
  let morphTexs = [];
  let morphIndex = 0;
  let morphT = 0;
  let morphLastTs = 0;
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
    return sizeWithAspect(short * 0.25, meshAspect(mesh));
  }

  function fitRadius() {
    // ring più interno: spazio per tile (anche landscape) + orari esterni
    const short = Math.min(halfW, halfH);
    const portrait = sizeWithAspect(short * 0.25, 0.56);
    const landscape = sizeWithAspect(short * 0.25, 1.6);
    const diag =
      Math.max(
        Math.hypot(portrait.w, portrait.h),
        Math.hypot(landscape.w, landscape.h)
      ) * 0.5;
    const pad = short * 0.26;
    return Math.max(0.42, short - diag - pad);
  }

  function setImageSize(mesh, tex) {
    const img = tex.image;
    const w = img.videoWidth || img.width || 1;
    const h = img.videoHeight || img.height || 1;
    mesh.material.uniforms.uImageSize.value.set(w, h);
    mesh.userData.aspect = w / h;
  }

  function makeSolidTexture(hex = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 4, 4);
    return prepTex(new THREE.CanvasTexture(canvas));
  }

  function makeShaderMat(tex, item = {}) {
    const img = tex.image;
    const iw = img.width || 1;
    const ih = img.height || 1;
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
  }

  /** Ultimo layer della sequenza: sfondo bianco pieno. */
  function makeWhiteEndMesh(index) {
    const tex = makeSolidTexture('#ffffff');
    const mat = makeShaderMat(tex, { light: 1, shadow: 0 });
    mat.uniforms.uDetailMix.value = 1;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.userData.kind = 'end';
    mesh.userData.isEndSlide = true;
    mesh.userData.index = index;
    mesh.userData.item = { kind: 'end', time: '' };
    mesh.userData.video = null;
    mesh.userData.texture = tex;
    mesh.userData.thumbTex = tex;
    mesh.userData.fullReady = true;
    mesh.userData.detail = 1;
    mesh.userData.aspect = 1;
    mesh.userData.angle0 = 0;
    mesh.visible = false;
    return mesh;
  }

  async function makeMesh(item, index) {
    const thumbUrl = item.thumb || item.full || `/${item.imageBW}`;
    const thumbTex = prepTex(await loadTexture(loader, thumbUrl));
    const img = thumbTex.image;
    const iw = img.width || 1;
    const ih = img.height || 1;

    const mat = makeShaderMat(thumbTex, item);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.userData.kind = item.kind || 'photo';
    mesh.userData.isEndSlide = false;
    mesh.userData.index = index;
    mesh.userData.item = item;
    mesh.userData.video = null;
    mesh.userData.texture = thumbTex;
    mesh.userData.thumbTex = thumbTex;
    mesh.userData.floatPhase = Math.random() * Math.PI * 2;
    mesh.userData.floatSpeed = 0.35 + Math.random() * 0.4;
    mesh.userData.floatAmp = 0.01 + Math.random() * 0.008;
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
    if (mesh.userData.isEndSlide || mesh.userData.fullReady) {
      return Promise.resolve();
    }

    const item = items[index];
    if (!item) return Promise.resolve();
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

    await buildClockFace(items);
    await buildTitleOverlay();
    await buildMorphBg(items);

    // fine sequenza → sfondo bianco (non in raggiera)
    const endMesh = makeWhiteEndMesh(n);
    scene.add(endMesh);
    meshes.push(endMesh);

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
      setClockVisible(false);
      layoutTitleOverlay();
      layoutMorphBg();
      // visibilità gestita da tickMorphBg (off in mezzo, on al finale chiaro)
      if (!isEndReveal()) setMorphBgVisible(false);
      updateDetailMix();
      return;
    }

    if (titleMesh) titleMesh.visible = false;
    layoutMorphBg();

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
    // fluttuazione piena a riposo, si attenua chiudendo e sparisce nello zoom
    const floatStr = (1 - m) * (0.25 + 0.75 * (1 - g));

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      if (mesh.userData.isEndSlide) {
        mesh.visible = false;
        continue;
      }
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
        applyFloat(mesh, floatStr);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = 1;
        mesh.material.uniforms.uCutoff.value = 1;
        // noise come landing; entra con lo zoom verso sequenza
        mesh.material.uniforms.uGrain.value = 0.045 * m;
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
        applyFloat(mesh, floatStr);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = hideBehind ? 0 : 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0;
        mesh.renderOrder = n - i;
        mesh.visible = !hideBehind;
      }
    }

    layoutClockFace(m);
    updateDetailMix();
  }

  /** Leggero drift per-tile; strength 1 in landing, si spegne con chiusura/zoom. */
  function applyFloat(mesh, strength) {
    if (strength <= 0.01) return;
    const t = performance.now() * 0.001;
    const ph = mesh.userData.floatPhase || 0;
    const sp = mesh.userData.floatSpeed || 0.5;
    const amp = (mesh.userData.floatAmp || 0.01) * strength;
    mesh.position.x += Math.sin(t * sp + ph) * amp;
    mesh.position.y += Math.cos(t * sp * 0.87 + ph * 1.3) * amp * 0.8;
    mesh.rotation.z += Math.sin(t * sp * 0.55 + ph * 0.7) * 0.014 * strength;
  }

  function setClockVisible(on) {
    if (clockGroup) clockGroup.visible = on;
  }

  /**
   * Orari per i 10 spicchi (niente assi / pallini).
   */
  async function buildClockFace(itemList) {
    disposeClock();
    const list = itemList || [];
    if (!list.length) return;

    try {
      await document.fonts.load('700 36px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* fallback: canvas userà il sans di sistema */
    }

    clockGroup = new THREE.Group();
    clockGroup.renderOrder = -20;

    const n = list.length;
    const wedgeFirst = new Array(CLOCK_WEDGES).fill(-1);
    for (let i = 0; i < n; i++) {
      let wedge = Math.floor((i * CLOCK_WEDGES) / n);
      if (wedge >= CLOCK_WEDGES) wedge = CLOCK_WEDGES - 1;
      if (wedgeFirst[wedge] < 0) wedgeFirst[wedge] = i;
    }

    for (let k = 0; k < CLOCK_WEDGES; k++) {
      const i0 = wedgeFirst[k];
      if (i0 < 0) continue;
      const angle = Math.PI / 2 - (k / CLOCK_WEDGES) * Math.PI * 2;
      const label = makeTimeLabel(formatClockTime(list[i0]));
      label.userData.angle = angle;
      label.userData.wedge = k;
      clockGroup.add(label);
      clockLabels.push(label);
    }

    scene.add(clockGroup);
  }

  function layoutClockFace(m) {
    if (!clockGroup) return;
    const short = Math.min(halfW, halfH);
    const labelW = short * 0.28;
    // appena fuori dalla raggiera delle tile
    const sample = sizeWithAspect(short * 0.25, 1.2);
    const tileOut = Math.hypot(sample.w, sample.h) * 0.5;
    const rLabel = fitRadius() + tileOut + short * 0.055;

    for (const label of clockLabels) {
      const a = label.userData.angle;
      const aspect = label.userData.aspect || 4;
      const lw = labelW;
      const lh = lw / aspect;
      const labelIn =
        (lw * 0.5) * Math.abs(Math.cos(a)) +
        (lh * 0.5) * Math.abs(Math.sin(a));
      const maxR = Math.min(halfW - lw * 0.52, halfH - lh * 0.52);
      const r = Math.min(rLabel + labelIn * 0.05, maxR);
      label.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.08);
      label.scale.set(lw, lh, 1);
      label.rotation.z = 0;
    }

    let opacity = 1;
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;

    for (const label of clockLabels) {
      label.material.opacity = opacity;
    }
    clockGroup.visible = opacity > 0.02;
  }

  function disposeClock() {
    if (clockGroup) scene.remove(clockGroup);
    for (const label of clockLabels) {
      label.material.map?.dispose();
      label.material.dispose();
      label.geometry.dispose();
    }
    clockLabels = [];
    clockGroup = null;
  }

  function paintTitleCanvas() {
    if (!titleCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (titleCanvas.width !== w || titleCanvas.height !== h) {
      titleCanvas.width = w;
      titleCanvas.height = h;
    }
    const ctx = titleCanvas.getContext('2d');
    // scala in CSS px (come il DOM): altrimenti su retina il font resta in px CSS
    // mentre le coordinate sono in device px → testo ~1/dpr più piccolo
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // copia pixel-perfect dal DOM → stessa size della landing
    const spans = document.querySelectorAll('#peak-title .peak-line > span');
    const line = document.querySelector('#peak-title .peak-line');
    if (spans.length && line) {
      const cs = getComputedStyle(line);
      ctx.font = cs.font || `300 ${cs.fontSize} "GT Cinetype", sans-serif`;
      spans.forEach((span) => {
        const r = span.getBoundingClientRect();
        ctx.fillText(span.textContent || '', r.left, r.top + r.height * 0.5);
      });
      return;
    }

    // fallback se il DOM non è pronto (sempre in CSS px)
    const fontPx = Math.min(cssW * 0.072, cssH * 0.12);
    ctx.font = `300 ${fontPx}px "GT Cinetype", "GTCinetype", sans-serif`;
    const pad = cssW * 0.025;
    const widths = TITLE_WORDS.map((word) => ctx.measureText(word).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const gap = TITLE_WORDS.length > 1 ? (cssW - pad * 2 - total) / (TITLE_WORDS.length - 1) : 0;
    let x = pad;
    const y = cssH * 0.5;
    for (let i = 0; i < TITLE_WORDS.length; i++) {
      ctx.fillText(TITLE_WORDS[i], x, y);
      x += widths[i] + gap;
    }
  }

  async function buildTitleOverlay() {
    disposeTitleOverlay();
    try {
      await document.fonts.load('300 48px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    titleCanvas = document.createElement('canvas');
    paintTitleCanvas();
    const tex = prepTex(new THREE.CanvasTexture(titleCanvas));
    tex.premultiplyAlpha = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: titleFollowFrag,
      uniforms: {
        uTitle: { value: tex },
        uMap: { value: tex },
        uMapHi: { value: tex },
        uDetailMix: { value: 0 },
        uCutoff: { value: 1 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(1, 1) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    titleMesh.frustumCulled = false;
    titleMesh.renderOrder = 200;
    titleMesh.visible = false;
    scene.add(titleMesh);
  }

  function layoutTitleOverlay() {
    if (!titleMesh || !meshes[0]) {
      if (titleMesh) titleMesh.visible = false;
      return;
    }
    const mesh0 = meshes[0];
    const { w: fullW, h: fullH } = viewSize();
    // transform fisso a viewport — non dipende dal cutoff
    titleMesh.position.set(0, 0, 0.03);
    titleMesh.scale.set(fullW, fullH, 1);
    titleMesh.rotation.set(0, 0, 0);

    const src = mesh0.material.uniforms;
    const mat = titleMesh.material;
    mat.uniforms.uMap.value = src.uMap.value;
    mat.uniforms.uMapHi.value = src.uMapHi.value;
    mat.uniforms.uDetailMix.value = src.uDetailMix.value;
    mat.uniforms.uCutoff.value = src.uCutoff.value;
    mat.uniforms.uImageSize.value.copy(src.uImageSize.value);
    mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

    const cutoff = src.uCutoff.value;
    titleMesh.visible =
      mode === 'sequence' && mesh0.visible && cutoff > 0.001;
  }

  /** Congela il titolo sulla posizione DOM corrente (chiamare prima di nascondere il DOM). */
  function captureTitleFromDom() {
    if (!titleCanvas || !titleMesh) return;
    paintTitleCanvas();
    const tex = titleMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeTitleOverlay() {
    if (titleMesh) {
      scene.remove(titleMesh);
      titleMesh.material.uniforms.uTitle.value?.dispose();
      titleMesh.material.dispose();
      titleMesh.geometry.dispose();
    }
    titleMesh = null;
    titleCanvas = null;
  }

  function morphTexSize(tex) {
    const img = tex?.image;
    return {
      w: img?.videoWidth || img?.width || 1,
      h: img?.videoHeight || img?.height || 1
    };
  }

  function setMorphPair(index) {
    if (!morphBg || morphTexs.length < 2) return;
    const n = morphTexs.length;
    const i = ((index % n) + n) % n;
    const j = (i + 1) % n;
    morphIndex = i;
    const mat = morphBg.material;
    mat.uniforms.uTop.value = morphTexs[i];
    mat.uniforms.uBot.value = morphTexs[j];
    const a = morphTexSize(morphTexs[i]);
    const b = morphTexSize(morphTexs[j]);
    mat.uniforms.uTopSize.value.set(a.w, a.h);
    mat.uniforms.uBotSize.value.set(b.w, b.h);
    mat.uniforms.uCutoff.value = 1;
  }

  async function buildMorphBg() {
    disposeMorphBg();
    // riusa thumbs della raggiera, campionate lungo la sequenza
    const sources = [];
    const n = meshes.length;
    const target = Math.min(14, Math.max(4, Math.floor(n / 3)));
    const step = Math.max(1, Math.floor(n / target));
    for (let i = 0; i < n; i += step) {
      const mesh = meshes[i];
      if (!mesh || mesh.userData.isEndSlide) continue;
      const tex = mesh.userData.thumbTex;
      if (tex) sources.push(tex);
    }
    if (sources.length < 2) return;

    morphTexs = sources;
    morphIndex = 0;
    morphT = 0;
    morphLastTs = performance.now();

    const a = morphTexSize(morphTexs[0]);
    const b = morphTexSize(morphTexs[1]);
    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: morphBgFrag,
      uniforms: {
        uTop: { value: morphTexs[0] },
        uBot: { value: morphTexs[1] },
        uCutoff: { value: 1 },
        uTime: { value: 0 },
        uDim: { value: 0.85 },
        uLift: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uTopSize: { value: new THREE.Vector2(a.w, a.h) },
        uBotSize: { value: new THREE.Vector2(b.w, b.h) }
      },
      transparent: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    morphBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    morphBg.frustumCulled = false;
    morphBg.renderOrder = -50;
    morphBg.position.set(0, 0, -8);
    scene.add(morphBg);
    layoutMorphBg();
  }

  function setMorphBgVisible(visible) {
    if (morphBg) morphBg.visible = Boolean(visible);
  }

  function layoutMorphBg() {
    if (!morphBg) return;
    const { w, h } = viewSize();
    morphBg.scale.set(w * 1.18, h * 1.18, 1);
    morphBg.position.set(0, 0, -8);
    morphBg.material.uniforms.uResolution.value.set(
      window.innerWidth,
      window.innerHeight
    );
  }

  /** Fine sequenza: ultima slide (o erase verso di essa). */
  function isEndReveal() {
    if (mode !== 'sequence') return false;
    const n = meshes.length;
    if (n < 2) return false;
    return seq >= n - 2 - 1e-4;
  }

  /** Avanza morph B/N + drift; landing scura, finale chiaro. */
  function tickMorphBg(now = performance.now()) {
    if (!morphBg || morphTexs.length < 2) return;

    const endReveal = isEndReveal();
    if (mode !== 'intro' && !endReveal) {
      morphBg.visible = false;
      morphBg.material.uniforms.uLift.value = 0;
      morphLastTs = now;
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (now - morphLastTs) / 1000));
    morphLastTs = now;

    if (endReveal) {
      morphBg.visible = true;
      morphBg.material.uniforms.uLift.value = 1;
      morphBg.material.uniforms.uDim.value = 1;
    } else {
      const g = easeInOut(Math.min(Math.max(intro, 0), 1));
      const m = easeInOut(Math.min(Math.max(intro - 1, 0), 1));
      const fade = Math.max(0, 1 - g * 0.65 - m);
      morphBg.visible = fade > 0.02;
      morphBg.material.uniforms.uLift.value = 0;
      morphBg.material.uniforms.uDim.value = 0.75 * fade;
      if (!morphBg.visible) return;
    }

    morphBg.material.uniforms.uTime.value = now * 0.001;

    // passaggio più veloce e leggibile (~2.4s)
    morphT += dt / 2.4;
    if (morphT >= 1) {
      morphT -= 1;
      setMorphPair(morphIndex + 1);
    }
    // hold breve poi erase deciso
    const t = Math.min(morphT, 1);
    const erase = t < 0.12 ? 0 : (t - 0.12) / 0.88;
    morphBg.material.uniforms.uCutoff.value = 1 - easeInOut(erase);
  }

  function disposeMorphBg() {
    if (morphBg) {
      scene.remove(morphBg);
      morphBg.material.dispose();
      morphBg.geometry.dispose();
    }
    morphBg = null;
    // texture condivise con le tile — non dispose qui
    morphTexs = [];
    morphIndex = 0;
    morphT = 0;
    morphLastTs = 0;
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
      const isEnd = mesh.userData.isEndSlide;
      const cover = isEnd
        ? { w: fullW, h: fullH }
        : coverSize(fullW, fullH, meshAspect(mesh));
      mesh.position.set(0, 0, -i * Z_GAP);
      // stesso sizing del morph finale (aspect immagine, cover viewport)
      mesh.scale.set(cover.w, cover.h, 1);
      mesh.rotation.z = 0;
      mesh.material.uniforms.uCover.value = 0;
      mesh.material.uniforms.uOpacity.value = 1;
      // stessa grana statica della landing
      mesh.material.uniforms.uGrain.value = isEnd ? 0 : 0.045;
      mesh.renderOrder = n - i;

      if (i === n - 1) {
        // sostituita dallo stesso morph della landing (gamma chiara)
        mesh.visible = false;
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
    layoutTitleOverlay();
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

    // foto del titolo dal DOM ancora visibile → posizione bloccata per tutta la sequenza
    captureTitleFromDom();

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
      mesh.visible = !mesh.userData.isEndSlide;
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
    if (morphBg) {
      morphBg.material.uniforms.uResolution.value.copy(res);
    }
    if (titleCanvas && titleMesh) {
      captureTitleFromDom();
    }
    layout();
  }

  function needsIdleMotion() {
    // float tile + morph sfondo in landing / finale chiaro
    return (
      (mode === 'intro' && intro < 1.85) ||
      isEndReveal()
    );
  }

  function render() {
    if (mode === 'intro') {
      layout();
      tickMorphBg(performance.now());
    } else {
      updateDetailMix();
      if (isEndReveal()) tickMorphBg(performance.now());
    }
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
    if (mode === 'sequence') {
      const mesh = meshes[getSeqIndex()];
      if (mesh?.userData.isEndSlide) return mesh.userData.item;
      return items[getSeqIndex()] || null;
    }
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
    disposeClock();
    disposeTitleOverlay();
    disposeMorphBg();
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
    needsIdleMotion,
    /** Cutoff erase della prima immagine (1=piena, 0=sparita). */
    getFirstCutoff: () => {
      if (mode !== 'sequence' || !meshes[0]) return mode === 'intro' ? 1 : 0;
      return meshes[0].material.uniforms.uCutoff.value;
    },
    captureTitleFromDom,
    get count() {
      return items.length;
    },
    resize,
    render
  };
}
