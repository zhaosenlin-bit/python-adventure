/* Polyfork · scene merge helper.
 *
 * Every asset in this catalog ships the same vertex-colored material (no
 * textures), so any set of them can collapse into a single geometry: one draw
 * call for a whole scene.
 *
 *   import { mergeAssets } from 'https://polyfork.dev/cdn/merge.mjs';
 *
 *   const { merged, dynamic } = mergeAssets([
 *     terrain, tree, rock,                 // plain objects merge fully
 *     { object: chest, rig: chestRig },    // rig-declared parts stay animatable
 *   ]);
 *   scene.add(merged);                     // ONE draw call, static
 *   dynamic.forEach(d => scene.add(d));    // lids/wheels/doors, still movable
 *
 * Notes: position/rotate/scale your assets BEFORE merging (world transforms are
 * baked in). Skinned characters are lifted into `dynamic` automatically. For many
 * copies of one model, prefer THREE.InstancedMesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* What makes two materials the SAME material for merging purposes.
 *
 * Not the uuid: every asset module constructs its own MeshStandardMaterial, so
 * identity would put each asset in its own bucket and merging fifty of them
 * would give fifty draw calls, which is the opposite of the point. What matters
 * is whether the renderer would treat them alike, so key on the properties that
 * decide that. */
const matKey = (m) => !m ? 'none' : [
  m.type, m.vertexColors, m.flatShading, m.transparent, m.opacity, m.side, m.depthWrite,
  m.metalness, m.roughness, m.emissiveIntensity,
  m.color?.getHexString?.() ?? '', m.emissive?.getHexString?.() ?? '',
].join('|');

/* A TEXTURED material (an HD edition's, lib/materials) merges by what it is
 * made of, not by its colour. The colour is baked into the vertex colours the
 * material already multiplies (`vertexColors: true` is how lib/materials gives
 * each part its tone), so every zone of oiled oak in a whole kit, whatever its
 * shade, is ONE mesh with ONE material: a kit scene becomes one draw call per
 * material in the kit's palette. What stays in the key is everything that
 * changes the shader or the look besides the base colour, and the textures by
 * identity (lib/materials shares them by content, so equal finishes hold the
 * same objects). A material with its own shader code (fire) or its own uniforms
 * is kept to itself by its uuid. The one exception is lib/materials' glance
 * (foliage and bark turn their specular down by a constant): it has no state,
 * so equal glances merge, keyed by its program key. Before that every tree in
 * the Nature kit drew its needles and its bark on their own.
 *
 * The small per-part tunings are BANDED, not matched: an early edition pinned
 * its own relief (0.3, 0.4, 2.2 where the house says 1), a module nudged a
 * metal to 0.85, fabric derives its sheen colour from the zone's colour. Keyed
 * exactly, Open Plan's 52 HD parts made 73 buckets out of a 16-material
 * palette. Relief is not keyed at all and metalness goes by halves (after the
 * palette pass the same brass still came as 1, 0.8, 0.75, 0.45 and 0.35, and
 * relief from 0.08 to 2.2: 40 buckets), the rest by quarters, and the bucket
 * takes the values of its largest member (the sheen colour is averaged). Seen from a
 * whole kit, those differences are below the pixel; on an asset page nothing
 * is merged. */
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap', 'clearcoatMap', 'clearcoatNormalMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'specularIntensityMap', 'specularColorMap', 'anisotropyMap'];
const textured = (m) => !!m && (m.isMeshPhysicalMaterial || MAPS.some((k) => m[k]));
const hex = (c) => c?.getHexString?.() ?? '';
const q4 = (x) => (x == null ? '' : Math.round(x * 4) / 4);
const q2 = (x) => (x == null ? '' : Math.round(x * 2) / 2);
const glanceOnly = (m) => m.userData?.glance != null && !m.userData?.fire   // the key is the default (the function's source) plus the glance, nothing else
  && m.customProgramCacheKey?.() === `${m.onBeforeCompile}|pf-glance-${Number(m.userData.glance).toFixed(3)}`;
const texKey = (m) => (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && !glanceOnly(m)) || m.userData?.fire
  ? 'own|' + m.uuid
  : ['tex', glanceOnly(m) ? m.customProgramCacheKey() : '', m.type, m.transparent, m.opacity, m.side, m.shadowSide, m.depthWrite, m.alphaTest, m.alphaToCoverage, m.flatShading,
     q2(m.metalness), q4(m.roughness), hex(m.emissive), q4(m.emissiveIntensity), q4(m.envMapIntensity), Math.sign(m.normalScale?.y ?? 0),
     q4(m.sheen), q4(m.sheenRoughness), q4(m.clearcoat), q4(m.clearcoatRoughness), q4(m.anisotropy), m.anisotropyRotation,
     m.transmission, m.thickness, m.ior, hex(m.attenuationColor), m.attenuationDistance, m.specularIntensity, hex(m.specularColor),
     m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, !!m.userData?.glow, !!m.userData?.emits,
     ...MAPS.map((k) => m[k]?.uuid ?? '')].join('|');

export function mergeAssets(list, { keepDynamic = true } = {}) {
  const buckets = {};        // material signature -> { material, geoms }
  const dynamic = [];

  const lift = node => {
    const out = node.clone(true);
    node.updateWorldMatrix(true, false);
    node.matrixWorld.decompose(out.position, out.quaternion, out.scale);
    dynamic.push(out);
  };

  /* The textured path: position, normal, uv and colour kept (a mesh without UVs
   * gets zeros, so the bucket's attributes agree), the material's colour folded
   * into the vertex colours, and the bucket drawn with a copy whose colour is
   * white. An own-shader material keeps its colour and its object. */
  const mergeTextured = (node) => {
    const m = node.material, key = texKey(m), own = key.startsWith('own|');
    let g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    g.applyMatrix4(node.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const col = m.vertexColors ? g.attributes.color : null, tint = own ? new THREE.Color(1, 1, 1) : (m.color ?? new THREE.Color(1, 1, 1));
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = col ? col.getX(i) : 1, gg = col ? col.getY(i) : 1, b = col ? col.getZ(i) : 1;
      arr[i * 3] = r * tint.r; arr[i * 3 + 1] = gg * tint.g; arr[i * 3 + 2] = b * tint.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const name of ['position', 'normal', 'uv', 'color']) g.attributes[name].gpuType = THREE.FloatType;
    const bucket = (buckets[key] ??= { material: own ? m : null, geoms: [], best: null, bestN: -1, sheen: [] });
    if (!own && n > bucket.bestN) { bucket.best = m; bucket.bestN = n; }
    if (!own && m.sheenColor && m.sheen) bucket.sheen.push(m.sheenColor);
    bucket.geoms.push(g);
  };
  const finishTextured = () => {
    for (const b of Object.values(buckets)) {
      if (b.material || !b.best) continue;
      const material = b.best.clone();
      material.color.set(1, 1, 1); material.vertexColors = true; material.name = 'merged:' + (b.best.name || 'zone');
      if (glanceOnly(b.best)) { material.onBeforeCompile = b.best.onBeforeCompile; material.customProgramCacheKey = b.best.customProgramCacheKey; }   // clone() drops both
      if (b.sheen.length) { const c = new THREE.Color(0, 0, 0); for (const x of b.sheen) c.add(x); material.sheenColor = c.multiplyScalar(1 / b.sheen.length); }
      b.material = material;
    }
  };

  for (const entry of list) {
    const object = entry?.isObject3D ? entry : entry?.object;
    if (!object) continue;
    const exclude = new Set(keepDynamic ? Object.keys(entry?.rig ?? {}) : []);
    object.updateWorldMatrix(true, true);
    (function walk(node) {
      if (exclude.has(node.name)) { lift(node); return; }
      if (node.isSkinnedMesh) { if (keepDynamic) lift(node); return; }
      if (node.isMesh && !Array.isArray(node.material) && textured(node.material) && node.geometry?.attributes?.position) {
        mergeTextured(node);
      } else if (node.isMesh && node.geometry?.attributes?.position) {
        let g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
        g.applyMatrix4(node.matrixWorld);
        /* YOUR OWN ATTRIBUTES SURVIVE when every part in the bucket has them. This
         * deleted everything but position, normal and colour, so a per-vertex
         * night glow written before the merge (an `emissive` attribute, say) was
         * dropped without a word and the scene simply went dark (probe #267).
         * Texture and skin attributes still go; a custom one is kept here and
         * removed at merge time only if some part in its bucket lacks it. */
        for (const name of Object.keys(g.attributes)) {
          if (name === 'position' || name === 'normal' || name === 'color') continue;
          if (/^(uv\d*|tangent|skinIndex|skinWeight)$/.test(name)) g.deleteAttribute(name);
        }
        if (!g.attributes.normal) g.computeVertexNormals(); // normal-less GLBs (previews) merge too
        // Normalize colors: synthesize from the material when a part has none,
        // and flatten RGBA vertex colors to RGB, so every geometry matches.
        const col = g.attributes.color;
        if (!col) {
          const n = g.attributes.position.count;
          const c = new THREE.Color(node.material?.color ?? 0xffffff);
          const arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        } else if (col.itemSize === 4) {
          const n = col.count, arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { arr[i * 3] = col.getX(i); arr[i * 3 + 1] = col.getY(i); arr[i * 3 + 2] = col.getZ(i); }
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        }
        /* MERGING A MERGED GEOMETRY, which is the whole point of being able to
         * call this twice.
         *
         * mergeGeometries stamps an explicit gpuType on the attributes it
         * produces, while a fresh Float32BufferAttribute leaves it undefined,
         * and three compares the two with a strict !==. So the second merge of
         * a scene always failed on `position`: the already-merged geometry said
         * 1015 and every new asset said undefined. It failed QUIETLY, returning
         * null, so the only symptom was a scene that stayed at several draw
         * calls while claiming one.
         *
         * Both values mean float. Saying so explicitly on everything we are
         * about to merge makes the comparison agree.
         *
         * LAST, after the colour normalisation below, because that synthesises
         * a colour attribute for parts that have none and it would arrive with
         * the default gpuType behind our back.
         */
        for (const name of ['position', 'normal', 'color']) {
          const a = g.attributes[name];
          if (a && a.gpuType !== THREE.FloatType) a.gpuType = THREE.FloatType;
        }
        /* Bucketed BY MATERIAL, not poured into one. Most of the catalogue
         * shares a single opaque material, which is why this merges to one draw
         * call at all — but 21 assets carry a second one for a surface the
         * shared material cannot express (the lamp post's transparent lens, the
         * greenhouse glazing, the jukebox chrome). Merging those into the opaque
         * bucket rendered the glass solid: the merge silently changed how the
         * asset looked, which is worse than costing one more draw call. */
        const key = matKey(node.material);
        (buckets[key] ??= { material: node.material, geoms: [] }).geoms.push(g);
      }
      for (const c of node.children) walk(c);
    })(object);
  }

  finishTextured();
  const parts = [];
  for (const { material, geoms } of Object.values(buckets)) {
    // Custom attributes only where the whole bucket carries them, same size.
    if (geoms.length && !material?.map) {
      const core = new Set(['position', 'normal', 'color', 'uv']);
      const extra = Object.keys(geoms[0].attributes).filter((k) => !core.has(k)
        && geoms.every((g) => g.attributes[k] && g.attributes[k].itemSize === geoms[0].attributes[k].itemSize));
      for (const g of geoms) {
        for (const k of Object.keys(g.attributes)) {
          if (core.has(k)) continue;
          if (!extra.includes(k)) { g.deleteAttribute(k); continue; }
          const a = g.attributes[k];
          if (a.array instanceof Float32Array && a.gpuType !== THREE.FloatType) a.gpuType = THREE.FloatType;
        }
      }
    }
    const mg = geoms.length ? mergeGeometries(geoms, false) : null;
    /* SAY WHY WHEN IT FAILS. mergeGeometries returns null and logs a message
     * naming the attribute but never the geometry, so a bucket that will not
     * merge degrades silently into extra draw calls and the caller is left
     * comparing three.js's complaint against nothing. Printing the signature of
     * every geometry in the bucket turns "the position attribute failed" into
     * the one row that differs from the rest. */
    if (!mg && geoms.length) {
      const sig = g => Object.keys(g.attributes).sort().map(k => {
        const a = g.attributes[k];
        return `${k}[${a.itemSize}] ${a.array.constructor.name} gpu=${a.gpuType ?? 'default'}`
          + (a.normalized ? ' normalized' : '');
      }).join(', ');
      const rows = geoms.map((g, i) => `  #${i} ${g.attributes.position.count} verts: ${sig(g)}`);
      console.warn('mergeAssets: a material bucket would not merge, so it stays separate.\n'
        + rows.join('\n'));
    }
    if (mg) {
      const mesh = new THREE.Mesh(mg, material);
      mesh.castShadow = !material?.userData?.glow; mesh.receiveShadow = true;
      parts.push(mesh);
    }
    geoms.forEach(g => g.dispose?.());
  }
  /* One material stays one Mesh, which is the case that matters and what every
   * caller already expects. Several become a Group, so `scene.add(merged)` is
   * unchanged either way and only somebody reaching for `merged.geometry` has
   * to care. `draw_calls` on the API tells you which you are getting. */
  let merged = null;
  if (parts.length === 1) merged = parts[0];
  else if (parts.length > 1) {
    merged = new THREE.Group();
    merged.name = 'merged';
    parts.forEach(p => merged.add(p));
  }
  return { merged, dynamic };
}
