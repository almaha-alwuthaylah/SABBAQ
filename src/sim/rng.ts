export function mulberry32(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** log-normal sample with given mean and shape sigma */
export function lognormal(rng: () => number, mean: number, sigma: number) {
  const u1 = Math.max(1e-9, rng()), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  return Math.exp(mu + sigma * z);
}
