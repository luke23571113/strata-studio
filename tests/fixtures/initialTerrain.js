// First terrain prototype, retained only as regression-test input.
import { createNoiseFields } from './initialNoise.js';
import { sampleFractalNoise } from '../../src/world/noise.js';

export const TERRAIN_RECIPE = Object.freeze({
  referenceRadius: 1,
  oceanRadius: 1,
  minRadius: 0.88,
  maxRadius: 1.18,
  continents: Object.freeze({
    frequency: 1.1,
    octaves: 3,
    lacunarity: 2,
    persistence: 0.45,
    amplitude: 0.1,
    bias: -0.012,
    offset: Object.freeze([12.37, -4.91, 7.63]),
  }),
  mountains: Object.freeze({
    frequency: 5.5,
    exponent: 3,
    amplitude: 0.065,
    maskStart: 0,
    maskEnd: 0.035,
    offset: Object.freeze([-5.17, 17.31, 9.23]),
  }),
  detail: Object.freeze({
    frequency: 18,
    octaves: 2,
    lacunarity: 2,
    persistence: 0.4,
    amplitude: 0.003,
    offset: Object.freeze([3.71, -13.47, 21.19]),
  }),
});

function sampleContinents(noise, x, y, z) {
  const settings = TERRAIN_RECIPE.continents;
  const continentalNoise = sampleFractalNoise(noise, x, y, z, settings);
  const continentalHeight = continentalNoise * settings.amplitude + settings.bias;
  return continentalHeight;
}

function smoothstep(start, end, value) {
  const progress = (value - start) / (end - start);
  const boundedProgress = Math.max(0, Math.min(1, progress));
  return boundedProgress * boundedProgress * (3 - 2 * boundedProgress);
}

function sampleMountains(noise, x, y, z, continentalHeight) {
  const settings = TERRAIN_RECIPE.mountains;
  const sampleX = x * settings.frequency + settings.offset[0];
  const sampleY = y * settings.frequency + settings.offset[1];
  const sampleZ = z * settings.frequency + settings.offset[2];
  const noiseValue = noise.noise3d(sampleX, sampleY, sampleZ);
  const boundedNoise = Math.max(-1, Math.min(1, noiseValue));
  const ridgeStrength = (1 - Math.abs(boundedNoise)) ** settings.exponent;
  const continentalMask = smoothstep(
    settings.maskStart,
    settings.maskEnd,
    continentalHeight,
  );
  const mountainHeight = ridgeStrength * continentalMask * settings.amplitude;
  return mountainHeight;
}

function composeHeight(fields, x, y, z) {
  const continentalHeight = sampleContinents(fields.continents, x, y, z);
  const mountainHeight = sampleMountains(fields.mountains, x, y, z, continentalHeight);
  const detailNoise = sampleFractalNoise(fields.detail, x, y, z, TERRAIN_RECIPE.detail);
  const detailHeight = detailNoise * TERRAIN_RECIPE.detail.amplitude;
  const radius =
    TERRAIN_RECIPE.referenceRadius + continentalHeight + mountainHeight + detailHeight;
  return radius;
}

function validateDirections(directions) {
  if (!(directions instanceof Float64Array)) {
    throw new TypeError('Directions must be a Float64Array of packed unit xyz values.');
  }
  if (directions.length === 0 || directions.length % 3 !== 0) {
    throw new RangeError('Directions must contain complete, nonempty xyz triples.');
  }
}

/** Heights are absolute radii, not elevations above sea level. Inputs stay untouched. */
export function generateTerrain(seed, directions) {
  validateDirections(directions);
  const fields = createNoiseFields(seed);
  const vertexCount = directions.length / 3;
  const positions = new Float32Array(directions.length);
  const heights = new Float32Array(vertexCount);
  let minRadius = Infinity;
  let maxRadius = -Infinity;
  let landCount = 0;
  let clampedCount = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = directions[offset];
    const y = directions[offset + 1];
    const z = directions[offset + 2];
    const lengthSquared = x * x + y * y + z * z;
    if (!Number.isFinite(lengthSquared) || Math.abs(lengthSquared - 1) > 1e-6) {
      throw new RangeError('Every source direction must be finite and unit length.');
    }

    const composedRadius = composeHeight(fields, x, y, z);
    const boundedRadius = Math.max(
      TERRAIN_RECIPE.minRadius,
      Math.min(TERRAIN_RECIPE.maxRadius, composedRadius),
    );
    if (boundedRadius !== composedRadius) {
      clampedCount += 1;
    }

    heights[vertex] = boundedRadius;
    positions[offset] = x * boundedRadius;
    positions[offset + 1] = y * boundedRadius;
    positions[offset + 2] = z * boundedRadius;
    const storedRadius = heights[vertex];
    minRadius = Math.min(minRadius, storedRadius);
    maxRadius = Math.max(maxRadius, storedRadius);
    if (storedRadius > TERRAIN_RECIPE.oceanRadius) {
      landCount += 1;
    }
  }

  return {
    positions,
    heights,
    stats: {
      minRadius,
      maxRadius,
      landFraction: landCount / vertexCount,
      clampedCount,
    },
  };
}
