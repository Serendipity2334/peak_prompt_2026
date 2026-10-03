import * as THREE from 'three';
import { indexAtDistance, uFromProgress } from './scene.js';

const MAX_TEX_W = 1024;
const PLANE_H = 2.4; // altezza piano in unità scena
const LATERAL = 1.35; // offset sx/dx alternato
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Riduce texture a max MAX_TEX_W (sobrietà).
 */
function downscaleTexture(texture) {
  const img = texture.image;
  if (!img?.width) return texture;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  if (img.width <= MAX_TEX_W) return texture;

  const scale = MAX_TEX_W / img.width;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  texture.image = canvas;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Passo 2 — piani foto lungo la curva, billboard morbido, offset alternato.
 * Shader soglia arriverà al passo 3: per ora texture originale.
 */
export function createPhotos(scene, percorso, curve, camera) {
  const { track, photos } = percorso;
  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();
  const items = [];
  const tmpSide = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();

  // Placeholder geometrici subito (anche senza texture)
  photos.forEach((photo, i) => {
    const u = THREE.MathUtils.clamp(
      indexAtDistance(track, photo.dist) / Math.max(track.length - 1, 1),
      0,
      1
    );
    const pos = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();
    tmpSide.crossVectors(UP, tangent).normalize();
    if (tmpSide.lengthSq() < 1e-6) tmpSide.set(1, 0, 0);

    const side = i % 2 === 0 ? -1 : 1;
    pos.addScaledVector(tmpSide, side * LATERAL);
    pos.y += 0.55;

    // Aspect provvisorio 3:4 finché non arriva la texture
    const geo = new THREE.PlaneGeometry(PLANE_H * 0.75, PLANE_H);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData.photo = photo;
    mesh.userData.u = u;
    mesh.userData.loaded = false;
    mesh.userData.loading = false;
    group.add(mesh);

    // Cornice 1px (sottile): bordo come LineLoop
    const hw = (PLANE_H * 0.75) / 2;
    const hh = PLANE_H / 2;
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, -hh, 0.01),
        new THREE.Vector3(hw, -hh, 0.01),
        new THREE.Vector3(hw, hh, 0.01),
        new THREE.Vector3(-hw, hh, 0.01)
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    mesh.add(frame);
    mesh.userData.frame = frame;

    items.push(mesh);
  });

  function loadOne(mesh) {
    if (mesh.userData.loaded || mesh.userData.loading) return;
    mesh.userData.loading = true;
    const url = '/' + mesh.userData.photo.image;

    loader.load(
      url,
      (tex) => {
        downscaleTexture(tex);
        const img = tex.image;
        const aspect = img.width / img.height;
        const w = PLANE_H * aspect;

        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(w, PLANE_H);
        mesh.material.map = tex;
        mesh.material.color.set(0xffffff);
        mesh.material.needsUpdate = true;

        // Aggiorna cornice alle nuove dimensioni
        const hw = w / 2;
        const hh = PLANE_H / 2;
        mesh.userData.frame.geometry.dispose();
        mesh.userData.frame.geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-hw, -hh, 0.01),
          new THREE.Vector3(hw, -hh, 0.01),
          new THREE.Vector3(hw, hh, 0.01),
          new THREE.Vector3(-hw, hh, 0.01)
        ]);

        mesh.userData.loaded = true;
        mesh.userData.loading = false;
      },
      undefined,
      () => {
        mesh.userData.loading = false;
      }
    );
  }

  /** Carica prima le N più vicine alla camera lungo la curva */
  function ensureTextures(pSmooth, nNear = 5) {
    const camU = uFromProgress(track, pSmooth);
    const ranked = items
      .map((mesh, i) => ({ mesh, i, d: Math.abs(mesh.userData.u - camU) }))
      .sort((a, b) => a.d - b.d);

    // Priorità: le più vicine
    ranked.slice(0, nNear).forEach(({ mesh }) => loadOne(mesh));

    // Poi le altre, a raffica leggera
    let delay = 0;
    ranked.slice(nNear).forEach(({ mesh }) => {
      delay += 40;
      setTimeout(() => loadOne(mesh), delay);
    });
  }

  let bootstrapped = false;

  /**
   * Billboard morbido + priorità texture.
   * @param {number} pSmooth progresso scroll 0–1
   */
  function update(pSmooth) {
    if (!bootstrapped) {
      bootstrapped = true;
      ensureTextures(pSmooth, 5);
    }

    // Billboard morbido: allinea al quaternion della camera
    targetQuat.copy(camera.quaternion);
    for (const mesh of items) {
      mesh.quaternion.slerp(targetQuat, 0.14);
    }
  }

  /** Indice foto più vicina alla camera (per tappa HUD, dopo) */
  function nearestIndex(pSmooth) {
    const camU = uFromProgress(track, pSmooth);
    let best = 0;
    let bestD = Infinity;
    items.forEach((mesh, i) => {
      const d = Math.abs(mesh.userData.u - camU);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function dispose() {
    items.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.userData.frame?.geometry.dispose();
      mesh.userData.frame?.material.dispose();
    });
    scene.remove(group);
  }

  return {
    group,
    items,
    update,
    nearestIndex,
    ensureTextures,
    dispose
  };
}
