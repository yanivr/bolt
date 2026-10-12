import { Voxels, renderVoxels } from './voxel.js';
import { buildTree } from './trees.js';
for (let rep = 0; rep < 3; rep++) {
let t0 = performance.now();
const v = new Voxels(-75, -75, 150, 150, 120);
console.log('alloc', (performance.now() - t0).toFixed(0)); t0 = performance.now();
for (let k = 0; k < 300; k++) v.ellipsoid(Math.random()*40-20, Math.random()*40-20, 60+Math.random()*20, 5, 5, 4.5, 1, { tag: 3, bend: { x: 0, y: 0, z: 1, k: 0.45 } });
console.log('300 clumps', (performance.now() - t0).toFixed(0)); t0 = performance.now();
v.ellipsoid(0, 0, 70, 28, 28, 22, 1);
console.log('core', (performance.now() - t0).toFixed(0)); t0 = performance.now();
renderVoxels(v, () => 0x336633);
console.log('render', (performance.now() - t0).toFixed(0)); t0 = performance.now();
for (let k = 0; k < 5; k++) buildTree({ species: 'oak', seed: 100 + k, radius: 15 });
console.log('oak', ((performance.now() - t0) / 5).toFixed(0));
}
