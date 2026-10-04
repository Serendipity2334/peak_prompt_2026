/**
 * B/N + Sobel blu/rosso.
 * uMap = thumb, uMapHi = full; uDetailMix 0→1 blend senza stacco.
 * uGrain: stessa grana fine statica della landing (0 = off).
 * uUseAlpha: PNG ritagliato (slide finale) → buchi trasparenti, sfondo dietro.
 * uRedOnly: B/N + soli dettagli rossi (niente blu), edge più radi.
 */
export default /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMapHi;
uniform float uDetailMix;
uniform float uCutoff;
uniform float uLight;
uniform float uShadow;
uniform float uCover;
uniform float uOpacity;
uniform float uGrain;
uniform float uUseAlpha;
uniform float uRedOnly;
uniform vec2 uResolution;
uniform vec2 uImageSize;
varying vec2 vUv;

const vec3 COL_BLUE = vec3(0.1216, 0.1765, 1.0);
const vec3 COL_RED = vec3(1.0, 0.2275, 0.1412);

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

vec4 sampleMix4(vec2 uv) {
  vec4 lo = texture2D(uMap, uv);
  vec4 hi = texture2D(uMapHi, uv);
  return mix(lo, hi, clamp(uDetailMix, 0.0, 1.0));
}

float lumaAt(vec2 uv, float Lcenter) {
  vec4 s = sampleMix4(uv);
  // ritaglio PNG: fuori dal soggetto non creare bordo Sobel finto
  // (altrimenti alone rosso sul silhouette → si vede il cutout)
  if (uUseAlpha > 0.5 && s.a < 0.12) return Lcenter;
  return dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// grana fine e statica (come morphBgFrag della landing)
float grain(vec2 uv) {
  return hash(floor(uv * uResolution * 1.6)) * 2.0 - 1.0;
}

void main() {
  vec2 uv = uCover > 0.5 ? coverUV(vUv, uResolution, uImageSize) : vUv;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 tex4 = sampleMix4(uv);
  // feather soft sul ritaglio → meno “foto ritagliata”
  float cutA = uUseAlpha > 0.5 ? smoothstep(0.04, 0.42, tex4.a) : 1.0;
  if (cutA < 0.02) discard;

  vec3 tex = tex4.rgb;
  float L = dot(tex, vec3(0.2126, 0.7152, 0.0722));

  if (L < (1.0 - uCutoff)) discard;

  vec2 texel = 1.0 / max(uImageSize, vec2(1.0));

  float tl = lumaAt(uv + vec2(-texel.x,  texel.y), L);
  float t  = lumaAt(uv + vec2( 0.0,      texel.y), L);
  float tr = lumaAt(uv + vec2( texel.x,  texel.y), L);
  float l  = lumaAt(uv + vec2(-texel.x,  0.0), L);
  float r  = lumaAt(uv + vec2( texel.x,  0.0), L);
  float bl = lumaAt(uv + vec2(-texel.x, -texel.y), L);
  float b  = lumaAt(uv + vec2( 0.0,     -texel.y), L);
  float br = lumaAt(uv + vec2( texel.x, -texel.y), L);

  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = length(vec2(gx, gy));

  vec3 bw = vec3(L);
  vec3 grade;
  if (uRedOnly > 0.5) {
    // solo contorni forti → dettagli rossi più radi
    edge = smoothstep(0.14, 0.72, edge);
    edge = pow(edge, 1.7) * 0.5;
    grade = COL_RED;
  } else {
    edge = smoothstep(0.04, 0.5, edge);
    float sum = uLight + uShadow;
    float photoTone = sum > 1e-4 ? (uLight / sum) : L;
    float tone = clamp(mix(L, photoTone, sum > 1e-4 ? 0.45 : 0.0), 0.0, 1.0);
    grade = mix(COL_BLUE, COL_RED, tone);
    grade = mix(grade, COL_BLUE, clamp(uShadow * 0.35, 0.0, 0.5));
    grade = mix(grade, COL_RED, clamp(uLight * 0.35, 0.0, 0.5));
  }

  // peak ritagliata: corpo in B/N, solo micro-accenti edge (niente viola/rosso pieno)
  if (uUseAlpha > 0.5) {
    edge = pow(smoothstep(0.3, 0.92, edge), 1.55) * 0.1;
  }

  vec3 color = mix(bw, grade, edge);
  color += grain(vUv) * uGrain;
  color = clamp(color, 0.0, 1.0);

  float a = clamp(uOpacity, 0.0, 1.0) * cutA;
  // dissolve ampia su base/lati del PNG → non si legge il rettangolo ritagliato
  if (uUseAlpha > 0.5) {
    float fadeX = smoothstep(0.0, 0.11, min(uv.x, 1.0 - uv.x));
    float fadeBot = smoothstep(0.0, 0.14, uv.y);
    float fadeTop = smoothstep(0.0, 0.02, 1.0 - uv.y);
    float edgeFade = fadeX * fadeBot * fadeTop;
    // schiarisce verso bianco mentre dissolve (niente banda grigia “ombra”)
    color = mix(vec3(1.0), color, pow(edgeFade, 0.5));
    a *= pow(edgeFade, 0.9);
  }
  gl_FragColor = vec4(color, a);
}
`;
