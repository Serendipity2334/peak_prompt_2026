/**
 * B/N sotto + Sobel edges blu/rosso (luce/ombra).
 * uCutoff: 1 = intact, 0 = fully erased (darkest first).
 */
export default /* glsl */ `
uniform sampler2D uMap;
uniform float uCutoff;
uniform float uLight;
uniform float uShadow;
uniform vec2 uResolution;
uniform vec2 uImageSize;
varying vec2 vUv;

const vec3 COL_BLUE = vec3(0.1216, 0.1765, 1.0); // #1f2dff
const vec3 COL_RED = vec3(1.0, 0.2275, 0.1412);  // #ff3a24

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

float lumaAt(vec2 uv) {
  vec3 rgb = texture2D(uMap, uv).rgb;
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = coverUV(vUv, uResolution, uImageSize);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec3 tex = texture2D(uMap, uv).rgb;
  float L = dot(tex, vec3(0.2126, 0.7152, 0.0722));

  // erase dark → light
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
  edge = smoothstep(0.04, 0.5, edge);

  float sum = uLight + uShadow;
  float photoTone = sum > 1e-4 ? (uLight / sum) : L;
  float tone = clamp(mix(L, photoTone, sum > 1e-4 ? 0.45 : 0.0), 0.0, 1.0);
  vec3 grade = mix(COL_BLUE, COL_RED, tone);
  grade = mix(grade, COL_BLUE, clamp(uShadow * 0.35, 0.0, 0.5));
  grade = mix(grade, COL_RED, clamp(uLight * 0.35, 0.0, 0.5));

  // bianco e nero sotto, edge colorati sopra
  vec3 bw = vec3(L);
  vec3 color = mix(bw, grade, edge);

  gl_FragColor = vec4(color, 1.0);
}
`;
