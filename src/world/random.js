// MurmurHash3's 32-bit finalizer separates each named stream before Mulberry32.
function mixSeed(seed, streamSalt) {
  let mixed = (seed ^ streamSalt) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function createSeededRandom(seed, streamSalt = 0) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Seed must be an unsigned 32-bit integer.');
  }

  let state = mixSeed(seed, streamSalt);

  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    const unsigned = (mixed ^ (mixed >>> 14)) >>> 0;
    return unsigned / 4294967296;
  };
}
