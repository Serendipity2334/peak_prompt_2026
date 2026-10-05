/**
 * B/N + Sobel blu/rosso.
 * uMap = thumb, uMapHi = full; uDetailMix 0→1 blend senza stacco.
 * uGrain: stessa grana fine statica della landing (0 = off).
 * uEdgeAmt: intensità tinta edge (peak più bassa → più B/N).
 * uRedOnly: (legacy) se attivo, stessa formula ma senza spinta extra sul blu.
 * uEdgeOnly: 1 = solo outline edge (trasparente altrove), per vista light.
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
uniform float uEdgeAmt;
uniform float uEdgeOnly;
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

float lumaAt(vec2 uv) {
  vec4 s = sampleMix4(uv);
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
  if (uUseAlpha > 0.5 && tex4.a < 0.08) discard;

  vec3 tex = tex4.rgb;
  float L = dot(tex, vec3(0.2126, 0.7152, 0.0722));

  if (L < (1.0 - uCutoff)) discard;

  vec2 texel = 1.0 / max(uImageSize, vec2(1.0));

  float tl = lumaAt(uv + vec2(-texel.x,  texel.y));
  float t  = lumaAt(uv + vec2( 0.0,      texel.y));
  float tr = lumaAt(uv + vec2( texel.x,  texel.y));
  float l  = lumaAt(uv + vec2(-texel.x,  0.0));
  float r  = lumaAt(uv + vec2( texel.x,  0.0));
  float bl = lumaAt(uv + vec2(-texel.x, -texel.y));
  float b  = lumaAt(uv + vec2( 0.0,     -texel.y));
  float br = lumaAt(uv + vec2( texel.x, -texel.y));

  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = length(vec2(gx, gy));

  vec3 bw = vec3(L);
  vec3 grade;
  edge = smoothstep(0.04, 0.5, edge);
  float sum = uLight + uShadow;
  float photoTone = sum > 1e-4 ? (uLight / sum) : L;
  float tone = clamp(mix(L, photoTone, sum > 1e-4 ? 0.45 : 0.0), 0.0, 1.0);
  // rosa/magenta = mix COL_BLUE → COL_RED (come nello screenshot)
  grade = mix(COL_BLUE, COL_RED, tone);
  if (uRedOnly > 0.5) {
    // niente spinta verso il blu puro; resta sul rosa del mix
    grade = mix(grade, COL_RED, clamp(uLight * 0.35, 0.0, 0.5));
  } else {
    grade = mix(grade, COL_BLUE, clamp(uShadow * 0.35, 0.0, 0.5));
    grade = mix(grade, COL_RED, clamp(uLight * 0.35, 0.0, 0.5));
  }

  edge *= clamp(uEdgeAmt, 0.0, 1.5);

  float a = clamp(uOpacity, 0.0, 1.0);
  if (uUseAlpha > 0.5) a *= tex4.a;

  // uEdgeOnly 1→0: sotto l’outline compare gradualmente la foto B/N
  float edgeAmt = clamp(uEdgeOnly, 0.0, 1.0);
  float fill = 1.0 - edgeAmt;
  vec3 fullColor = mix(bw, grade, edge);
  fullColor += grain(vUv) * uGrain * fill;

  vec3 color;
  if (edgeAmt > 0.5) {
    // solo tratti sottili (niente “riempimento” magenta tra i bordi)
    float line = smoothstep(0.42, 0.85, edge);
    if (line < 0.08) discard;
    color = grade;
    a *= line;
  } else {
    float edgeMask = clamp(edge, 0.0, 1.0);
    color = mix(grade, fullColor, fill);
    a *= mix(edgeMask, 1.0, fill);
  }
  color = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(color, a);
}
`;
