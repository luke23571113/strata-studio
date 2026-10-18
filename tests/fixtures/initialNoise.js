// Original noise streams retained for regression tests.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { createSeededRandom } from '../../src/world/random.js';

export function createNoiseFields(seed) {
  return {
    continents: new SimplexNoise({ random: createSeededRandom(seed, 0x434f4e54) }),
    mountains: new SimplexNoise({ random: createSeededRandom(seed, 0x4d4f554e) }),
    detail: new SimplexNoise({ random: createSeededRandom(seed, 0x44455441) }),
  };
}
