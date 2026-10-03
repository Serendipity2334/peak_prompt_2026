import * as THREE from 'three';
import grainVert from '../shaders/grain.vert.js';
import grainFrag from '../shaders/grain.frag.js';

const BLUE = new THREE.Color('#1f2dff');
const RED = new THREE.Color('#ff3a24');

/**
 * Piano a tutto schermo con shader di grana (passo 1).
 */
export function createGrainPlane(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'low-power',
    alpha: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(BLUE, 1);

  const scene = new THREE.Scene();
  // Camera ortografica: il vert shader usa già clip-space
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uBlue: { value: BLUE.clone() },
    uRed: { value: RED.clone() },
    uMix: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: grainVert,
    fragmentShader: grainFrag,
    depthTest: false,
    depthWrite: false
  });

  // Quad a tutto schermo in clip space (-1..1)
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    uniforms.uRes.value.set(w, h);
  }

  function setMix(m) {
    uniforms.uMix.value = m;
  }

  function render(timeSec) {
    uniforms.uTime.value = timeSec;
    renderer.render(scene, camera);
  }

  return {
    renderer,
    uniforms,
    resize,
    setMix,
    render,
    get mix() {
      return uniforms.uMix.value;
    }
  };
}
