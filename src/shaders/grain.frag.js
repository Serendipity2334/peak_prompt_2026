/**
 * Passo 1 — sfondo a tutto schermo:
 * mix blu→rosso in base allo scroll, con grana animata (Bayer + noise).
 */
export default /* glsl */ `
uniform vec3 uBlue;
uniform vec3 uRed;
uniform float uMix;   // 0 = blu (partenza), 1 = rosso (vetta)
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float n = q.x + q.y * 4.0;
  // valori Bayer 4×4 / 16
  float v =
    n < 1.0 ? 0.0 :
    n < 2.0 ? 8.0 :
    n < 3.0 ? 2.0 :
    n < 4.0 ? 10.0 :
    n < 5.0 ? 12.0 :
    n < 6.0 ? 4.0 :
    n < 7.0 ? 14.0 :
    n < 8.0 ? 6.0 :
    n < 9.0 ? 3.0 :
    n < 10.0 ? 11.0 :
    n < 11.0 ? 1.0 :
    n < 12.0 ? 9.0 :
    n < 13.0 ? 15.0 :
    n < 14.0 ? 7.0 :
    n < 15.0 ? 13.0 : 5.0;
  return v / 16.0;
}

void main() {
  vec3 base = mix(uBlue, uRed, clamp(uMix, 0.0, 1.0));

  // grana in movimento
  float n = hash(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 19.0));
  float b = bayer4(gl_FragCoord.xy + vec2(uTime * 2.0, -uTime));
  float grain = (n * 0.55 + b * 0.45) - 0.5;

  vec3 col = base + grain * 0.085;
  gl_FragColor = vec4(col, 1.0);
}
`;
