import * as THREE from 'three';
import edgeVert from './edge.vert.js';
import edgeFrag from './edge.frag.js';
import { withBase } from './base.js';
import { loadRoutePath, placeItemsOnRoute } from './pathRoute.js';

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
  L += grain(vUv) * mix(0.022, 0.016, uLift);
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

/** Tipografia sequenza / frasi: sempre Geist Mono (DOM + canvas). */
const UI_FONT = '"Geist Mono", ui-monospace, monospace';

function applySeqHudFont(ctx, probeId = 'hud-ele') {
  const probe = document.getElementById(probeId);
  const cs = probe ? getComputedStyle(probe) : null;
  const size = cs?.fontSize || `${0.85 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)}px`;
  const weight = cs?.fontWeight || '400';
  ctx.font = `${weight} ${size} ${UI_FONT}`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = cs?.letterSpacing || '0.04em';
  }
}

async function ensureUiFont() {
  try {
    await document.fonts.load(`400 16px "Geist Mono"`);
    await document.fonts.load(`400 42px "Geist Mono"`);
    await document.fonts.load(`400 64px "Geist Mono"`);
    await document.fonts.load(`400 96px "Geist Mono"`);
    await document.fonts.ready;
  } catch {
    /* ignore */
  }
}

/** Nessuno schiacciamento verticale. */
function withSeqSquashY(ctx, cx, cy, draw) {
  draw();
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
/** Quote fisse inizio/fine percorso (le intermedie dal GPX). */
const PATH_ELE_START = 2065;
const PATH_ELE_END = 2717;
/** Partenza + 8 intermedie + arrivo (come i 10 orari dell’orologio). */
const PATH_ELE_LABELS = CLOCK_WEDGES;
/** Label % light lungo l’asse ombra→luce. */
const LIGHT_PCT_MARKS = [0, 25, 50, 75, 100];
/** Illuminazione orari landing: uno ogni 2s, senso orario da 14:09. */
const CLOCK_PULSE_MS = 2000;
const CLOCK_PULSE_DIM = 0.22;
const CLOCK_PULSE_START = '14:09';
const _labelCamQ = new THREE.Quaternion();
const _labelParentQ = new THREE.Quaternion();
const _labelFaceQ = new THREE.Quaternion();
const _labelWorld = new THREE.Vector3();
const _labelProj = new THREE.Vector3();
const _quatIdentity = new THREE.Quaternion();

/** Luminosità 0..1 (foto/video): guida ordine nuvola light. */
function effectiveLight(item) {
  const L = Number(item?.light);
  if (Number.isFinite(L)) return THREE.MathUtils.clamp(L, 0, 1);
  const r = Number(item?.lightRank);
  if (Number.isFinite(r)) return THREE.MathUtils.clamp((r - 1) / 29, 0, 1);
  return 0;
}

/** Rank effettivo: lightRank foto (1=buia→30=luce) o proxy da light video. */
function effectiveLightRank(item) {
  const r = Number(item?.lightRank);
  if (Number.isFinite(r)) return r;
  return 1 + effectiveLight(item) * 29;
}

function formatLightPct(pct) {
  return `${Math.round(pct)}%`;
}

const LIGHT_GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.399

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

/**
 * Label landing (orari / quote / %): DOM Geist Mono, proiettate in screen space.
 * @param {string} text
 */
function makeDomLandingLabel(text) {
  const el = document.createElement('span');
  el.className = 'landing-label';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  const root = document.getElementById('landing-labels');
  if (root) root.appendChild(el);
  else document.body.appendChild(el);
  return { el, userData: {} };
}

function hideDomLandingLabel(label) {
  if (!label?.el) return;
  label.el.style.opacity = '0';
  label.el.style.visibility = 'hidden';
}

/**
 * @param {{ el: HTMLElement }} label
 * @param {THREE.Vector3} worldPos
 * @param {number} opacity
 * @param {number} [scale]
 * @param {THREE.Camera} cam
 */
function placeDomLandingLabel(label, worldPos, opacity, scale, cam) {
  const el = label.el;
  if (opacity <= 0.02) {
    hideDomLandingLabel(label);
    return;
  }
  _labelProj.copy(worldPos).project(cam);
  // dietro la camera → fuori; z leggermente fuori [-1,1] resta ok
  if (_labelProj.z > 1) {
    hideDomLandingLabel(label);
    return;
  }
  const x = (_labelProj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_labelProj.y * 0.5 + 0.5) * window.innerHeight;
  if (
    x < -80 ||
    y < -40 ||
    x > window.innerWidth + 80 ||
    y > window.innerHeight + 40
  ) {
    hideDomLandingLabel(label);
    return;
  }
  const s = scale ?? 1;
  el.style.visibility = 'visible';
  el.style.opacity = String(opacity);
  el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
}

function disposeDomLandingLabel(label) {
  label?.el?.remove();
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  let halfW = 1;
  let halfH = 1;
  /** Sequenza: ortografica. */
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  /** Landing: prospettiva (parte piatta; drag → rotazione XYZ). */
  const RING_FOV = 34;
  const perspCam = new THREE.PerspectiveCamera(RING_FOV, 1, 0.1, 100);
  perspCam.position.set(0, 0, 3.2);
  perspCam.lookAt(0, 0, 0);

  /** Anello / percorso (tile + orari o linea GPX); rotazione libera da drag. */
  const ringRoot = new THREE.Group();
  scene.add(ringRoot);
  const ringRot = { x: 0, y: 0, z: 0 };
  const ringVel = { x: 0, y: 0, z: 0 };
  let ringDragging = false;
  let ringDragLastX = 0;
  let ringDragLastY = 0;
  /** 0 = pitch/yaw, 2 = roll (tasto destro o Shift). */
  let ringDragMode = 0;
  /** @type {'clock' | 'path' | 'light'} */
  let landingView = 'clock';
  /** @type {Awaited<ReturnType<typeof loadRoutePath>> | null} */
  let pathRoute = null;
  /** @type {THREE.Line | null} */
  let pathLine = null;
  /** Posizioni world per ogni item timeline sul path. */
  let pathSlots = [];
  /** Quote inizio/fine percorso (come gli orari sull’orologio). */
  /** @type {Array<{ el: HTMLElement, userData: Record<string, unknown> }>} */
  let pathEleLabels = [];
  /** Slot nuvola lightRank (u 0=buia → 1=luce + xy organici). */
  /** @type {Array<{ u: number, rank: number, light: number, x: number, y: number, z: number }>} */
  let lightSlots = [];
  /** Indice media più buia (home della raccolta light). */
  let lightHomeIdx = 0;
  /** @type {Array<{ el: HTMLElement, userData: Record<string, unknown> }>} */
  let lightPctLabels = [];

  const loader = new THREE.TextureLoader();

  /** @type {THREE.Mesh[]} */
  let meshes = [];
  /** @type {THREE.Group | null} */
  let clockGroup = null;
  /** @type {Array<{ el: HTMLElement, userData: Record<string, unknown> }>} */
  let clockLabels = [];
  let clockLabelsVisible = true;
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
  /** Indice timeline per “keep going”; dura 5 media a metà sequenza. */
  let keepGoingIndex = -1;
  const KEEP_GOING_SPAN = 5;
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
  /** Sequenza: true = foto/video sotto l’edge; false = solo outline. */
  let seqFillOn = true;
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

    // altezza visibile a z=0 ≈ 2 (come ortho halfH=1) — vista frontale piatta
    perspCam.aspect = aspect;
    perspCam.fov = RING_FOV;
    const dist = 1 / Math.tan(THREE.MathUtils.degToRad(RING_FOV * 0.5));
    perspCam.position.set(0, 0, dist);
    perspCam.near = 0.05;
    perspCam.far = 100;
    perspCam.lookAt(0, 0, 0);
    perspCam.updateProjectionMatrix();
  }

  function activeCamera() {
    return mode === 'intro' ? perspCam : camera;
  }

  function flattenRingRoot() {
    ringRoot.rotation.set(0, 0, 0);
    ringRoot.position.set(0, 0, 0);
  }

  function resetRingSpin() {
    ringRot.x = 0;
    ringRot.y = 0;
    ringRot.z = 0;
    ringVel.x = 0;
    ringVel.y = 0;
    ringVel.z = 0;
    ringDragging = false;
  }

  function getLandingView() {
    return landingView;
  }

  async function ensurePathRoute() {
    if (pathRoute && pathLine && pathSlots.length && pathEleLabels.length) {
      return pathRoute;
    }
    pathRoute = pathRoute || (await loadRoutePath());
    pathSlots = placeItemsOnRoute(items, pathRoute);
    disposePathLine();
    const pts = pathRoute.points;
    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      positions[i * 3] = pts[i].x;
      positions[i * 3 + 1] = pts[i].y;
      positions[i * 3 + 2] = pts[i].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthTest: true,
      depthWrite: false
    });
    pathLine = new THREE.Line(geo, mat);
    pathLine.frustumCulled = false;
    pathLine.renderOrder = 40;
    pathLine.visible = false;
    ringRoot.add(pathLine);
    await buildPathEleLabels();
    return pathRoute;
  }

  function formatPathEleLabel(meters) {
    if (!Number.isFinite(Number(meters))) return '— m';
    return `${Math.round(Number(meters)).toLocaleString('it-IT')} m`;
  }

  /**
   * Scala il path perché stia tra data e luogo (come il raggio dell’orologio),
   * con un leggero margine interno.
   */
  function pathFitScale() {
    if (!pathRoute?.points?.length) return 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of pathRoute.points) {
      maxX = Math.max(maxX, Math.abs(p.x));
      maxY = Math.max(maxY, Math.abs(p.y));
    }
    const short = Math.min(halfW, halfH);
    // pad simmetrico → path più centrato
    const padY = short * 0.22;
    const padX = short * 0.12;
    const availX = Math.max(halfW - padX, 0.25);
    const availY = Math.max(halfH - padY, 0.25);
    const sx = availX / Math.max(maxX, 1e-4);
    const sy = availY / Math.max(maxY, 1e-4);
    return Math.min(sx, sy) * 0.9;
  }

  /** Piccolo offset verso il basso (quasi centrato). */
  function pathYOffset() {
    return -Math.min(halfW, halfH) * 0.02;
  }

  /** Semiassi nuvola light 3D (pad meta / toggle). */
  function lightCloudFit() {
    const short = Math.min(halfW, halfH);
    const tile = sizeWithAspect(short * 0.16, 1.2);
    const padX = short * 0.12 + tile.w * 0.28;
    const padY = short * 0.2 + tile.h * 0.28;
    return {
      hx: Math.max(halfW - padX, 0.3) * 0.82,
      hy: Math.max(halfH - padY, 0.24) * 0.72,
      hz: Math.max(short * 0.48, 0.26)
    };
  }

  function lightHash(i, salt) {
    const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * Nuvola 3D: tutte le media (foto+video) ordinate per luminosità
   * (0 = più buia → 1 = più luminosa), sparse a spirale e centrata.
   */
  function rebuildLightSlots() {
    lightSlots = [];
    lightHomeIdx = 0;
    const n = items.length;
    if (!n) return;

    const { hx, hy, hz } = lightCloudFit();
    const order = items
      .map((item, i) => ({ i, light: effectiveLight(item) }))
      .sort((a, b) => a.light - b.light || a.i - b.i);

    lightHomeIdx = order[0].i;
    const slots = new Array(n);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      const { i, light } = order[k];
      const t = n <= 1 ? 0 : k / (n - 1);
      const ang = k * LIGHT_GOLDEN;
      const h2 = lightHash(k, 2);
      const h3 = lightHash(k, 3);
      const spread = 0.35 + 0.65 * Math.sin(Math.PI * t);
      const radY = hy * spread * (0.55 + 0.45 * h2);
      const radZ = hz * spread * (0.55 + 0.45 * h3);
      const x = (t - 0.5) * 2 * hx;
      const y = Math.sin(ang) * radY;
      const z = Math.cos(ang) * radZ;
      cx += x;
      cy += y;
      cz += z;
      slots[i] = { u: t, rank: 1 + t * 29, light, x, y, z, order: k };
    }
    // baricentro → origine (nuvola centrata in viewport)
    cx /= n;
    cy /= n;
    cz /= n;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      if (!s) continue;
      s.x -= cx;
      s.y -= cy;
      s.z -= cz;
    }
    lightSlots = slots;
  }

  function lightSlotPos(slot) {
    return {
      x: Number.isFinite(slot?.x) ? slot.x : 0,
      y: Number.isFinite(slot?.y) ? slot.y : 0,
      z: Number.isFinite(slot?.z) ? slot.z : 0.02
    };
  }

  function faceCameraLocal(mesh) {
    const cam = activeCamera();
    cam.getWorldQuaternion(_labelCamQ);
    ringRoot.updateWorldMatrix(true, false);
    ringRoot.getWorldQuaternion(_labelParentQ);
    _labelFaceQ.copy(_labelParentQ).invert().multiply(_labelCamQ);
    mesh.quaternion.copy(_labelFaceQ);
  }

  function pathAtT(t) {
    const p = pathRoute.atT(t);
    const s = pathFitScale();
    return {
      x: p.x * s,
      y: p.y * s,
      z: p.z * s,
      t: p.t,
      ele: p.ele
    };
  }

  /**
   * 10 quote lungo il path, ma senza sovrapposizioni XY
   * (il GPX si ripiega vicino alla vetta → equal-t le ammassa).
   */
  function pickPathEleSamples() {
    const want = PATH_ELE_LABELS;
    const pts = pathRoute.points;
    const span = Math.max(
      ...pts.map((p) => Math.hypot(p.x, p.y)),
      0.2
    );
    const minDist = span * 0.16;
    const candidates = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = pathRoute.atT(t);
      candidates.push({ t, x: p.x, y: p.y, z: p.z, ele: p.ele });
    }
    const start = pathRoute.atT(0);
    const end = pathRoute.atT(1);
    const picked = [
      {
        t: 0,
        x: start.x,
        y: start.y,
        z: start.z,
        meters: PATH_ELE_START
      },
      {
        t: 1,
        x: end.x,
        y: end.y,
        z: end.z,
        meters: PATH_ELE_END
      }
    ];

    const distToPicked = (c) => {
      let min = Infinity;
      for (const p of picked) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < min) min = d;
      }
      return min;
    };

    while (picked.length < want) {
      let best = null;
      let bestScore = -1;
      for (const c of candidates) {
        if (c.t < 0.03 || c.t > 0.97) continue;
        const rounded = Math.round(c.ele);
        // evita una seconda “2717 m” / “2065 m” lontano dagli estremi
        if (rounded === PATH_ELE_START || rounded === PATH_ELE_END) continue;
        const d = distToPicked(c);
        if (d < minDist) continue;
        if (d > bestScore) {
          bestScore = d;
          best = c;
        }
      }
      if (!best) break;
      picked.push({
        t: best.t,
        x: best.x,
        y: best.y,
        z: best.z,
        meters: best.ele
      });
    }

    picked.sort((a, b) => a.t - b.t);
    return picked;
  }

  /** Offset etichetta verso l’esterno, normale al tracciato (non sopra le foto). */
  function pathLabelWorldPos(t, dist) {
    const p = pathAtT(t);
    // agli estremi usa la tangente in arrivo/partenza (più stabile)
    const eps = t > 0.97 || t < 0.03 ? 0.03 : 0.015;
    const a = pathAtT(Math.max(0, t - eps));
    const b = pathAtT(Math.min(1, t + eps));
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let nx = -ty;
    let ny = tx;
    if (nx * p.x + ny * p.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    return {
      x: p.x + nx * dist,
      y: p.y + ny * dist,
      z: p.z + 0.08
    };
  }

  async function buildPathEleLabels() {
    disposePathEleLabels();
    if (!pathRoute?.points?.length) return;
    await ensureUiFont();
    const samples = pickPathEleSamples();
    pathEleLabels = [];
    for (const s of samples) {
      const label = makeDomLandingLabel(formatPathEleLabel(s.meters));
      label.userData.pathT = s.t;
      pathEleLabels.push(label);
    }
  }

  function layoutPathEleLabels(m) {
    if (!pathEleLabels.length || !pathRoute?.points?.length) {
      for (const label of pathEleLabels) hideDomLandingLabel(label);
      return;
    }
    let opacity = 1;
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;
    if (landingView !== 'path' || opacity <= 0.02) {
      for (const label of pathEleLabels) hideDomLandingLabel(label);
      return;
    }

    const short = Math.min(halfW, halfH);
    const labelW = landingLabelWidth();
    const cam = activeCamera();
    ringRoot.updateWorldMatrix(true, false);
    const yOff = pathYOffset();

    for (const label of pathEleLabels) {
      const t = Number.isFinite(label.userData.pathT) ? label.userData.pathT : 0;
      const tip = t < 0.04 || t > 0.96;
      const outward = tip
        ? short * 0.028 + labelW * 0.1
        : short * 0.05 + labelW * 0.16;
      const pos = pathLabelWorldPos(t, outward);
      _labelWorld.set(pos.x, pos.y + yOff, pos.z);
      ringRoot.localToWorld(_labelWorld);
      placeDomLandingLabel(label, _labelWorld, opacity, 1, cam);
    }
  }

  function disposePathEleLabels() {
    for (const label of pathEleLabels) disposeDomLandingLabel(label);
    pathEleLabels = [];
  }

  function disposeLightPctLabels() {
    for (const label of lightPctLabels) disposeDomLandingLabel(label);
    lightPctLabels = [];
  }

  async function buildLightPctLabels() {
    disposeLightPctLabels();
    await ensureUiFont();
    try {
      for (const pct of LIGHT_PCT_MARKS) {
        const label = makeDomLandingLabel(formatLightPct(pct));
        label.userData.lightU = pct / 100;
        lightPctLabels.push(label);
      }
    } catch {
      /* ignore */
    }
  }

  function layoutLightPctLabels(m) {
    if (!lightPctLabels.length) return;
    let opacity = 1;
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;
    if (landingView !== 'light' || opacity <= 0.02) {
      for (const label of lightPctLabels) hideDomLandingLabel(label);
      return;
    }

    const short = Math.min(halfW, halfH);
    const { hx, hy } = lightCloudFit();
    const cam = activeCamera();
    ringRoot.updateWorldMatrix(true, false);

    const tile = sizeWithAspect(short * 0.16, 1.2);
    const y = -(hy * 0.72 + tile.h * 0.28 + short * 0.02);

    for (const label of lightPctLabels) {
      const u = Number.isFinite(label.userData.lightU)
        ? label.userData.lightU
        : 0;
      const x = (u - 0.5) * 2 * hx;
      _labelWorld.set(x, y, 0.12);
      ringRoot.localToWorld(_labelWorld);
      placeDomLandingLabel(label, _labelWorld, opacity, 1, cam);
    }
  }

  function disposePathLine() {
    if (pathLine) {
      pathLine.removeFromParent();
      pathLine.geometry.dispose();
      pathLine.material.dispose();
      pathLine = null;
    }
    disposePathEleLabels();
  }

  function setLandingView(view) {
    const next =
      view === 'path' ? 'path' : view === 'light' ? 'light' : 'clock';
    landingView = next;
    resetRingSpin();
    if (next === 'path') {
      disposePathLine();
      void ensurePathRoute()
        .then(() => {
          if (mode === 'intro') layout();
        })
        .catch((err) => console.warn('[edges] percorso GPX', err));
      for (const label of lightPctLabels) hideDomLandingLabel(label);
    } else if (next === 'light') {
      if (pathLine) {
        pathLine.visible = false;
        for (const label of pathEleLabels) hideDomLandingLabel(label);
      }
      rebuildLightSlots();
      if (!lightPctLabels.length) {
        void buildLightPctLabels().then(() => {
          if (mode === 'intro' && landingView === 'light') layout();
        });
      }
    } else {
      if (pathLine) {
        pathLine.visible = false;
        for (const label of pathEleLabels) hideDomLandingLabel(label);
      }
      for (const label of lightPctLabels) hideDomLandingLabel(label);
      setClockVisible(true);
    }
    if (mode === 'intro') {
      intro = Math.min(intro, 0.001);
      layout();
    }
  }

  function canExploreRing() {
    // come l’orologio: esplorabile in 3D a riposo, non durante la raccolta
    return mode === 'intro' && intro < 0.85;
  }

  function onRingPointerDown(e) {
    if (!canExploreRing()) return;
    // sinistro = X/Y; destro o Shift = Z (roll)
    const roll =
      e.button === 2 || e.shiftKey || (e.buttons & 2) !== 0;
    if (e.button != null && e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    ringDragging = true;
    ringDragMode = roll ? 2 : 0;
    ringVel.x = 0;
    ringVel.y = 0;
    ringVel.z = 0;
    ringDragLastX = e.clientX;
    ringDragLastY = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    canvas.style.cursor = 'grabbing';
  }

  function onRingPointerMove(e) {
    if (!canExploreRing() || !ringDragging) return;
    const dx = e.clientX - ringDragLastX;
    const dy = e.clientY - ringDragLastY;
    ringDragLastX = e.clientX;
    ringDragLastY = e.clientY;
    const sens = landingView === 'light' ? 0.009 : 0.0065;
    const roll = ringDragMode === 2 || e.shiftKey;
    if (roll) {
      const dZ = dx * sens;
      ringRot.z += dZ;
      ringVel.z = dZ;
      ringVel.x = 0;
      ringVel.y = 0;
    } else {
      const dY = dx * sens;
      const dX = dy * sens;
      ringRot.y += dY;
      ringRot.x += dX;
      ringVel.y = dY;
      ringVel.x = dX;
      ringVel.z = 0;
    }
  }

  function onRingPointerUp(e) {
    if (!ringDragging) return;
    ringDragging = false;
    ringDragMode = 0;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    canvas.style.cursor = canExploreRing() ? 'grab' : '';
  }

  function onRingContextMenu(e) {
    if (canExploreRing()) e.preventDefault();
  }

  function bindRingDrag() {
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onRingPointerDown);
    canvas.addEventListener('pointermove', onRingPointerMove);
    canvas.addEventListener('pointerup', onRingPointerUp);
    canvas.addEventListener('pointercancel', onRingPointerUp);
    canvas.addEventListener('contextmenu', onRingContextMenu);
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

  /** Stessa scala world per orari / quote / % light. */
  function landingLabelWidth() {
    return Math.min(halfW, halfH) * 0.24;
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
        uEdgeOnly: { value: 0 },
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

    await ensureUiFont();
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
        ringRoot.add(mesh);
        meshes.push(mesh);
      }
      layout();
      renderer.render(scene, activeCamera());
    }

    await buildClockFace(items);
    try {
      await ensurePathRoute();
    } catch (err) {
      console.warn('[edges] percorso GPX non caricato', err);
    }
    rebuildLightSlots();
    await buildLightPctLabels();
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

    // “keep going” per 5 media consecutive, ~metà sequenza ma 2 media prima
    {
      const span = KEEP_GOING_SPAN;
      const startMax = Math.max(0, n - span);
      const midStart = Math.round((n - span) * 0.5) - 2;
      keepGoingIndex = Math.min(startMax, Math.max(0, midStart));
    }

    intro = 0;
    seq = 0;
    mode = 'intro';
    resetRingSpin();
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
      flattenRingRoot();
      layoutSequence(fullW, fullH);
      setClockVisible(false);
      for (const label of lightPctLabels) hideDomLandingLabel(label);
      if (pathLine) pathLine.visible = false;
      for (const label of pathEleLabels) hideDomLandingLabel(label);
      layoutTitleOverlay();
      layoutKeepGoingOverlay();
      layoutWorthItOverlay();
      layoutBackOverlay();
      layoutTransportOverlay();
      layoutMorphBg();
      // fill off: sfondo nero→bianco sotto gli edge; altrimenti solo al finale
      if (!seqFillOn || isEndReveal()) {
        /* tickMorphBg gestisce */
      } else {
        setMorphBgVisible(false);
      }
      updateDetailMix();
      return;
    }

    if (titleMesh) titleMesh.visible = false;
    if (keepMesh) keepMesh.visible = false;
    if (worthMesh) worthMesh.visible = false;
    syncKeepGoingDom(false);
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

    // inerzia rotazione (solo in explore)
    if (!ringDragging && canExploreRing()) {
      const speed =
        Math.abs(ringVel.x) + Math.abs(ringVel.y) + Math.abs(ringVel.z);
      if (speed > 1e-5) {
        ringRot.x += ringVel.x;
        ringRot.y += ringVel.y;
        ringRot.z += ringVel.z;
        ringVel.x *= 0.94;
        ringVel.y *= 0.94;
        ringVel.z *= 0.94;
      }
    } else if (!canExploreRing()) {
      ringVel.x = 0;
      ringVel.y = 0;
      ringVel.z = 0;
    }

    // come l’orologio: tilt 3D solo a riposo; con lo scroll torna piano
    const explore = (1 - m) * (1 - g);
    ringRoot.rotation.x = ringRot.x * explore;
    ringRoot.rotation.y = ringRot.y * explore;
    ringRoot.rotation.z = ringRot.z * explore;
    ringRoot.position.set(0, 0, 0);
    canvas.style.cursor = canExploreRing()
      ? ringDragging
        ? 'grabbing'
        : 'grab'
      : '';

    const zAmp = 0.04 * explore;

    if (landingView === 'path' && pathRoute && pathSlots.length) {
      const pathScale = pathFitScale();
      layoutPathTiles({
        n,
        g,
        m,
        hideBehind,
        floatStr,
        zAmp,
        fullW,
        fullH,
        pathScale
      });
      layoutPathEleLabels(m);
      if (pathLine) {
        // scala uniforme: linea e media condividono lo stesso spazio
        pathLine.scale.setScalar(pathScale);
        pathLine.position.y = pathYOffset();
        pathLine.visible = m < 0.85;
        pathLine.material.opacity =
          0.82 * (1 - m) * (0.55 + 0.45 * (1 - g));
      }
      setClockVisible(false);
      for (const label of lightPctLabels) hideDomLandingLabel(label);
    } else if (landingView === 'light') {
      if (pathLine) {
        pathLine.visible = false;
        pathLine.scale.setScalar(1);
        pathLine.position.y = 0;
      }
      for (const label of pathEleLabels) hideDomLandingLabel(label);
      if (!lightSlots.length) rebuildLightSlots();
      layoutLightTiles({
        n,
        g,
        m,
        spacing,
        hideBehind,
        floatStr,
        zAmp,
        fullW,
        fullH
      });
      layoutLightPctLabels(m);
      setClockVisible(false);
    } else {
      if (pathLine) {
        pathLine.visible = false;
        pathLine.scale.setScalar(1);
        pathLine.position.y = 0;
      }
      for (const label of pathEleLabels) hideDomLandingLabel(label);
      for (const label of lightPctLabels) hideDomLandingLabel(label);
      setClockVisible(true);
      layoutClockTiles({
        n,
        g,
        m,
        spacing,
        rRing,
        angleHome,
        hideBehind,
        floatStr,
        zAmp,
        fullW,
        fullH
      });
      layoutClockFace(m);
    }
    updateDetailMix();
  }

  function layoutClockTiles({
    n,
    g,
    m,
    spacing,
    rRing,
    angleHome,
    hideBehind,
    floatStr,
    zAmp,
    fullW,
    fullH
  }) {
    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      if (mesh.userData.isEndSlide) {
        mesh.visible = false;
        continue;
      }
      mesh.material.depthTest = true;
      mesh.material.depthWrite = true;
      if (mesh.material.uniforms.uEdgeOnly) {
        mesh.material.uniforms.uEdgeOnly.value = 0;
      }
      const angle0 = mesh.userData.angle0;
      const isFirst = i === 0;
      const aspect = meshAspect(mesh);
      const tile = tileSizeFor(mesh);

      if (isFirst) {
        const homeX = Math.cos(angleHome) * rRing;
        const homeY = Math.sin(angleHome) * rRing;
        const cover = coverSize(fullW, fullH, aspect);

        const x = THREE.MathUtils.lerp(homeX, 0, m);
        const y = THREE.MathUtils.lerp(homeY, 0, m);
        const z = THREE.MathUtils.lerp(Math.sin(angleHome) * zAmp + 0.03, 0, m);
        const sw = THREE.MathUtils.lerp(tile.w, cover.w, m);
        const sh = THREE.MathUtils.lerp(tile.h, cover.h, m);

        mesh.position.set(x, y, z);
        mesh.scale.set(sw, sh, 1);
        mesh.rotation.set(0, 0, 0);
        applyFloat(mesh, floatStr);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0.022 * m;
        mesh.renderOrder = n + 20;
        mesh.visible = true;
      } else {
        const angle = angleHome + (angle0 - angleHome) * spacing;
        const rimRot = angle - angleHome;
        const depth =
          Math.sin(angle) * zAmp + g * (0.02 - Math.abs(i) * 0.0003);
        const sc = THREE.MathUtils.lerp(1, 0.72, g);

        mesh.position.set(
          Math.cos(angle) * rRing,
          Math.sin(angle) * rRing,
          depth
        );
        mesh.scale.set(tile.w * sc, tile.h * sc, 1);
        mesh.rotation.set(0, 0, THREE.MathUtils.lerp(rimRot, 0, g));
        applyFloat(mesh, floatStr);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = hideBehind ? 0 : 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0;
        mesh.renderOrder = n - i;
        mesh.visible = !hideBehind;
      }
    }
  }

  function layoutPathTiles({
    n,
    g,
    m,
    hideBehind,
    floatStr,
    zAmp,
    fullW,
    fullH,
    pathScale = 1
  }) {
    // media sempre su atT (stesso spazio della linea); spacing come l’orologio
    const slot0 = pathSlots[0] || { x: 0, y: 0, z: 0, t: 0 };
    const tHome = Number.isFinite(slot0.t) ? slot0.t : 0;
    const fit = pathScale || pathFitScale();
    const yOff = pathYOffset();
    const homeAlong = pathRoute
      ? (() => {
          const p = pathRoute.atT(tHome);
          return { x: p.x * fit, y: p.y * fit + yOff, z: p.z * fit };
        })()
      : { ...slot0, y: (slot0.y || 0) + yOff };
    const homeX = homeAlong.x;
    const homeY = homeAlong.y;
    const homeZ = (homeAlong.z ?? 0) + 0.02;

    let mediaCount = 0;
    for (let i = 0; i < n; i++) {
      if (!meshes[i]?.userData.isEndSlide) mediaCount++;
    }
    const lastMedia = Math.max(mediaCount - 1, 1);

    const pathTileScale = 0.64;
    const gathering = g > 0.012 || m > 0.01;
    const pathFloat = gathering ? 0 : floatStr * 0.2;

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      if (mesh.userData.isEndSlide) {
        mesh.visible = false;
        continue;
      }
      const slot = pathSlots[i] || pathSlots[pathSlots.length - 1] || slot0;
      const isFirst = i === 0;
      const aspect = meshAspect(mesh);
      const tile = tileSizeFor(mesh);
      const tw = tile.w * pathTileScale;
      const th = tile.h * pathTileScale;

      mesh.material.depthTest = !gathering;
      mesh.material.depthWrite = !gathering;
      if (mesh.material.uniforms.uEdgeOnly) {
        mesh.material.uniforms.uEdgeOnly.value = 0;
      }

      if (isFirst) {
        const cover = coverSize(fullW, fullH, aspect);
        const x = THREE.MathUtils.lerp(homeX, 0, m);
        const y = THREE.MathUtils.lerp(homeY, 0, m);
        const z = THREE.MathUtils.lerp(homeZ, 0, m);
        const sw = THREE.MathUtils.lerp(tw, cover.w, m);
        const sh = THREE.MathUtils.lerp(th, cover.h, m);

        mesh.position.set(x, y, z);
        mesh.scale.set(sw, sh, 1);
        mesh.rotation.set(0, 0, 0);
        applyFloat(mesh, pathFloat);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0.022 * m;
        mesh.renderOrder = n + 20;
        mesh.visible = true;
      } else {
        const tSlot = Number.isFinite(slot.t)
          ? slot.t
          : THREE.MathUtils.clamp(i / lastMedia, 0, 1);

        // cascata cronologica ultima→prima; sempre sul GPX
        const u = i / lastMedia;
        const lead = (1 - u) * 0.22;
        const gLocal = THREE.MathUtils.clamp((g - lead) / (1 - 0.22), 0, 1);
        const spacing = 1 - gLocal;
        const tAlong = tHome + (tSlot - tHome) * spacing;
        const sc = THREE.MathUtils.lerp(1, 0.72, gLocal);
        // stack minimo: solo layering, non stacca dalla linea in 3D
        const stack = gLocal * (0.003 + i * 0.0012);

        let x;
        let y;
        let z;
        if (pathRoute) {
          const p = pathRoute.atT(tAlong);
          x = p.x * fit;
          y = p.y * fit + yOff;
          z = p.z * fit + 0.02 - stack;
        } else {
          x = homeX + ((slot.x || 0) * fit - homeX) * spacing;
          y = homeY + ((slot.y || 0) * fit + yOff - homeY) * spacing;
          z = homeZ - stack;
        }

        mesh.position.set(x, y, z);
        mesh.scale.set(tw * sc, th * sc, 1);
        mesh.rotation.set(0, 0, 0);
        applyFloat(mesh, pathFloat);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = hideBehind ? 0 : 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0;
        mesh.renderOrder = n - i;
        mesh.visible = !hideBehind;
      }
    }
  }

  /**
   * Nuvola 3D luminosità (foto+video): drag mouse per esplorare;
   * raccolta sulla più buia; morph → sequenza invariata.
   */
  function layoutLightTiles({
    n,
    g,
    m,
    spacing,
    hideBehind,
    floatStr,
    zAmp,
    fullW,
    fullH
  }) {
    rebuildLightSlots();

    const homeSlot = lightSlots[lightHomeIdx] || lightSlots[0] || {
      u: 0,
      x: 0,
      y: 0,
      z: 0.02,
      order: 0
    };
    const home = lightSlotPos(homeSlot);
    const homeX = home.x;
    const homeY = home.y;
    const homeZ = home.z;

    const lightTileScale = 0.98;
    const gathering = g > 0.012 || m > 0.01;
    // outline → foto: rivelazione lenta durante quasi tutto lo zoom
    const edgeOnly = 1 - THREE.MathUtils.smoothstep(0.05, 0.98, m);
    const explore = !gathering;

    for (let i = 0; i < n; i++) {
      const mesh = meshes[i];
      if (mesh.userData.isEndSlide) {
        mesh.visible = false;
        continue;
      }
      const slot = lightSlots[i] || homeSlot;
      const rest = lightSlotPos(slot);
      const isFirst = i === 0;
      const isHome = i === lightHomeIdx;
      const ord = Number.isFinite(slot.order) ? slot.order : i;
      const aspect = meshAspect(mesh);
      const tile = tileSizeFor(mesh);
      const tw = tile.w * lightTileScale;
      const th = tile.h * lightTileScale;

      mesh.material.depthTest = !gathering;
      mesh.material.depthWrite = !gathering && edgeOnly < 0.5;
      if (mesh.material.uniforms.uEdgeOnly) {
        mesh.material.uniforms.uEdgeOnly.value = edgeOnly;
      }

      if (isFirst) {
        const gx = homeX + (rest.x - homeX) * spacing;
        const gy = homeY + (rest.y - homeY) * spacing;
        const gz = homeZ + (rest.z - homeZ) * spacing;
        const cover = coverSize(fullW, fullH, aspect);
        const x = THREE.MathUtils.lerp(gx, 0, m);
        const y = THREE.MathUtils.lerp(gy, 0, m);
        const z = THREE.MathUtils.lerp(gz, 0, m);
        const sw = THREE.MathUtils.lerp(tw, cover.w, m);
        const sh = THREE.MathUtils.lerp(th, cover.h, m);

        mesh.position.set(x, y, z);
        mesh.scale.set(sw, sh, 1);
        if (explore) faceCameraLocal(mesh);
        else mesh.rotation.set(0, 0, 0);
        applyFloat(mesh, explore ? floatStr * 1.2 : 0);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0.022 * m;
        mesh.renderOrder =
          m > 0.01 || isHome ? n + 20 : n - ord;
        mesh.visible = true;
      } else {
        const x = homeX + (rest.x - homeX) * spacing;
        const y = homeY + (rest.y - homeY) * spacing;
        const z =
          homeZ +
          (rest.z - homeZ) * spacing +
          g * (0.012 - ord * 0.0002);
        const sc = THREE.MathUtils.lerp(1, 0.72, g);

        mesh.position.set(x, y, z + (explore ? zAmp * 0.25 : 0));
        mesh.scale.set(tw * sc, th * sc, 1);
        if (explore) faceCameraLocal(mesh);
        else mesh.rotation.set(0, 0, 0);
        applyFloat(mesh, explore ? floatStr * 1.2 : 0);
        mesh.material.uniforms.uCover.value = 0;
        mesh.material.uniforms.uOpacity.value = hideBehind ? 0 : 1;
        mesh.material.uniforms.uCutoff.value = 1;
        mesh.material.uniforms.uGrain.value = 0;
        mesh.renderOrder = isHome ? n + 10 : n - ord;
        mesh.visible = !hideBehind;
      }
    }
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
    if (landingView === 'clock') {
      mesh.rotation.z += Math.sin(t * sp * 0.55 + ph * 0.7) * 0.014 * strength;
    }
  }

  function setClockVisible(on) {
    clockLabelsVisible = on;
    if (!on) {
      for (const label of clockLabels) hideDomLandingLabel(label);
    }
  }

  /**
   * Orari per i 10 spicchi (niente assi / pallini).
   */
  async function buildClockFace(itemList) {
    disposeClock();
    const list = itemList || [];
    if (!list.length) return;

    try {
      await ensureUiFont();
    } catch {
      /* fallback browser */
    }

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
      const label = makeDomLandingLabel(timeText);
      label.userData.angle = angle;
      label.userData.wedge = k;
      label.userData.timeText = timeText;
      clockLabels.push(label);
    }

    // clockLabels è già in ordine orario (k=0 alle 12 → senso orario)
    const startIdx = clockLabels.findIndex(
      (l) => l.userData.timeText === CLOCK_PULSE_START
    );
    clockPulseStart = startIdx >= 0 ? startIdx : 0;
    clockPulseT0 = performance.now();
    clockLabelsVisible = true;
  }

  function layoutClockFace(m) {
    if (!clockLabels.length || !clockLabelsVisible) {
      for (const label of clockLabels) hideDomLandingLabel(label);
      return;
    }
    const short = Math.min(halfW, halfH);
    const labelW = landingLabelWidth();
    // appena fuori dalla raggiera delle tile
    const sample = sizeWithAspect(short * 0.25, 1.2);
    const tileOut = Math.hypot(sample.w, sample.h) * 0.5;
    const rLabel = fitRadius() + tileOut + short * 0.055;

    let opacity = 1;
    if (m > 0.02) opacity = Math.max(0, 1 - (m - 0.02) / 0.55);
    if (m > 0.85) opacity = 0;
    if (opacity <= 0.02) {
      for (const label of clockLabels) hideDomLandingLabel(label);
      return;
    }

    const nLab = clockLabels.length;
    const step =
      nLab > 0
        ? Math.floor(
            Math.max(0, performance.now() - clockPulseT0) / CLOCK_PULSE_MS
          ) % nLab
        : 0;
    const active = nLab > 0 ? (clockPulseStart + step) % nLab : 0;
    const cam = activeCamera();
    ringRoot.updateWorldMatrix(true, false);

    for (let i = 0; i < nLab; i++) {
      const label = clockLabels[i];
      const a = Number(label.userData.angle) || 0;
      const aspect = 4.5;
      const lw = labelW;
      const lh = lw / aspect;
      const labelIn =
        (lw * 0.5) * Math.abs(Math.cos(a)) +
        (lh * 0.5) * Math.abs(Math.sin(a));
      const maxR = Math.min(halfW - lw * 0.52, halfH - lh * 0.52);
      const r = Math.min(rLabel + labelIn * 0.05, maxR);
      const lit = i === active ? 1 : CLOCK_PULSE_DIM;
      const pop = i === active ? 1.08 : 1;
      _labelWorld.set(Math.cos(a) * r, Math.sin(a) * r, 0.05);
      ringRoot.localToWorld(_labelWorld);
      placeDomLandingLabel(label, _labelWorld, opacity * lit, pop, cam);
    }
  }

  function disposeClock() {
    for (const label of clockLabels) disposeDomLandingLabel(label);
    clockLabels = [];
    clockGroup = null;
    clockLabelsVisible = true;
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

    // misura posizioni DOM, poi disegna in canvas
    const spans = document.querySelectorAll('#peak-title .peak-line > span');
    const line = document.querySelector('#peak-title .peak-line');
    if (spans.length && line) {
      line.style.transform = 'none';
      const cs = getComputedStyle(line);
      ctx.font = `400 ${cs.fontSize} "Geist Mono", ui-monospace, monospace`;
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
    ctx.font = `400 ${fontPx}px "Geist Mono", ui-monospace, monospace`;
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
      await document.fonts.load('400 18px "Geist Mono"');
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
    if (titleMesh) titleMesh.visible = false;
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
      await document.fonts.load('400 16px "Geist Mono"');
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
    if (keepMesh) keepMesh.visible = false;

    if (keepGoingIndex < 0 || mode !== 'sequence') {
      syncKeepGoingDom(false);
      return;
    }

    const i0 = keepGoingIndex;
    const i1 = Math.min(i0 + KEEP_GOING_SPAN - 1, items.length - 1);
    const p = seq;
    // finestra: reveal del 1° → resta su 5 media → extract dell’ultima
    if (p <= i0 - 1 || p >= i1 + 1) {
      syncKeepGoingDom(false);
      return;
    }

    let opacity = 1;
    if (p < i0) {
      opacity = Math.min(Math.max(p - (i0 - 1), 0), 1);
    } else if (p >= i1) {
      opacity = Math.max(0, 1 - (p - i1));
    }

    syncKeepGoingDom(opacity > 0.02, opacity);
  }

  /** Keep-going DOM: stesso look/posizione/fusione di worth-it e HUD sequenza. */
  function syncKeepGoingDom(live, opacity = 1) {
    const el = document.getElementById('hud-keepgoing');
    if (!el) return;
    el.classList.toggle('is-live', live);
    el.classList.remove('is-on-light', 'is-darker');
    el.style.color = '#fff';
    el.style.mixBlendMode = 'difference';
    el.style.opacity = live ? String(opacity) : '';
    el.setAttribute('aria-hidden', live ? 'false' : 'true');
  }

  function captureKeepGoingFromDom() {
    if (!keepCanvas || !keepMesh) return;
    paintKeepGoingCanvas();
    const tex = keepMesh.material.uniforms.uTitle.value;
    if (tex) tex.needsUpdate = true;
  }

  function disposeKeepGoingOverlay() {
    syncKeepGoingDom(false);
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
      await document.fonts.load('400 16px "Geist Mono"');
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
    el.classList.remove('is-on-light', 'is-darker');
    el.style.color = '#fff';
    el.style.mixBlendMode = 'difference';
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
      await document.fonts.load('400 16px "Geist Mono"');
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
   * Back to darkness: stessa altezza di clock/light/path.
   * Compare appena compare la mucca, poi resta sul bianco.
   */
  function layoutBackOverlay() {
    if (backMesh) backMesh.visible = false;
    backHitActive = false;

    if (worthItIndex < 0 || mode !== 'sequence') return;

    const i0 = worthItIndex;
    const p = seq;
    // nascosto finché non inizia a comparire la mucca
    if (p <= i0 - 1) return;

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

    // Geist Mono, stessa size HUD; difference in WebGL (no stroke)
    applySeqHudFont(ctx, 'hud-ele');
    const ink = transportLabels.color || '#ffffff';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const probe = document.getElementById('hud-ele');
    const fs = probe
      ? parseFloat(getComputedStyle(probe).fontSize) || 12
      : 12;
    ctx.lineWidth = Math.max(1, fs * 0.08);

    const paintLabel = (text, x, y, underline) => {
      ctx.fillText(text, x, y);
      if (!underline) return;
      const tw = ctx.measureText(text).width;
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.5, y + fs * 0.55);
      ctx.lineTo(x + tw * 0.5, y + fs * 0.55);
      ctx.stroke();
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
      paintLabel(texts[i], x, y, ids[i] === 'seq-toggle');
      painted = true;
    }
    if (!painted) {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
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
      await document.fonts.load('400 14px "Geist Mono"');
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
   * Controlli: DOM (nitido). Hit attivo dal 2° file fino al media pre-peak;
   * off appena la mucca inizia a comparire.
   */
  function layoutTransportOverlay() {
    if (transportMesh) transportMesh.visible = false;
    transportHitActive = false;

    if (worthItIndex < 1 || mode !== 'sequence') return;

    const iPen = worthItIndex - 1;
    const p = seq;
    if (p < 1 - 1e-4 || p > iPen + 1e-4) return;

    transportHitActive = true;
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
    morphBg.position.set(0, 0, -8);
    if (mode === 'intro') {
      const dist = Math.abs(perspCam.position.z - morphBg.position.z);
      const vh =
        2 * dist * Math.tan(THREE.MathUtils.degToRad(perspCam.fov * 0.5));
      const vw = vh * Math.max(perspCam.aspect, 0.01);
      morphBg.scale.set(vw * 1.25, vh * 1.25, 1);
    } else {
      morphBg.scale.set(w * 1.18, h * 1.18, 1);
    }
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

  /** Lift 0 = landing scura, 1 = bianco finale (progresso sequenza). */
  function seqLiftT() {
    const n = Math.max(meshes.length - 1, 1);
    return easeInOut(THREE.MathUtils.clamp(seq / n, 0, 1));
  }

  function syncEdgeOnlyClear() {
    if (mode === 'sequence' && !seqFillOn) {
      const t = seqLiftT();
      const c = Math.round(t * 255);
      renderer.setClearColor((c << 16) | (c << 8) | c, 1);
      return;
    }
    renderer.setClearColor(0x000000, 1);
  }

  /** Morph B/N: landing scura + finale quasi bianco dietro la peak.
   *  Con fill off: stesso morph, lift scuro→chiaro lungo la sequenza. */
  function tickMorphBg(now = performance.now()) {
    syncEdgeOnlyClear();
    if (!morphBg || morphTexs.length < 2) return;

    const endReveal = isEndReveal();
    const edgeBg = mode === 'sequence' && !seqFillOn;

    if (mode !== 'intro' && !endReveal && !edgeBg) {
      morphBg.visible = false;
      morphBg.material.uniforms.uLift.value = 0;
      morphLastTs = now;
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (now - morphLastTs) / 1000));
    morphLastTs = now;

    if (edgeBg) {
      const lift = seqLiftT();
      morphBg.visible = true;
      morphBg.material.uniforms.uLift.value = lift;
      morphBg.material.uniforms.uDim.value = THREE.MathUtils.lerp(0.75, 1, lift);
      morphBg.material.uniforms.uTime.value = now * 0.001;
      morphT += dt / 2.4;
      if (morphT >= 1) {
        morphT -= 1;
        setMorphPair(morphIndex + 1);
      }
      const t = Math.min(morphT, 1);
      const erase = t < 0.12 ? 0 : (t - 0.12) / 0.88;
      morphBg.material.uniforms.uCutoff.value = 1 - easeInOut(erase);
      return;
    }

    if (endReveal) {
      morphBg.visible = true;
      morphBg.material.uniforms.uLift.value = 1;
      morphBg.material.uniforms.uDim.value = 1;
    } else {
      const m = easeInOut(Math.min(Math.max(intro - 1, 0), 1));
      const fade = Math.max(0, 1 - m);
      morphBg.visible = fade > 0.02;
      morphBg.material.uniforms.uLift.value = 0;
      morphBg.material.uniforms.uDim.value = 0.75 * fade;
      if (!morphBg.visible) return;
    }

    morphBg.material.uniforms.uTime.value = now * 0.001;

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
      for (let k = -1; k <= KEEP_GOING_SPAN; k++) {
        ensureFull(keepGoingIndex + k);
      }
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
      mesh.rotation.set(0, 0, 0);
      mesh.material.uniforms.uCover.value = 0;
      mesh.material.uniforms.uOpacity.value = 1;
      mesh.material.uniforms.uGrain.value = seqFillOn ? 0.022 : 0;
      const edgeOnly = seqFillOn ? 0 : 1;
      if (mesh.material.uniforms.uEdgeOnly) {
        mesh.material.uniforms.uEdgeOnly.value = edgeOnly;
      }
      mesh.material.depthWrite = seqFillOn;
      mesh.material.depthTest = seqFillOn;
      mesh.material.transparent = true;
      mesh.renderOrder = n - i;

      if (p >= i + 1) {
        mesh.material.uniforms.uCutoff.value = 0;
        mesh.visible = false;
      } else if (p > i) {
        // in erase: solo lo strato attivo
        mesh.visible = true;
        mesh.material.uniforms.uCutoff.value = 1 - (p - i);
      } else if (!seqFillOn) {
        // fill off: una sola media a schermo (niente stack di edge)
        mesh.visible = i === active;
        mesh.material.uniforms.uCutoff.value = 1;
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
    resetRingSpin();
    flattenRingRoot();
    canvas.style.cursor = '';
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
    resetRingSpin();
    for (const mesh of meshes) {
      mesh.material.uniforms.uCutoff.value = 1;
      mesh.visible = !mesh.userData.isEndSlide;
      if (!mesh.userData.isEndSlide && mesh.parent !== ringRoot) {
        ringRoot.add(mesh);
      }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    const spinning =
      Math.abs(ringVel.x) + Math.abs(ringVel.y) + Math.abs(ringVel.z) > 1e-4;
    return (
      (mode === 'intro' && (intro < 1.9 || ringDragging || spinning)) ||
      isEndReveal() ||
      (mode === 'sequence' && !seqFillOn)
    );
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
      if (isEndReveal() || !seqFillOn) tickMorphBg(performance.now());
    }
    if (mode === 'sequence' || intro > 1.3) {
      for (const mesh of meshes) {
        if (mesh.userData.video && mesh.visible && mesh.userData.detail > 0.2) {
          mesh.userData.texture.needsUpdate = true;
        }
      }
    }
    syncVideos();
    renderer.render(scene, activeCamera());
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
      mesh.removeFromParent();
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
    flattenRingRoot();
    resetRingSpin();
    disposePathLine();
    pathRoute = null;
    pathSlots = [];
    disposeLightPctLabels();
    lightSlots = [];
    lightHomeIdx = 0;
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
  bindRingDrag();

  return {
    build,
    addIntro,
    setIntro,
    getIntro: () => intro,
    isIntroComplete: () => mode === 'sequence' || intro >= 2 - 1e-4,
    animateIntroTo,
    enterSequence,
    exitToIntro,
    resetRingSpin,
    setLandingView,
    getLandingView,
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
    setSeqFillOn(on) {
      seqFillOn = Boolean(on);
      syncEdgeOnlyClear();
      if (mode === 'sequence') {
        layout();
        tickMorphBg(performance.now());
      }
    },
    getSeqFillOn: () => seqFillOn,
    get count() {
      return items.length;
    },
    getKeepGoingIndex: () => keepGoingIndex,
    resize,
    render
  };
}
