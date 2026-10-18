import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createNoiseFields } from '../fixtures/initialNoise.js';
import { sampleFractalNoise } from '../../src/world/noise.js';
import { createSeededRandom } from '../../src/world/random.js';
import { generateTerrain, TERRAIN_RECIPE } from '../fixtures/initialTerrain.js';
import { createTerrainTopology } from '../../src/world/terrainMesh.js';

const SEED_CORPUS = [
  0, 1, 2, 3, 7, 11, 42, 99, 123, 256, 512, 1024, 2026, 4096, 65535, 65536, 99991, 100000,
  123456, 987654, 1234567, 8675309, 12345678, 123456789, 987654321, 2147483647,
  2147483648, 3000000000, 4000000000, 4294967295,
];
const FLOAT_TOLERANCE = 1e-6;
const CANONICAL_FINGERPRINTS = new Map([
  [0, '4a11cc081b5286ca4e33a0ac2e56abdf427204174e6ef7a6cc9bb592ccfab4d7'],
  [123, 'b9539a3858a635001a3abdc2c14eb51d340ead762741a0f7444404e55cdba4a2'],
  [4294967295, '079dfcef18c4affd9feea501e2f72ffba1f1ea14656300f11ad3994b1a68d57e'],
]);

function makeSphereDirections(vertexCount) {
  const directions = new Float64Array(vertexCount * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const y = 1 - (2 * (vertex + 0.5)) / vertexCount;
    const ringRadius = Math.sqrt(1 - y * y);
    const angle = vertex * goldenAngle;
    const offset = vertex * 3;
    directions[offset] = Math.cos(angle) * ringRadius;
    directions[offset + 1] = y;
    directions[offset + 2] = Math.sin(angle) * ringRadius;
  }

  return directions;
}

function fingerprint(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  return createHash('sha256').update(bytes).digest('hex');
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= FLOAT_TOLERANCE, message);
}

test('30 seeds reproduce full canonical terrain arrays after unrelated generation', (context) => {
  const topology = createTerrainTopology(31);
  context.after(() => topology.geometry.dispose());
  const { directions } = topology;
  assert.equal(directions.length / 3, 10242);
  assert.equal(topology.cornerIndices.length, 61440);
  const originalDirections = directions.slice();
  const firstResults = new Map();
  const fingerprints = new Set();

  for (const seed of SEED_CORPUS) {
    const terrain = generateTerrain(seed, directions);
    assert.ok(terrain.positions instanceof Float32Array);
    assert.ok(terrain.heights instanceof Float32Array);
    assert.equal(terrain.positions.length, directions.length);
    assert.equal(terrain.heights.length, directions.length / 3);
    firstResults.set(seed, terrain);
    const terrainFingerprint = fingerprint(terrain.positions);
    fingerprints.add(terrainFingerprint);
    if (CANONICAL_FINGERPRINTS.has(seed)) {
      assert.equal(terrainFingerprint, CANONICAL_FINGERPRINTS.get(seed));
    }

    let landCount = 0;
    let observedMinimum = Infinity;
    let observedMaximum = -Infinity;

    for (let vertex = 0; vertex < terrain.heights.length; vertex += 1) {
      const radius = terrain.heights[vertex];
      assert.ok(Number.isFinite(radius));
      assert.ok(radius >= TERRAIN_RECIPE.minRadius - FLOAT_TOLERANCE);
      assert.ok(radius <= TERRAIN_RECIPE.maxRadius + FLOAT_TOLERANCE);
      observedMinimum = Math.min(observedMinimum, radius);
      observedMaximum = Math.max(observedMaximum, radius);
      if (radius > TERRAIN_RECIPE.oceanRadius) {
        landCount += 1;
      }

      const offset = vertex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = terrain.positions[offset + axis];
        const expectedCoordinate = directions[offset + axis] * radius;
        assert.ok(Number.isFinite(coordinate));
        assertNear(
          coordinate,
          expectedCoordinate,
          'Displacement follows its source ray.',
        );
      }
    }

    assert.equal(terrain.stats.minRadius, observedMinimum);
    assert.equal(terrain.stats.maxRadius, observedMaximum);
    assert.equal(terrain.stats.landFraction, landCount / terrain.heights.length);
    assert.equal(terrain.stats.clampedCount, 0, `Seed ${seed} needs no safety clamp.`);
  }

  assert.equal(fingerprints.size, SEED_CORPUS.length);

  for (const seed of [...SEED_CORPUS].reverse()) {
    generateTerrain((seed ^ 0xa5a5a5a5) >>> 0, directions);
    const repeated = generateTerrain(seed, directions);
    assert.deepEqual(
      repeated,
      firstResults.get(seed),
      `Seed ${seed} is order independent.`,
    );
  }

  assert.deepEqual(directions, originalDirections);
});

test('fixed anchor radii pin the recipe at poles, axes, and an oblique direction', () => {
  const diagonal = 1 / Math.sqrt(3);
  const directions = new Float64Array([
    1,
    0,
    0,
    -1,
    0,
    0,
    0,
    1,
    0,
    0,
    -1,
    0,
    0,
    0,
    1,
    0,
    0,
    -1,
    diagonal,
    diagonal,
    diagonal,
  ]);
  const fixtures = new Map([
    [
      0,
      [
        0.9773951768875122, 0.9695159196853638, 0.9705939888954163, 1.0041276216506958,
        0.9803156852722168, 0.9835655093193054, 0.9800268411636353,
      ],
    ],
    [
      123,
      [
        0.9956845045089722, 1.0193982124328613, 0.9930358529090881, 1.016449213027954,
        0.9554504752159119, 0.9378700852394104, 0.987454891204834,
      ],
    ],
    [
      4294967295,
      [
        0.9763301610946655, 0.9839044213294983, 1.0754879713058472, 0.9838278293609619,
        1.0110194683074951, 1.0070672035217285, 0.9984952807426453,
      ],
    ],
  ]);

  for (const [seed, expectedRadii] of fixtures) {
    const terrain = generateTerrain(seed, directions);
    assert.equal(terrain.heights.length, expectedRadii.length);
    for (let vertex = 0; vertex < expectedRadii.length; vertex += 1) {
      assertNear(
        terrain.heights[vertex],
        expectedRadii[vertex],
        `Seed ${seed}, anchor ${vertex}`,
      );
    }
  }
});

test('sampling a subset or reordered directions does not rescale a world', () => {
  const directions = makeSphereDirections(257);
  const complete = generateTerrain(123, directions);
  const indices = [256, 0, 101, 42, 101];
  const reorderedDirections = new Float64Array(indices.length * 3);

  for (let vertex = 0; vertex < indices.length; vertex += 1) {
    const sourceOffset = indices[vertex] * 3;
    reorderedDirections.set(
      directions.subarray(sourceOffset, sourceOffset + 3),
      vertex * 3,
    );
  }

  const subset = generateTerrain(123, reorderedDirections);
  for (let vertex = 0; vertex < indices.length; vertex += 1) {
    assert.equal(subset.heights[vertex], complete.heights[indices[vertex]]);
    assert.deepEqual(
      subset.positions.slice(vertex * 3, vertex * 3 + 3),
      complete.positions.slice(indices[vertex] * 3, indices[vertex] * 3 + 3),
    );
  }
});

test('generation never uses ambient randomness and returned arrays have separate ownership', () => {
  const directions = makeSphereDirections(12);
  const ambientRandom = Math.random;
  let first;
  let second;

  try {
    Math.random = () => {
      throw new Error('Ambient random must not be sampled.');
    };
    first = generateTerrain(0, directions);
    second = generateTerrain(0, directions);
  } finally {
    Math.random = ambientRandom;
  }

  first.positions[0] = 999;
  first.heights[0] = 999;
  assert.notEqual(second.positions[0], 999);
  assert.notEqual(second.heights[0], 999);
});

test('independent seeded streams and noise fields retain their own sequences', () => {
  const firstStream = createSeededRandom(123, 0x434f4e54);
  const repeatedStream = createSeededRandom(123, 0x434f4e54);
  const unrelatedStream = createSeededRandom(123, 0x4d4f554e);
  const unrelatedValues = [];
  const firstValues = [];

  for (let index = 0; index < 32; index += 1) {
    const value = firstStream();
    firstValues.push(value);
    assert.ok(value >= 0 && value < 1);
    unrelatedValues.push(unrelatedStream());
    assert.equal(value, repeatedStream());
  }

  assert.notDeepEqual(firstValues, unrelatedValues);
  const fields = createNoiseFields(123);
  const repeatedFields = createNoiseFields(123);
  const continentSample = fields.continents.noise3d(0.25, 0.5, 0.75);
  fields.mountains.noise3d(7, 8, 9);
  fields.detail.noise3d(-4, -5, -6);
  assert.equal(continentSample, repeatedFields.continents.noise3d(0.25, 0.5, 0.75));
  assert.notEqual(continentSample, fields.mountains.noise3d(0.25, 0.5, 0.75));
});

test('fBm normalizes by fixed octave weights and bounds its source noise', () => {
  const settings = {
    frequency: 1,
    octaves: 3,
    lacunarity: 2,
    persistence: 0.5,
    offset: [0, 0, 0],
  };
  const constantNoise = { noise3d: () => 0.4 };
  assertNear(sampleFractalNoise(constantNoise, 1, 0, 0, settings), 0.4);
  assert.equal(sampleFractalNoise({ noise3d: () => 10 }, 1, 0, 0, settings), 1);
  assert.equal(sampleFractalNoise({ noise3d: () => -10 }, 1, 0, 0, settings), -1);
});

test('invalid seeds and malformed source directions fail clearly', () => {
  const directions = new Float64Array([1, 0, 0]);
  for (const seed of [-1, 4294967296, 0.5, NaN, Infinity, '123', null]) {
    assert.throws(() => generateTerrain(seed, directions), RangeError);
  }
  assert.throws(() => generateTerrain(0, [1, 0, 0]), TypeError);
  assert.throws(() => generateTerrain(0, new Float64Array()), RangeError);
  assert.throws(() => generateTerrain(0, new Float64Array([1, 0])), RangeError);
  for (const invalid of [
    [0, 0, 0],
    [2, 0, 0],
    [NaN, 0, 1],
    [Infinity, 0, 0],
  ]) {
    assert.throws(() => generateTerrain(0, new Float64Array(invalid)), RangeError);
  }
});
