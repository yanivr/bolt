/**
 * Exact Euclidean distance transform (Felzenszwalb and Huttenlocher), in two separable passes.
 * `seed` marks the pixels distances are measured to; the result is the distance in pixels from
 * every pixel to the nearest seed, `Infinity` when there is none.
 */

const BIG = 1e20;

function pass1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -BIG;
  z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/** Squared distances to the nearest seed pixel. */
export function distanceSquared(seed: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = seed[y * w + x] ? 0 : BIG;
    pass1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x]!;
    pass1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x]!;
  }
  return out;
}

/** Distances in pixels, as 32-bit floats, capped at `cap`. */
export function distanceField(seed: Uint8Array, w: number, h: number, cap = 4000): Float32Array {
  const sq = distanceSquared(seed, w, h);
  const out = new Float32Array(w * h);
  const c2 = cap * cap;
  for (let i = 0; i < w * h; i++) out[i] = sq[i]! >= c2 ? cap : Math.sqrt(sq[i]!);
  return out;
}
