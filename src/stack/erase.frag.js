/**
 * Cover sampling + luminance erase + blue→red grade.
 * uCutoff: 1 = intact, 0 = fully erased (darkest first).
 * uColorMix: 0 = foto originale, 1 = gradiente blu(scuro)→rosso(chiaro).
 */
export default /* glsl */ `
uniform sampler2D uMap;
uniform float uCutoff;
uniform float uColorMix;
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
    // wider screen → crop top/bottom
    outUv.y = 0.5 + (uv.y - 0.5) * (iA / sA);
  } else {
    // taller screen → crop left/right
    outUv.x = 0.5 + (uv.x - 0.5) * (sA / iA);
  }
  return outUv;
}

void main() {
  vec2 uv = coverUV(vUv, uResolution, uImageSize);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 tex = texture2D(uMap, uv);
  float L = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));

  // erase dark → light as uCutoff goes 1 → 0 (strict < keeps L=0 intact at start)
  if (L < (1.0 - uCutoff)) discard;

  vec3 graded = mix(COL_BLUE, COL_RED, L);
  // tint keeps luminance: dark stays dark blue, lights go red
  graded *= mix(0.35, 1.0, L);
  vec3 color = mix(tex.rgb, graded, clamp(uColorMix, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;
