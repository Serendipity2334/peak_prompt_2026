import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';
import { withBase } from './base.js';

const MAX_TEX_W = 960;
const Z_GAP = 0.02;

/**
 * Back to darkness: compare nei buchi extract della mucca, poi pieno sul bianco.
 * Testo scuro (leggibile sul bianco).
 */
/** uFit 0 = cover, 1 = contain. uFitOffsetY = mesh.y / viewH. */
const FIT_UV_GLSL = /* glsl */ `
uniform float uFit;
uniform float uFitOffsetY;
vec2 fitUV(vec2 uv, vec2 res, vec2 img) {
  vec2 src = vec2(uv.x, uv.y - uFitOffsetY);
  float sA = res.x / max(res.y, 1.0);
  float iA = img.x / max(img.y, 1.0);
  vec2 outUv = src;
  if (uFit > 0.5) {
    if (sA > iA) {
      outUv.x = 0.5 + (src.x - 0.5) * (sA / iA);
    } else {
      outUv.y = 0.5 + (src.y - 0.5) * (iA / sA);
    }
  } else {
    if (sA > iA) {
      outUv.y = 0.5 + (src.y - 0.5) * (iA / sA);
    } else {
      outUv.x = 0.5 + (src.x - 0.5) * (sA / iA);
    }
  }
  return outUv;
}
`;

/** UV Y della mucca nel frame (0 basso → 1 alto): la portiamo al centro pagina. */
const END_COW_UV_Y = 0.72;

const backFollowFrag = /* glsl */ `
uniform sampler2D uTitle;
uniform sampler2D uMap;
uniform sampler2D uMapHi;
uniform sampler2D uPrevMap;
uniform sampler2D uPrevMapHi;
uniform float uDetailMix;
uniform float uPrevDetail;
uniform float uCutoff;
uniform float uPrevCutoff;
uniform float uUsePrev;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uPrevSize;
varying vec2 vUv;
${FIT_UV_GLSL}

void main() {
  vec2 puv = fitUV(vUv, uResolution, uImageSize);
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) discard;

  if (uUsePrev > 0.5) {
    vec2 puvP = fitUV(vUv, uResolution, uPrevSize);
    if (puvP.x >= 0.0 && puvP.x <= 1.0 && puvP.y >= 0.0 && puvP.y <= 1.0) {
      vec3 prev = mix(
        texture2D(uPrevMap, puvP).rgb,
        texture2D(uPrevMapHi, puvP).rgb,
        clamp(uPrevDetail, 0.0, 1.0)
      );
      float Lp = dot(prev, vec3(0.2126, 0.7152, 0.0722));
      if (Lp >= (1.0 - uPrevCutoff)) discard;
    }
  }

  vec3 photo = mix(
    texture2D(uMap, puv).rgb,
    texture2D(uMapHi, puv).rgb,
    clamp(uDetailMix, 0.0, 1.0)
  );
  float L = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  if (L < (1.0 - uCutoff)) discard;

  vec4 t = texture2D(uTitle, vUv);
  if (t.a < 0.05) discard;
  gl_FragColor = vec4(0.05, 0.05, 0.05, t.a);
}
`;

/**
 * Worth-it finale: extract + difference (come keep-going).
 * Difference sulla luma B/N (come a schermo); contrasto minimo garantito.
 */
const worthFollowFrag = /* glsl */ `
uniform sampler2D uTitle;
uniform sampler2D uMap;
uniform sampler2D uMapHi;
uniform sampler2D uPrevMap;
uniform sampler2D uPrevMapHi;
uniform float uDetailMix;
uniform float uPrevDetail;
uniform float uCutoff;
uniform float uPrevCutoff;
uniform float uUsePrev;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uPrevSize;
varying vec2 vUv;
${FIT_UV_GLSL}

void main() {
  vec2 puv = fitUV(vUv, uResolution, uImageSize);
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) discard;

  if (uUsePrev > 0.5) {
    vec2 puvP = fitUV(vUv, uResolution, uPrevSize);
    if (puvP.x >= 0.0 && puvP.x <= 1.0 && puvP.y >= 0.0 && puvP.y <= 1.0) {
      vec3 prev = mix(
        texture2D(uPrevMap, puvP).rgb,
        texture2D(uPrevMapHi, puvP).rgb,
        clamp(uPrevDetail, 0.0, 1.0)
      );
      float Lp = dot(prev, vec3(0.2126, 0.7152, 0.0722));
      if (Lp >= (1.0 - uPrevCutoff)) discard;
    }
  }

  vec4 photo4 = mix(
    texture2D(uMap, puv),
    texture2D(uMapHi, puv),
    clamp(uDetailMix, 0.0, 1.0)
  );
  // solo sulla mucca/monte (niente testo nei buchi / sul bianco)
  if (photo4.a < 0.08) discard;

  float L = dot(photo4.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (L < (1.0 - uCutoff)) discard;

  vec4 t = texture2D(uTitle, vUv);
  if (t.a < 0.05) discard;

  // difference sul B/N (allineato a ciò che si vede); = invert se titolo bianco
  vec3 base = vec3(L);
  vec3 diff = abs(t.rgb - base);
  float Ld = dot(diff, vec3(0.2126, 0.7152, 0.0722));
  // se il risultato è troppo vicino allo sfondo, spingi all’opposto
  float sep = abs(Ld - L);
  float fix = 1.0 - smoothstep(0.35, 0.62, sep);
  vec3 ink = mix(vec3(1.0), vec3(0.0), step(0.5, L));
  diff = mix(diff, ink, fix);
  gl_FragColor = vec4(diff, t.a);
}
`;

/**
 * Keep-going: extract/threshold come le slide.
 * uUsePrev: compare nei “buchi” dell’immagine precedente;
 * uCutoff: scompare con l’extract dell’ultima delle due media.
 */
const keepFollowFrag = /* glsl */ `
uniform sampler2D uTitle;
uniform sampler2D uMap;
uniform sampler2D uMapHi;
uniform sampler2D uPrevMap;
uniform sampler2D uPrevMapHi;
uniform float uDetailMix;
uniform float uPrevDetail;
uniform float uCutoff;
uniform float uPrevCutoff;
uniform float uUsePrev;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uPrevSize;
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

void main() {
  vec2 puv = coverUV(vUv, uResolution, uImageSize);
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) discard;

  // compare solo dove la slide precedente è già stata estratta
  if (uUsePrev > 0.5) {
    vec2 puvP = coverUV(vUv, uResolution, uPrevSize);
    if (puvP.x >= 0.0 && puvP.x <= 1.0 && puvP.y >= 0.0 && puvP.y <= 1.0) {
      vec3 prev = mix(
        texture2D(uPrevMap, puvP).rgb,
        texture2D(uPrevMapHi, puvP).rgb,
        clamp(uPrevDetail, 0.0, 1.0)
      );
      float Lp = dot(prev, vec3(0.2126, 0.7152, 0.0722));
      if (Lp >= (1.0 - uPrevCutoff)) discard;
    }
  }

  vec3 photo = mix(
    texture2D(uMap, puv).rgb,
    texture2D(uMapHi, puv).rgb,
    clamp(uDetailMix, 0.0, 1.0)
  );
  float L = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  if (L < (1.0 - uCutoff)) discard;

  vec4 t = texture2D(uTitle, vUv);
  if (t.a < 0.05) discard;
  // difference puro (niente ink/contrasto → non “ingrassa” i glifi)
  vec3 diff = abs(t.rgb - photo);
  gl_FragColor = vec4(diff, t.a);
}
`;

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

/** Sfondo morph B/N + noise. uLift 0 = landing scura, 1 = finale quasi bianco. */
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
  return hash(floor(uv * uResolution * 1.6)) * 2.0 - 1.0;
}

void main() {
  // drift unico e condiviso: se top/bot usano UV diversi,
  // al cambio coppia (bot → top) l’immagine salta di qualche mm
  vec2 drift = vec2(
    sin(uTime * 0.11) * 0.018,
    cos(uTime * 0.085 + 1.2) * 0.014
  );
  vec2 uv = vUv + drift;

  float Lt = sampleLuma(uTop, uv, uTopSize);
  float Lb = sampleLuma(uBot, uv, uBotSize);

  float edge = step(1.0 - uCutoff, Lt);
  float L = mix(Lb, Lt, edge);

  L = 1.0 - clamp(L, 0.0, 1.0);
  // stesso morph; solo il finale (uLift=1) va quasi al bianco
  float lo = mix(0.01, 0.88, uLift);
  float hi = mix(0.14, 0.995, uLift);
  L = mix(lo, hi, pow(L, mix(1.2, 0.9, uLift)));
  L += grain(vUv) * mix(0.045, 0.035, uLift);
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

/** Piano che entra intero nel viewport (letterbox) — per ritagli PNG sulla peak */
function containSize(viewW, viewH, aspect) {
  const a = Math.max(aspect, 0.05);
  const viewA = viewW / viewH;
  if (viewA > a) return { w: viewH * a, h: viewH };
  return { w: viewW, h: viewW / a };
}

function prepTex(texture) {
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Tipografia sequenza: stessa di .hud-data (GT Cinetype regular, --seq-hud-size). */
function applySeqHudFont(ctx, probeId = 'hud-ele') {
  const probe = document.getElementById(probeId);
  const cs = probe ? getComputedStyle(probe) : null;
  if (cs?.fontSize) {
    ctx.font = `400 ${cs.fontSize} "GT Cinetype", "GTCinetype", sans-serif`;
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = cs.letterSpacing || '0px';
    }
    return;
  }
  const rem =
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  ctx.font = `400 ${0.85 * rem}px "GT Cinetype", "GTCinetype", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.06 * rem}px`;
}

/** Schiacciamento verticale frasi/controlli (non ele/luce/meta/orari). */
function seqSquashY() {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--seq-squash-y')
  );
  return Number.isFinite(v) && v > 0 ? v : 0.88;
}

function withSeqSquashY(ctx, cx, cy, draw) {
  const sy = seqSquashY();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, sy);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
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
/** Illuminazione orari landing: uno ogni 2s, senso orario da 14:09. */
const CLOCK_PULSE_MS = 2000;
const CLOCK_PULSE_DIM = 0.22;
const CLOCK_PULSE_START = '14:09';

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
  ctx.font = '400 42px "GT Cinetype", "GTCinetype", sans-serif';
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
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    // fuori schermo ma nel DOM: alcuni browser non decodificano altrimenti
    Object.assign(video.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '-9999px',
      top: '0'
    });
    document.body.appendChild(video);

    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      video.play().catch(() => {});
      const texture = prepTex(new THREE.VideoTexture(video));
      texture.userData.video = video;
      resolve(texture);
    };
    const onError = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      video.remove();
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
  /** Indice in clockLabels da cui parte il pulse (14:09). */
  let clockPulseStart = 0;
  let clockPulseT0 = 0;
  /** @type {THREE.Mesh | null} */
  let titleMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let titleCanvas = null;
  /** @type {THREE.Mesh | null} */
  let keepMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let keepCanvas = null;
  /** Indice timeline per “keep going” (altitudine ~2401); dura 2 media. */
  let keepGoingIndex = -1;
  const KEEP_GOING_SPAN = 2;
  /** @type {THREE.Mesh | null} */
  let worthMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let worthCanvas = null;
  /** Indice slide finale (foto peak) per “it was worth it…”. */
  let worthItIndex = -1;
  const WORTH_IT_TEXT = 'it was worth it. enjoy the light';
  const BACK_TEXT = 'back to darkness';
  /** @type {THREE.Mesh | null} */
  let backMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let backCanvas = null;
  let backHitActive = false;
  /** @type {THREE.Mesh | null} */
  let transportMesh = null;
  /** @type {HTMLCanvasElement | null} */
  let transportCanvas = null;
  /** Label controlli (aggiornate da main). */
  let transportLabels = {
    rew: '◀◀ ×1',
    toggle: 'play',
    ff: '▶▶ ×1',
    color: '#ffffff'
  };
  let transportHitActive = false;
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
        uUseAlpha: { value: 0 },
        uRedOnly: { value: 0 },
        uEdgeAmt: { value: 1 },
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

  /** Ultimo layer: PNG scontornata (solo monte + mucca) + stesso edge delle altre. */
  async function makeEndMesh(index) {
    const url = withBase(
      'assets/images/bianco_nero/8faed4018ee32232e14d4d1b7542b1dc.png?v=9'
    );
    const tex = prepTex(await loadTexture(loader, url));
    tex.premultiplyAlpha = false;
    const img = tex.image;
    const iw = img.width || 1;
    const ih = img.height || 1;
    // light/shadow come le altre foto → stesso rosa/magenta dello screenshot
    const item = { kind: 'end', time: '', light: 0.57, shadow: 0.43 };
    const mat = makeShaderMat(tex, item);
    mat.uniforms.uDetailMix.value = 1;
    mat.uniforms.uMapHi.value = tex;
    mat.uniforms.uEdgeAmt.value = 1;
    mat.uniforms.uUseAlpha.value = 1;
    mat.uniforms.uRedOnly.value = 0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.userData.kind = 'end';
    mesh.userData.isEndSlide = true;
    mesh.userData.index = index;
    mesh.userData.item = item;
    mesh.userData.video = null;
    mesh.userData.texture = tex;
    mesh.userData.thumbTex = tex;
    mesh.userData.fullReady = true;
    mesh.userData.detail = 1;
    mesh.userData.aspect = iw / Math.max(ih, 1);
    mesh.userData.angle0 = 0;
    mesh.visible = false;
    return mesh;
  }

  async function makeMesh(item, index) {
    const thumbUrl = item.thumb || item.full || withBase(item.imageBW);
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
          const video = fullTex.userData.video;
          const active =
            mode === 'sequence' ? getSeqIndex() : mode === 'intro' ? 0 : -1;
          const near = Math.abs(index - active) <= 1;
          // seek solo in prefetch (fuori schermo): in play evita il ritardo
          if (!near) {
            try {
              video.currentTime = 0.12;
            } catch {
              /* ignore */
            }
            video.pause();
          }
        } else {
          fullTex = downscaleTexture(
            await loadTexture(loader, item.full || withBase(item.imageBW))
          );
        }
        applyFull(mesh, fullTex);
        if (item.kind === 'video') {
          const active = mode === 'sequence' ? getSeqIndex() : -1;
          if (mode === 'sequence' && Math.abs(index - active) <= 1) {
            setDetail(mesh, 1);
            fullTex.userData.video?.play().catch(() => {});
          }
          syncVideos();
        }
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
    await buildKeepGoingOverlay();
    await buildWorthItOverlay();
    await buildBackOverlay();
    await buildTransportOverlay();
    await buildMorphBg(items);

    // fine sequenza → foto peak (non in raggiera; stesso stile extract/grana)
    try {
      const endMesh = await makeEndMesh(n);
      scene.add(endMesh);
      meshes.push(endMesh);
      worthItIndex = n;
    } catch (err) {
      console.warn('[edges] end mesh non caricata', err);
      worthItIndex = -1;
    }

    // testo “keep going” sull’immagine a ~2401 m
    const ELE_MIN = 2065;
    const ELE_MAX = 2717;
    const TARGET_ELE = 2401;
    keepGoingIndex = Math.min(
      n - 1,
      Math.max(
        0,
        Math.round(((TARGET_ELE - ELE_MIN) / (ELE_MAX - ELE_MIN)) * (n - 1))
      )
    );

    intro = 0;
    seq = 0;
    mode = 'intro';
    layout();

    // preload full dei primi + prefetch video in background (no stacco in sequenza)
    ensureFull(0);
    ensureFull(1);
    ensureFull(2);
    void prefetchVideoFulls();
  }

  /** Carica i full video in anticipo (2 alla volta) così partono subito in sequenza. */
  async function prefetchVideoFulls() {
    const idxs = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind === 'video') idxs.push(i);
    }
    for (let i = 0; i < idxs.length; i += 2) {
      await Promise.all(idxs.slice(i, i + 2).map((j) => ensureFull(j)));
    }
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
      layoutKeepGoingOverlay();
      layoutWorthItOverlay();
      layoutBackOverlay();
      layoutTransportOverlay();
      layoutMorphBg();
      // visibilità gestita da tickMorphBg (off in mezzo, on al finale chiaro)
      if (!isEndReveal()) setMorphBgVisible(false);
      updateDetailMix();
      return;
    }

    if (titleMesh) titleMesh.visible = false;
    if (keepMesh) keepMesh.visible = false;
    if (worthMesh) worthMesh.visible = false;
    syncWorthItDom(false);
    if (backMesh) backMesh.visible = false;
    backHitActive = false;
    if (transportMesh) transportMesh.visible = false;
    transportHitActive = false;
    layoutMorphBg();

    // prefetch quando si inizia a raggruppare
    if (intro > 0.15) {
      ensureFull(0);
      ensureFull(1);
    }

    // g 0→1: chiusura a ventaglio verso le 12 (già aperta all’inizio).
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
      await document.fonts.load('400 42px "GT Cinetype"');
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
      const timeText = formatClockTime(list[i0]);
      const label = makeTimeLabel(timeText);
      label.userData.angle = angle;
      label.userData.wedge = k;
      label.userData.timeText = timeText;
      clockGroup.add(label);
      clockLabels.push(label);
    }

    // clockLabels è già in ordine orario (k=0 alle 12 → senso orario)
    const startIdx = clockLabels.findIndex(
      (l) => l.userData.timeText === CLOCK_PULSE_START
    );
    clockPulseStart = startIdx >= 0 ? startIdx : 0;
    clockPulseT0 = performance.now();

    scene.add(clockGroup);
  }

  function layoutClockFace(m) {
    if (!clockGroup) return;
    const short = Math.min(halfW, halfH);
    const labelW = short * 0.32;
    // appena fuori dalla raggiera delle tile
    const sample = sizeWithAspect(short * 0.25, 1.2);
    const tileOut = Math.hypot(sample.w, sample.h) * 0.5;
    const rLabel = fitRadius() + tileOut + short * 0.055;

    let opacity = 1;
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;

    const nLab = clockLabels.length;
    const step =
      nLab > 0
        ? Math.floor(
            Math.max(0, performance.now() - clockPulseT0) / CLOCK_PULSE_MS
          ) % nLab
        : 0;
    const active = nLab > 0 ? (clockPulseStart + step) % nLab : 0;

    for (let i = 0; i < nLab; i++) {
      const label = clockLabels[i];
      const a = label.userData.angle;
      const aspect = label.userData.aspect || 4;
      const lw = labelW;
      const lh = lw / aspect;
      const labelIn =
        (lw * 0.5) * Math.abs(Math.cos(a)) +
        (lh * 0.5) * Math.abs(Math.sin(a));
      const maxR = Math.min(halfW - lw * 0.52, halfH - lh * 0.52);
      const r = Math.min(rLabel + labelIn * 0.05, maxR);
      const lit = i === active ? 1 : CLOCK_PULSE_DIM;
      const pop = i === active ? 1.08 : 1;
      label.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.08);
      label.scale.set(lw * pop, lh * pop, 1);
      label.rotation.z = 0;
      label.material.opacity = opacity * lit;
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
    clockPulseStart = 0;
    clockPulseT0 = 0;
  }

  /** Baseline alfabetica reale della riga DOM (marker inline-block). */
  function readDomBaselineY(line) {
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText =
      'display:inline-block;width:0;height:1px;padding:0;border:0;margin:0;vertical-align:baseline;overflow:hidden;';
    line.appendChild(marker);
    // bottom del box allineato alla baseline della riga
    const y = marker.getBoundingClientRect().bottom;
    line.removeChild(marker);
    return y;
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
    ctx.textBaseline = 'alphabetic';

    // misura senza scaleY DOM, poi schiaccia in canvas come il CSS
    const spans = document.querySelectorAll('#peak-title .peak-line > span');
    const line = document.querySelector('#peak-title .peak-line');
    if (spans.length && line) {
      line.style.transform = 'none';
      const cs = getComputedStyle(line);
      ctx.font = `400 ${cs.fontSize} "GT Cinetype", "GTCinetype", sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing || '0px';
      const xs = Array.from(spans, (span) => span.getBoundingClientRect().left);
      const baseY = readDomBaselineY(line);
      const box = line.getBoundingClientRect();
      const cx = box.left + box.width * 0.5;
      line.style.removeProperty('transform');
      withSeqSquashY(ctx, cx, baseY, () => {
        spans.forEach((span, i) => {
          ctx.fillText(span.textContent || '', xs[i], baseY);
        });
      });
      return;
    }

    // fallback se il DOM non è pronto — blocco centrato
    const fontPx = Math.min(cssW * 0.045, 36);
    ctx.font = `400 ${fontPx}px "GT Cinetype", "GTCinetype", sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${fontPx * 0.02}px`;
    const gap = fontPx * 0.35;
    const widths = TITLE_WORDS.map((word) => ctx.measureText(word).width);
    const total =
      widths.reduce((a, b) => a + b, 0) + gap * (TITLE_WORDS.length - 1);
    let x = (cssW - total) * 0.5;
    const y = cssH * 0.5 + fontPx * 0.35;
    const cx = cssW * 0.5;
    withSeqSquashY(ctx, cx, y, () => {
      let xx = x;
      for (let i = 0; i < TITLE_WORDS.length; i++) {
        ctx.fillText(TITLE_WORDS[i], xx, y);
        xx += widths[i] + gap;
      }
    });
  }

  async function buildTitleOverlay() {
    disposeTitleOverlay();
    try {
      await document.fonts.load('400 18px "GT Cinetype"');
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

  function paintKeepGoingCanvas() {
    if (!keepCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (keepCanvas.width !== w || keepCanvas.height !== h) {
      keepCanvas.width = w;
      keepCanvas.height = h;
    }
    const ctx = keepCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    applySeqHudFont(ctx, 'hud-keepgoing');
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
    const cx = cssW * 0.5;
    const cy = cssH * 0.5;
    withSeqSquashY(ctx, cx, cy, () => {
      // solo fill Regular — niente stroke (pare bold)
      ctx.fillText("keep going, don't give up", cx, cy);
    });
  }

  async function buildKeepGoingOverlay() {
    disposeKeepGoingOverlay();
    try {
      await document.fonts.load('400 16px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    keepCanvas = document.createElement('canvas');
    paintKeepGoingCanvas();
    const tex = prepTex(new THREE.CanvasTexture(keepCanvas));
    tex.premultiplyAlpha = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: keepFollowFrag,
      uniforms: {
        uTitle: { value: tex },
        uMap: { value: tex },
        uMapHi: { value: tex },
        uPrevMap: { value: tex },
        uPrevMapHi: { value: tex },
        uDetailMix: { value: 0 },
        uPrevDetail: { value: 0 },
        uCutoff: { value: 1 },
        uPrevCutoff: { value: 0 },
        uUsePrev: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(1, 1) },
        uPrevSize: { value: new THREE.Vector2(1, 1) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    keepMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    keepMesh.frustumCulled = false;
    keepMesh.renderOrder = 201;
    keepMesh.visible = false;
    scene.add(keepMesh);
  }

  function layoutKeepGoingOverlay() {
    if (!keepMesh || keepGoingIndex < 0 || mode !== 'sequence') {
      if (keepMesh) keepMesh.visible = false;
      return;
    }

    const i0 = keepGoingIndex;
    const i1 = Math.min(i0 + KEEP_GOING_SPAN - 1, items.length - 1);
    const p = seq;
    // finestra: reveal del 1° → resta su 2 media → extract del 2°
    if (p <= i0 - 1 || p >= i1 + 1) {
      keepMesh.visible = false;
      return;
    }

    let hostIdx = i0;
    let cutoff = 1;
    let usePrev = 0;
    let prevIdx = -1;
    let prevCutoff = 0;

    if (p < i0) {
      // compare nei buchi dell’extract della slide precedente
      hostIdx = i0;
      cutoff = 1;
      usePrev = 1;
      prevIdx = i0 - 1;
      prevCutoff = 1 - (p - (i0 - 1));
    } else if (p < i1) {
      // sulle due media: testo pieno (non segue l’erase del 1°)
      hostIdx = p >= i0 + 1 ? i1 : i0;
      cutoff = 1;
    } else {
      // scompare con l’extract della 2ª media
      hostIdx = i1;
      cutoff = 1 - (p - i1);
    }

    const mesh = meshes[hostIdx];
    if (!mesh || mesh.userData.isEndSlide) {
      keepMesh.visible = false;
      return;
    }

    const { w: fullW, h: fullH } = viewSize();
    keepMesh.position.set(0, 0, 0.035);
    keepMesh.scale.set(fullW, fullH, 1);
    keepMesh.rotation.set(0, 0, 0);

    const src = mesh.material.uniforms;
    const mat = keepMesh.material;
    mat.uniforms.uMap.value = src.uMap.value;
    mat.uniforms.uMapHi.value = src.uMapHi.value;
    mat.uniforms.uDetailMix.value = src.uDetailMix.value;
    mat.uniforms.uCutoff.value = cutoff;
    mat.uniforms.uImageSize.value.copy(src.uImageSize.value);
    mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    mat.uniforms.uUsePrev.value = usePrev;

    if (usePrev && prevIdx >= 0 && meshes[prevIdx]) {
      const prev = meshes[prevIdx].material.uniforms;
      mat.uniforms.uPrevMap.value = prev.uMap.value;
      mat.uniforms.uPrevMapHi.value = prev.uMapHi.value;
      mat.uniforms.uPrevDetail.value = prev.uDetailMix.value;
      mat.uniforms.uPrevCutoff.value = prevCutoff;
      mat.uniforms.uPrevSize.value.copy(prev.uImageSize.value);
    }

    keepMesh.visible = cutoff > 0.001;
  }

  function captureKeepGoingFromDom() {
    if (!keepCanvas || !keepMesh) return;
    paintKeepGoingCanvas();
    const tex = keepMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeKeepGoingOverlay() {
    if (keepMesh) {
      scene.remove(keepMesh);
      keepMesh.material.uniforms.uTitle.value?.dispose();
      keepMesh.material.dispose();
      keepMesh.geometry.dispose();
    }
    keepMesh = null;
    keepCanvas = null;
  }

  function paintWorthItCanvas() {
    if (!worthCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (worthCanvas.width !== w || worthCanvas.height !== h) {
      worthCanvas.width = w;
      worthCanvas.height = h;
    }
    const ctx = worthCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    applySeqHudFont(ctx, 'hud-worthit');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = cssW * 0.5;
    const y = cssH * 0.5;
    withSeqSquashY(ctx, x, y, () => {
      // alone bianco: sotto difference resta l’invert leggibile su chiaro/scuro
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.15;
      ctx.strokeText(WORTH_IT_TEXT, x, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(WORTH_IT_TEXT, x, y);
    });
  }

  async function buildWorthItOverlay() {
    disposeWorthItOverlay();
    try {
      await document.fonts.load('400 16px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    worthCanvas = document.createElement('canvas');
    paintWorthItCanvas();
    const tex = prepTex(new THREE.CanvasTexture(worthCanvas));
    tex.premultiplyAlpha = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: worthFollowFrag,
      uniforms: {
        uTitle: { value: tex },
        uMap: { value: tex },
        uMapHi: { value: tex },
        uPrevMap: { value: tex },
        uPrevMapHi: { value: tex },
        uDetailMix: { value: 0 },
        uPrevDetail: { value: 0 },
        uCutoff: { value: 1 },
        uPrevCutoff: { value: 0 },
        uUsePrev: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(1, 1) },
        uPrevSize: { value: new THREE.Vector2(1, 1) },
        uFit: { value: 1 },
        uFitOffsetY: { value: 0 }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    worthMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    worthMesh.frustumCulled = false;
    worthMesh.renderOrder = 202;
    worthMesh.visible = false;
    scene.add(worthMesh);
  }

  /** Worth-it DOM: visibile dalla mucca in poi. */
  function syncWorthItDom(live, opacity = 1) {
    const el = document.getElementById('hud-worthit');
    if (!el) return;
    el.classList.toggle('is-live', live);
    el.classList.remove('is-on-light');
    el.style.opacity = live ? String(opacity) : '';
    el.setAttribute('aria-hidden', live ? 'false' : 'true');
  }

  /**
   * “it was worth it”: compare con la mucca (reveal), resta sul bianco finale.
   */
  function layoutWorthItOverlay() {
    if (worthMesh) worthMesh.visible = false;

    if (worthItIndex < 0 || mode !== 'sequence') {
      syncWorthItDom(false);
      return;
    }

    const i0 = worthItIndex;
    const p = seq;

    // nascosto finché non inizia a comparire la mucca
    if (p <= i0 - 1) {
      syncWorthItDom(false);
      return;
    }

    // fade insieme alla reveal della mucca; poi pieno fino alla fine
    const opacity = p < i0 ? Math.min(Math.max(p - (i0 - 1), 0), 1) : 1;
    syncWorthItDom(true, opacity);
  }

  function captureWorthItFromDom() {
    if (!worthCanvas || !worthMesh) return;
    paintWorthItCanvas();
    const tex = worthMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeWorthItOverlay() {
    syncWorthItDom(false);
    if (worthMesh) {
      scene.remove(worthMesh);
      worthMesh.material.uniforms.uTitle.value?.dispose();
      worthMesh.material.dispose();
      worthMesh.geometry.dispose();
    }
    worthMesh = null;
    worthCanvas = null;
  }

  function paintBackCanvas() {
    if (!backCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (backCanvas.width !== w || backCanvas.height !== h) {
      backCanvas.width = w;
      backCanvas.height = h;
    }
    const ctx = backCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // stesso size degli HUD; schiacciato come #btn-back-darkness
    applySeqHudFont(ctx, 'hud-ele');
    ctx.fillStyle = '#050505';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = cssW * 0.5;
    const y = cssH - 1.15 * (
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    );
    const probe = document.getElementById('hud-ele');
    const fs = probe
      ? parseFloat(getComputedStyle(probe).fontSize)
      : (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) *
        0.85;
    withSeqSquashY(ctx, x, y, () => {
      ctx.fillText(BACK_TEXT, x, y);
      const tw = ctx.measureText(BACK_TEXT).width;
      ctx.strokeStyle = '#050505';
      ctx.lineWidth = Math.max(1, fs * 0.07);
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.5, y + fs * 0.55);
      ctx.lineTo(x + tw * 0.5, y + fs * 0.55);
      ctx.stroke();
    });
  }

  async function buildBackOverlay() {
    disposeBackOverlay();
    try {
      await document.fonts.load('400 16px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    backCanvas = document.createElement('canvas');
    paintBackCanvas();
    const tex = prepTex(new THREE.CanvasTexture(backCanvas));
    tex.premultiplyAlpha = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: backFollowFrag,
      uniforms: {
        uTitle: { value: tex },
        uMap: { value: tex },
        uMapHi: { value: tex },
        uPrevMap: { value: tex },
        uPrevMapHi: { value: tex },
        uDetailMix: { value: 0 },
        uPrevDetail: { value: 0 },
        uCutoff: { value: 1 },
        uPrevCutoff: { value: 0 },
        uUsePrev: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(1, 1) },
        uPrevSize: { value: new THREE.Vector2(1, 1) },
        uFit: { value: 1 },
        uFitOffsetY: { value: 0 }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    backMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    backMesh.frustumCulled = false;
    backMesh.renderOrder = 204;
    backMesh.visible = false;
    scene.add(backMesh);
  }

  /**
   * Back to darkness: DOM a pie’ di pagina (stesso font degli HUD).
   * Visibile da quando la mucca inizia a estrarsi, poi sul bianco.
   */
  function layoutBackOverlay() {
    if (backMesh) backMesh.visible = false;
    backHitActive = false;

    if (worthItIndex < 0 || mode !== 'sequence') return;

    const i0 = worthItIndex;
    const p = seq;
    // da extract mucca in poi
    if (p < i0) return;

    if (p < i0 + 1) {
      const prevCutoff = 1 - (p - i0);
      backHitActive = prevCutoff < 0.92;
      return;
    }

    backHitActive = true;
  }

  function captureBackFromDom() {
    if (!backCanvas || !backMesh) return;
    paintBackCanvas();
    const tex = backMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeBackOverlay() {
    if (backMesh) {
      scene.remove(backMesh);
      backMesh.material.uniforms.uTitle.value?.dispose();
      backMesh.material.dispose();
      backMesh.geometry.dispose();
    }
    backMesh = null;
    backCanvas = null;
    backHitActive = false;
  }

  function paintTransportCanvas() {
    if (!transportCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (transportCanvas.width !== w || transportCanvas.height !== h) {
      transportCanvas.width = w;
      transportCanvas.height = h;
    }
    const ctx = transportCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // stesso size degli HUD; schiacciato come i bottoni transport
    applySeqHudFont(ctx, 'hud-ele');
    const ink = transportLabels.color || '#ffffff';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    ctx.lineWidth = Math.max(1, rem * 0.06);

    const paintLabel = (text, x, y, underline) => {
      withSeqSquashY(ctx, x, y, () => {
        ctx.fillText(text, x, y);
        if (!underline) return;
        const tw = ctx.measureText(text).width;
        ctx.beginPath();
        ctx.moveTo(x - tw * 0.5, y + rem * 0.55);
        ctx.lineTo(x + tw * 0.5, y + rem * 0.55);
        ctx.stroke();
      });
    };

    // allinea ai hit-target DOM (#seq-rew / toggle / ff)
    const ids = ['seq-rew', 'seq-toggle', 'seq-ff'];
    const texts = [
      transportLabels.rew,
      transportLabels.toggle,
      transportLabels.ff
    ];
    let painted = false;
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.5;
      // play/stop sottolineato (come back to darkness)
      paintLabel(texts[i], x, y, ids[i] === 'seq-toggle');
      painted = true;
    }
    if (!painted) {
      const y = cssH - 1.15 * rem;
      const gap = Math.min(cssW * 0.12, 96);
      const cx = cssW * 0.5;
      paintLabel(transportLabels.rew, cx - gap, y, false);
      paintLabel(transportLabels.toggle, cx, y, true);
      paintLabel(transportLabels.ff, cx + gap, y, false);
    }
  }

  async function buildTransportOverlay() {
    disposeTransportOverlay();
    try {
      await document.fonts.load('400 14px "GT Cinetype"');
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    transportCanvas = document.createElement('canvas');
    paintTransportCanvas();
    const tex = prepTex(new THREE.CanvasTexture(transportCanvas));
    tex.premultiplyAlpha = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert,
      fragmentShader: keepFollowFrag,
      uniforms: {
        uTitle: { value: tex },
        uMap: { value: tex },
        uMapHi: { value: tex },
        uPrevMap: { value: tex },
        uPrevMapHi: { value: tex },
        uDetailMix: { value: 0 },
        uPrevDetail: { value: 0 },
        uCutoff: { value: 1 },
        uPrevCutoff: { value: 0 },
        uUsePrev: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight)
        },
        uImageSize: { value: new THREE.Vector2(1, 1) },
        uPrevSize: { value: new THREE.Vector2(1, 1) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    transportMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    transportMesh.frustumCulled = false;
    transportMesh.renderOrder = 203;
    transportMesh.visible = false;
    scene.add(transportMesh);
  }

  /**
   * Controlli: pieni dal 2° file; scompaiono con extract del media prima della mucca.
   */
  function layoutTransportOverlay() {
    transportHitActive = false;
    if (!transportMesh || worthItIndex < 1 || mode !== 'sequence') {
      if (transportMesh) transportMesh.visible = false;
      return;
    }

    const iPen = worthItIndex - 1; // video/foto subito prima della peak
    const p = seq;
    if (p < 1 - 1e-4 || p >= iPen + 1) {
      transportMesh.visible = false;
      return;
    }

    let hostIdx = iPen;
    let cutoff = 1;

    if (p <= iPen) {
      // pieni su tutte le media fino a quella pre-peak
      hostIdx = Math.min(Math.max(Math.floor(p), 1), iPen);
      cutoff = 1;
    } else {
      // scompaiono con l’extract del media prima della mucca
      hostIdx = iPen;
      cutoff = 1 - (p - iPen);
    }

    const mesh = meshes[hostIdx];
    if (!mesh || mesh.userData.isEndSlide) {
      transportMesh.visible = false;
      return;
    }

    const { w: fullW, h: fullH } = viewSize();
    transportMesh.position.set(0, 0, 0.037);
    transportMesh.scale.set(fullW, fullH, 1);
    transportMesh.rotation.set(0, 0, 0);

    const src = mesh.material.uniforms;
    const mat = transportMesh.material;
    mat.uniforms.uMap.value = src.uMap.value;
    mat.uniforms.uMapHi.value = src.uMapHi.value;
    mat.uniforms.uDetailMix.value = src.uDetailMix.value;
    mat.uniforms.uCutoff.value = cutoff;
    mat.uniforms.uImageSize.value.copy(src.uImageSize.value);
    mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    mat.uniforms.uUsePrev.value = 0;

    const vis = cutoff > 0.001;
    transportMesh.visible = vis;
    transportHitActive = vis && cutoff > 0.05;
  }

  function setTransportLabels(rew, toggle, ff, color = '#ffffff') {
    transportLabels = { rew, toggle, ff, color };
    if (!transportCanvas || !transportMesh) return;
    paintTransportCanvas();
    const tex = transportMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeTransportOverlay() {
    if (transportMesh) {
      scene.remove(transportMesh);
      transportMesh.material.uniforms.uTitle.value?.dispose();
      transportMesh.material.dispose();
      transportMesh.geometry.dispose();
    }
    transportMesh = null;
    transportCanvas = null;
    transportHitActive = false;
  }

  function morphTexSize(tex) {
    const img = tex?.image;
    return {
      w: img?.videoWidth || img?.width || 1,
      h: img?.videoHeight || img?.height || 1
    };
  }

  function setMorphPair(index, { resetCutoff = true } = {}) {
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
    // dopo un ciclo completo il bot diventa top: cutoff=1 mostra ancora lo stesso frame
    if (resetCutoff) mat.uniforms.uCutoff.value = 1;
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

  /** Morph B/N: landing scura + finale quasi bianco dietro la peak. */
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
      // resta pieno in landing + chiusura ventaglio; si spegne solo con lo zoom (m)
      const m = easeInOut(Math.min(Math.max(intro - 1, 0), 1));
      const fade = Math.max(0, 1 - m);
      morphBg.visible = fade > 0.02;
      morphBg.material.uniforms.uLift.value = 0;
      morphBg.material.uniforms.uDim.value = 0.75 * fade;
      if (!morphBg.visible) return;
    }

    morphBg.material.uniforms.uTime.value = now * 0.001;

    // stesso ritmo della landing (~2.4s)
    morphT += dt / 2.4;
    if (morphT >= 1) {
      morphT -= 1;
      setMorphPair(morphIndex + 1);
    }
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
    // max = n → l’ultima (peak) può estrarsi del tutto sullo sfondo bianco
    const max = Math.max(n, 0);
    const p = Math.min(Math.max(seq, 0), max);
    const active = Math.min(Math.floor(p), Math.max(n - 1, 0));

    // lazy full intorno all’attivo (+ lookahead video)
    ensureFull(active);
    ensureFull(active + 1);
    ensureFull(active + 2);
    ensureFull(active + 3);
    ensureFull(active - 1);
    if (keepGoingIndex >= 0) {
      ensureFull(keepGoingIndex);
      ensureFull(keepGoingIndex + 1);
      ensureFull(keepGoingIndex - 1);
    }
    if (worthItIndex >= 0) {
      ensureFull(worthItIndex);
      ensureFull(worthItIndex - 1);
    }

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      // peak inclusa: stessa cover/scala delle altre; solo Y per centrare la mucca
      const fit = coverSize(fullW, fullH, meshAspect(mesh));
      const yOff = mesh.userData.isEndSlide
        ? -(END_COW_UV_Y - 0.5) * fit.h
        : 0;
      mesh.position.set(0, yOff, -i * Z_GAP);
      mesh.scale.set(fit.w, fit.h, 1);
      mesh.rotation.z = 0;
      mesh.material.uniforms.uCover.value = 0;
      mesh.material.uniforms.uOpacity.value = 1;
      // stessa grana statica della sequenza (anche sulla foto finale)
      mesh.material.uniforms.uGrain.value = 0.045;
      mesh.renderOrder = n - i;

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
    layoutKeepGoingOverlay();
    layoutWorthItOverlay();
    layoutBackOverlay();
    layoutTransportOverlay();
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
    captureKeepGoingFromDom();
    captureWorthItFromDom();
    captureBackFromDom();

    // spegni il DOM PRIMA del primo frame WebGL: altrimenti 1 frame di doppio titolo
    // (baseline diversa) → scatto di qualche mm all’inizio dell’erase
    const peakTitleEl = document.getElementById('peak-title');
    if (peakTitleEl) {
      peakTitleEl.style.opacity = '0';
      peakTitleEl.style.visibility = 'hidden';
    }

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
    clockPulseT0 = performance.now();
    for (const mesh of meshes) {
      mesh.material.uniforms.uCutoff.value = 1;
      mesh.visible = !mesh.userData.isEndSlide;
    }
    layout();
    syncVideos();
  }

  function setSeq(value) {
    // fino a meshes.length: peak estratta → solo sfondo bianco + scritta finale
    const max = Math.max(meshes.length, 0);
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
    if (keepCanvas && keepMesh) {
      captureKeepGoingFromDom();
    }
    if (worthCanvas && worthMesh) {
      captureWorthItFromDom();
    }
    if (backCanvas && backMesh) {
      captureBackFromDom();
    }
    if (transportCanvas && transportMesh) {
      paintTransportCanvas();
      const tex = transportMesh.material.uniforms.uTitle.value;
      if (tex) tex.needsUpdate = true;
    }
    layout();
  }

  function needsIdleMotion() {
    // float tile + morph sfondo in landing / finale chiaro
    return (mode === 'intro' && intro < 1.85) || isEndReveal();
  }

  function render() {
    if (mode === 'intro') {
      layout();
      tickMorphBg(performance.now());
    } else {
      updateDetailMix();
      layoutTitleOverlay();
      layoutKeepGoingOverlay();
      layoutWorthItOverlay();
      layoutBackOverlay();
      layoutTransportOverlay();
      if (isEndReveal()) tickMorphBg(performance.now());
    }
    if (mode === 'sequence' || intro > 1.3) {
      for (const mesh of meshes) {
        if (mesh.userData.video && mesh.visible && mesh.userData.detail > 0.2) {
          mesh.userData.texture.needsUpdate = true;
        }
      }
    }
    syncVideos();
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
        video.remove();
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
    disposeKeepGoingOverlay();
    disposeWorthItOverlay();
    disposeBackOverlay();
    disposeTransportOverlay();
    disposeMorphBg();
    keepGoingIndex = -1;
    worthItIndex = -1;
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
    captureKeepGoingFromDom,
    setTransportLabels,
    isTransportHitActive: () => transportHitActive,
    isBackHitActive: () => backHitActive,
    captureBackFromDom,
    get count() {
      return items.length;
    },
    getKeepGoingIndex: () => keepGoingIndex,
    resize,
    render
  };
}
