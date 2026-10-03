/** Fragment shader: B/N con threshold (+ dither Bayer 2×2) */
export default /* glsl */ `
uniform sampler2D uMap;
uniform float uThreshold;
varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float L = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));

  vec2 p = mod(floor(gl_FragCoord.xy), 2.0);
  float bayer = (p.x + p.y * 2.0) / 4.0;
  float d = (bayer - 0.375) * 0.07;

  float v = step(uThreshold, L + d);
  gl_FragColor = vec4(vec3(v), 1.0);
}
`;
