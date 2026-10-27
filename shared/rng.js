// Small deterministic PRNG (mulberry32) so the map/props are identical on server and client.
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  rng.weighted = (list) => {
    const total = list.reduce((s, e) => s + e.w, 0);
    let r = rng() * total;
    for (const e of list) {
      if ((r -= e.w) < 0) return e;
    }
    return list[list.length - 1];
  };
  return rng;
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
