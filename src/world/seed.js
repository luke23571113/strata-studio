const MAX_SEED = 4294967295;

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError('A world seed must be a whole number from 0 to 4294967295.');
  }
}

export function parseWorldPath(pathname) {
  if (pathname === '/') {
    return { type: 'random' };
  }

  const seedMatch =
    typeof pathname === 'string' && pathname.match(/^\/world\/(0|[1-9]\d*)$/);

  if (seedMatch && seedMatch[0] === pathname) {
    const seed = Number(seedMatch[1]);

    if (seed <= MAX_SEED) {
      return { type: 'seeded', seed };
    }
  }

  if (
    typeof pathname === 'string' &&
    (pathname === '/world' || pathname.startsWith('/world/'))
  ) {
    return {
      type: 'invalid',
      message:
        'This world address is invalid. Use /world/ followed by a whole-number seed from 0 to 4294967295, with no extra characters.',
    };
  }

  return {
    type: 'invalid',
    message: 'This page could not be found. Return to the home page to generate a world.',
  };
}

export function formatWorldPath(seed) {
  validateSeed(seed);
  return `/world/${seed}`;
}

export function createRandomSeed(previousSeed, randomSource = globalThis.crypto) {
  if (previousSeed !== undefined) {
    validateSeed(previousSeed);
  }

  const randomValues = new Uint32Array(1);
  randomSource.getRandomValues(randomValues);
  const sampledSeed = randomValues[0];

  if (sampledSeed === previousSeed) {
    // One draw is enough: advance on a collision instead of retrying forever.
    if (sampledSeed === MAX_SEED) {
      return 0;
    }

    return sampledSeed + 1;
  }

  return sampledSeed;
}
