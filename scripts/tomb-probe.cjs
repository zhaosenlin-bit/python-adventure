// 校验 polyfork 素材在 Node 下的可加载性与真实包围盒（用于精确摆放）
const THREE = require('three');
const path = require('path');
const dir = path.join(__dirname, '..', 'components', 'tomb', 'assets');
const ids = ['flagstone-floor-tile-2a04ea','dungeon-wall-module-a537b3','burial-niche-wall-1b937f',
 'barred-portcullis-2aa444','stone-sarcophagus-cc96a4','tomb-slab-ca9895','timber-trestle-table-024d88',
 'trapdoor-pit-8d9a78','standing-brazier-c9e4ee','iron-chandelier-1337dc','wall-torch-bracket-f5ad14',
 'cobweb-drape-f65d43','wall-manacle-fitting-e80d3a','root-intrusion-9f1eaa','standing-water-pool-daafcb',
 'drain-grate-tile-5568d9','moss-patch-3ecaf4','stone-altar-8f3a0a','spiral-stair-shaft-80de26',
 'prospector-69a481','professor-14dc4d','graduate-student-945ef0','student-with-backpack-65d2b4',
 'hiker-3d1a41','porter-e4e566','dungeon-rat-cbb03c','shambling-ghoul-256f2f','barred-cell-door-571e9c'];
(async () => {
  for (const id of ids) {
    try {
      const mod = await import('file:///' + path.join(dir, id + '.mjs').replace(/\\/g,'/'));
      const obj = mod.createAsset();
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); box.getSize(size);
      const c = new THREE.Vector3(); box.getCenter(c);
      let meshes = 0, hasBone = false;
      obj.traverse(o => { if (o.isMesh) meshes++; if (o.isBone) hasBone = true; });
      console.log(`${id.padEnd(32)} min(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}) size(${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}) meshes=${meshes} bone=${hasBone}`);
    } catch (e) {
      console.log(`${id.padEnd(32)} ERROR ${e.message}`);
    }
  }
})();
