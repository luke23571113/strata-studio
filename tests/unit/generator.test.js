import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  BIOMES,
  classifyBiome,
  localHumidity,
  localTemperature,
  srgbToLinear,
} from '../../src/world/climate.js';
import { createWorldGenerator, sampleTerrainHeights } from '../../src/world/generator.js';
import { PALETTE_KEYS } from '../../src/world/recipe.js';
import { PREVIOUS_RECIPE as WORLD_RECIPE } from '../fixtures/previousRecipe.js';
import { createTerrainTopology } from '../../src/world/terrainMesh.js';

const SEEDS = [
  0, 1, 2, 3, 7, 11, 42, 99, 123, 256, 512, 1024, 2026, 4096, 65535, 65536, 99991, 100000,
  123456, 987654, 1234567, 8675309, 12345678, 123456789, 987654321, 2147483647,
  2147483648, 3000000000, 4000000000, 4294967295,
];
const PALETTE = {
  ocean: '#197c9b',
  beach: '#e7cf8e',
  grassland: '#74a555',
  forest: '#315a37',
  desert: '#c5a16b',
  rock: '#7e8188',
  snow: '#f3f5f6',
};
const SETTINGS = [
  {
    sea: 40,
    mountains: 45,
    continents: 60,
    roughness: 30,
    temperature: 78,
    humidity: 55,
  },
  {
    sea: 37,
    mountains: 35,
    continents: 50,
    roughness: 20,
    temperature: 18,
    humidity: 50,
  },
  {
    sea: 42,
    mountains: 65,
    continents: 35,
    roughness: 60,
    temperature: 88,
    humidity: 25,
  },
];
const V1_FIXTURES = new Map([
  [
    0,
    {
      positions: '11ceb9dee54629bcd5f7fcddbb2d921e0255b461459a930867ecae7f67a566ac',
      heights: '545dc3ae13c297ee95f8d4aadc6cf7abd707de3662648475cbf5578a6e8425c1',
      colors: '47c4ee9ad7a2fb690da10a5b959714cf0d88686dd420c942adad35165fae4b66',
      biomes: '7be6ef61d823b3d18b78585b2c54343a1e28de259e3b29c89b02a6c60423c3d2',
    },
  ],
  [
    123,
    {
      positions: 'a6c3997f0aa5fa2dc7f1c994368a62e3a5ff282fb80501fad39162a871f58366',
      heights: '6b7c081d069d73e56a29326fbe8e36835c37a7340bd59080d2f82f10d3a4aa49',
      colors: 'e70774080d8c6c6d7c6c3f36b50c735b68c44da01b6a233fd5e47a6f00474be0',
      biomes: 'fd706dd425e460c648dcec1c539d2b807cfeb12ad576ee7481fc47541fa3b4f8',
    },
  ],
  [
    4294967295,
    {
      positions: '4f08db414f08ec2016a9509b596ea0a2c8a2a60fdfe49dd3888e6dd667016758',
      heights: 'f78b4e9e7d09fb6fc8bc86e781bc7845e23c360b17ad3583d5c9ff48a7bb789d',
      colors: 'bc34de5ab02361995ee614b695b7d0774354425b7830f72e044130d228a6c57b',
      biomes: 'df593d9961a1eefd0a75e641de3ed47504b1a9164ef04ab706eae276d654a26e',
    },
  ],
]);

function config(seed = 123, settings = SETTINGS[0], palette = PALETTE) {
  return {
    formatVersion: 1,
    generatorVersion: 1,
    seed,
    preset: 'earthlike',
    settings,
    palette,
    recipe: WORLD_RECIPE,
  };
}

function fingerprint(array) {
  return createHash('sha256')
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex');
}

function signature(result) {
  return {
    positions: fingerprint(result.positions),
    heights: fingerprint(result.heights),
    colors: fingerprint(result.colors),
    biomes: fingerprint(result.biomes),
    oceanRadius: result.oceanRadius,
    stats: structuredClone(result.stats),
  };
}

function smallTopology() {
  const inverse = 1 / Math.sqrt(3);
  return {
    directions: new Float64Array([
      inverse,
      inverse,
      inverse,
      -inverse,
      -inverse,
      inverse,
      -inverse,
      inverse,
      -inverse,
      inverse,
      -inverse,
      -inverse,
    ]),
    cornerIndices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  };
}

test('historical recipe repeats 30 seeds × three settings fixtures on canonical topology', (context) => {
  const topology = createTerrainTopology(31);
  context.after(() => topology.geometry.dispose());
  const { directions, cornerIndices } = topology;
  const sourceDirections = directions.slice();
  const sourceCorners = cornerIndices.slice();
  const generator = createWorldGenerator(directions, cornerIndices);
  const expected = new Map();
  const unique = new Set();
  for (const seed of SEEDS) {
    for (let fixture = 0; fixture < SETTINGS.length; fixture += 1) {
      const result = generator.update(config(seed, SETTINGS[fixture]));
      const digest = signature(result);
      if (fixture === 0 && V1_FIXTURES.has(seed)) {
        const { positions, heights, colors, biomes } = digest;
        assert.deepEqual({ positions, heights, colors, biomes }, V1_FIXTURES.get(seed));
      }
      expected.set(`${seed}/${fixture}`, digest);
      unique.add(digest.positions);
      assert.equal(result.positions.length, 10242 * 3);
      assert.equal(result.colors.length, 20480 * 9);
      assert.equal(result.biomes.length, 20480);
      assert.ok(result.geometryChanged);
      assert.equal(
        Object.values(result.stats.biomeCounts).reduce((sum, count) => sum + count, 0),
        20480,
      );
      let landCount = 0,
        min = Infinity,
        max = -Infinity;
      for (let vertex = 0; vertex < result.heights.length; vertex += 1) {
        const radius = result.heights[vertex];
        assert.ok(
          Number.isFinite(radius) && radius >= 0.88 - 1e-6 && radius <= 1.18 + 1e-6,
        );
        min = Math.min(min, radius);
        max = Math.max(max, radius);
        if (radius > result.oceanRadius) landCount += 1;
        for (let axis = 0; axis < 3; axis += 1) {
          const offset = vertex * 3 + axis;
          assert.equal(
            result.positions[offset],
            Math.fround(directions[offset] * radius),
          );
        }
      }
      assert.equal(result.stats.minRadius, min);
      assert.equal(result.stats.maxRadius, max);
      assert.equal(result.stats.landFraction, landCount / result.heights.length);
      for (let face = 0; face < result.biomes.length; face += 1) {
        const offset = face * 9;
        assert.deepEqual(
          result.colors.subarray(offset, offset + 3),
          result.colors.subarray(offset + 3, offset + 6),
        );
        assert.deepEqual(
          result.colors.subarray(offset, offset + 3),
          result.colors.subarray(offset + 6, offset + 9),
        );
        for (let channel = 0; channel < 3; channel += 1) {
          assert.ok(
            Number.isFinite(result.colors[offset + channel]) &&
              result.colors[offset + channel] >= 0 &&
              result.colors[offset + channel] <= 1,
          );
        }
        const hasExposedCorner = [0, 1, 2].some(
          (corner) =>
            Math.round(
              (result.heights[cornerIndices[face * 3 + corner]] - result.oceanRadius) *
                WORLD_RECIPE.climate.geometryPrecision,
            ) > 0,
        );
        assert.equal(result.biomes[face] === BIOMES.ocean, !hasExposedCorner);
      }
    }
  }
  assert.equal(unique.size, SEEDS.length * SETTINGS.length);
  const independent = createWorldGenerator(directions, cornerIndices);
  for (const seed of [...SEEDS].reverse()) {
    for (let fixture = SETTINGS.length - 1; fixture >= 0; fixture -= 1) {
      // Interleave two independent instances and return to each fixture.
      generator.update(config((seed ^ 0xa5a5a5a5) >>> 0, SETTINGS[(fixture + 1) % 3]));
      const actual = independent.update(config(seed, SETTINGS[fixture]));
      assert.deepEqual(signature(actual), expected.get(`${seed}/${fixture}`));
      assert.deepEqual(
        signature(generator.update(config(seed, SETTINGS[fixture]))),
        expected.get(`${seed}/${fixture}`),
      );
    }
  }
  assert.deepEqual(directions, sourceDirections);
  assert.deepEqual(cornerIndices, sourceCorners);
});

test('height sampler agrees with generator and is independent of direction order and unrelated settings', () => {
  const { directions, cornerIndices } = smallTopology();
  const settings = SETTINGS[0];
  const expected = sampleTerrainHeights(123, settings, directions, WORLD_RECIPE);
  assert.deepEqual(
    createWorldGenerator(directions, cornerIndices).update(config()).heights,
    expected,
  );
  const reordered = new Float64Array([
    ...directions.slice(9, 12),
    ...directions.slice(0, 3),
    ...directions.slice(9, 12),
  ]);
  const samples = sampleTerrainHeights(
    123,
    {
      mountains: settings.mountains,
      continents: settings.continents,
      roughness: settings.roughness,
    },
    reordered,
    WORLD_RECIPE,
  );
  assert.deepEqual([...samples], [expected[3], expected[0], expected[3]]);
  assert.deepEqual(
    sampleTerrainHeights(
      123,
      { ...settings, sea: 100, temperature: 0, humidity: 100 },
      directions,
      WORLD_RECIPE,
    ),
    expected,
  );
});

test('cache dependency paths match fresh instances, including continent-mask changes', () => {
  const topology = smallTopology();
  const cached = createWorldGenerator(topology.directions, topology.cornerIndices);
  const edits = [
    {},
    { continents: 0 },
    { mountains: 100 },
    { roughness: 100 },
    { continents: 100 },
    { mountains: 0 },
    { roughness: 0 },
    { continents: 45, mountains: 72, roughness: 83 },
    { sea: 100 },
    { humidity: 100 },
    { temperature: 0 },
    {},
  ];
  for (const changes of edits) {
    const current = config(123, { ...SETTINGS[0], ...changes });
    const fresh = createWorldGenerator(
      topology.directions,
      topology.cornerIndices,
    ).update(current);
    assert.deepEqual(signature(cached.update(current)), signature(fresh));
  }
});

test('sea, temperature, humidity, palette and preset changes preserve geometry bit for bit', () => {
  const topology = smallTopology();
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  const initial = generator.update(config());
  const positions = initial.positions.slice(),
    heights = initial.heights.slice();
  const positionsBuffer = initial.positions,
    heightsBuffer = initial.heights,
    colorsBuffer = initial.colors;
  const edits = [
    config(123, { ...SETTINGS[0], sea: 0 }),
    config(123, { ...SETTINGS[0], sea: 100 }),
    config(123, { ...SETTINGS[0], temperature: 0 }),
    config(123, { ...SETTINGS[0], humidity: 100 }),
    config(123, SETTINGS[0], { ...PALETTE, grassland: '#112233' }),
    { ...config(), preset: 'alien' },
  ];
  for (const edit of edits) {
    const updated = generator.update(edit);
    assert.equal(updated, initial);
    assert.equal(updated.geometryChanged, false);
    assert.equal(updated.positions, positionsBuffer);
    assert.equal(updated.heights, heightsBuffer);
    assert.equal(updated.colors, colorsBuffer);
    assert.deepEqual(updated.positions, positions);
    assert.deepEqual(updated.heights, heights);
  }
  assert.equal(generator.update(config(124)).geometryChanged, true);
});

test('manual endpoints stay finite and permit entirely dry and entirely ocean worlds', (context) => {
  const topology = createTerrainTopology(31);
  context.after(() => topology.geometry.dispose());
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  for (const extreme of [0, 100]) {
    for (const sea of [0, 100]) {
      const result = generator.update(
        config(
          4294967295,
          Object.fromEntries(
            Object.keys(SETTINGS[0]).map((key) => [key, key === 'sea' ? sea : extreme]),
          ),
        ),
      );
      assert.equal(result.oceanRadius, sea === 0 ? 0.86 : 1.2);
      assert.equal(result.stats.landFraction, sea === 0 ? 1 : 0);
      assert.equal(result.stats.biomeCounts.ocean, sea === 0 ? 0 : 20480);
      for (const radius of result.heights)
        assert.ok(
          Number.isFinite(radius) && radius >= 0.88 - 1e-6 && radius <= 1.18 + 1e-6,
        );
      for (const color of result.colors)
        assert.ok(Number.isFinite(color) && color >= 0 && color <= 1);
      if (sea === 0 && extreme === 0) assert.equal(result.stats.biomeCounts.snow, 20480);
    }
  }
});

test('climate equations preserve humidity endpoints and monotonicity with seeded regional variation', () => {
  for (const noise of [-1, -0.6, 0, 0.6, 1]) {
    assert.equal(localHumidity(0, noise), 0);
    assert.equal(localHumidity(100, noise), 100);
    let previous = -1;
    for (let baseline = 0; baseline <= 100; baseline += 1) {
      const actual = localHumidity(baseline, noise);
      assert.ok(actual >= previous && actual >= 0 && actual <= 100);
      previous = actual;
    }
  }
  assert.equal(localHumidity(50, -1), 25);
  assert.equal(localHumidity(50, 1), 75);
  assert.equal(localTemperature(80, 0, 0), 80);
  assert.equal(localTemperature(80, 1, 0), 20);
  assert.equal(localTemperature(80, -1, 0), 20);
  assert.equal(localTemperature(80, 0.5, 0.1), 51.25);
  assert.equal(localTemperature(0, 1, 0.18), -105);
  assert.equal(localTemperature(80, 0, -0.1), 80);
});

test('biome precedence and quantized boundaries are explicit, including exposed crossing faces', () => {
  const base = {
    radius: 1.03,
    maxRadius: 1.04,
    oceanRadius: 1,
    slopeCos: 1,
    temperature: 50,
    humidity: 45,
  };
  const biome = (overrides) => classifyBiome({ ...base, ...overrides });
  assert.equal(biome({ maxRadius: 1, temperature: -100 }), BIOMES.ocean);
  assert.equal(biome({ radius: 0.99, maxRadius: 1.0000004 }), BIOMES.ocean);
  assert.equal(biome({ radius: 0.99, maxRadius: 1.0000006 }), BIOMES.beach);
  assert.equal(biome({ radius: 0.99, temperature: 32 }), BIOMES.snow);
  assert.equal(biome({ radius: 1.1, slopeCos: 0, temperature: 32 }), BIOMES.snow);
  assert.equal(biome({ temperature: 32.0004 }), BIOMES.snow);
  assert.equal(biome({ temperature: 32.0006 }), BIOMES.grassland);
  assert.equal(biome({ radius: 1.006 }), BIOMES.beach);
  assert.equal(biome({ radius: 1.0060004 }), BIOMES.beach);
  assert.equal(biome({ radius: 1.0060006 }), BIOMES.grassland);
  assert.equal(biome({ radius: 1.06, temperature: 90, humidity: 0 }), BIOMES.rock);
  assert.equal(biome({ radius: 1.0599994 }), BIOMES.grassland);
  assert.equal(biome({ slopeCos: 0.707107 }), BIOMES.grassland);
  assert.equal(biome({ slopeCos: 0.7071064 }), BIOMES.rock);
  assert.equal(biome({ temperature: 70, humidity: 29.999 }), BIOMES.desert);
  assert.equal(biome({ temperature: 70, humidity: 30 }), BIOMES.grassland);
  assert.equal(biome({ temperature: 69.9994, humidity: 0 }), BIOMES.grassland);
  assert.equal(biome({ humidity: 60 }), BIOMES.forest);
  assert.equal(biome({ humidity: 59.9994 }), BIOMES.grassland);
  assert.equal(
    biome({ radius: 1.006, slopeCos: 0, temperature: 90, humidity: 0 }),
    BIOMES.beach,
  );
});

test('vertex colors are linear sRGB with one stable brightness value per face', () => {
  const topology = smallTopology();
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  const monochrome = Object.fromEntries(PALETTE_KEYS.map((key) => [key, '#808080']));
  const linearGray = srgbToLinear(128 / 255);
  assert.ok(Math.abs(linearGray - 0.21586050011389926) < 1e-12);
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.equal(srgbToLinear(0.04), 0.04 / 12.92);
  const initial = generator.update(config(123, SETTINGS[0], monochrome)).colors.slice();
  for (const color of initial)
    assert.ok(color >= linearGray * 0.96 - 1e-7 && color <= linearGray * 1.04 + 1e-7);
  const changed = generator.update(
    config(
      123,
      { ...SETTINGS[0], sea: 100, temperature: 100, humidity: 0, mountains: 100 },
      monochrome,
    ),
  );
  assert.deepEqual(changed.colors, initial);
  assert.notDeepEqual(
    generator.update(config(124, SETTINGS[0], monochrome)).colors,
    initial,
  );
});

test('generation never consumes ambient entropy and outputs belong to each generator', () => {
  const topology = smallTopology();
  const original = Math.random;
  try {
    Math.random = () => {
      throw new Error('Ambient random must never be used.');
    };
    const first = createWorldGenerator(
      topology.directions,
      topology.cornerIndices,
    ).update(config());
    const second = createWorldGenerator(
      topology.directions,
      topology.cornerIndices,
    ).update(config());
    assert.deepEqual(signature(first), signature(second));
    first.positions[0] = 999;
    first.heights[0] = 999;
    first.colors[0] = 999;
    assert.notEqual(second.positions[0], 999);
    assert.notEqual(second.heights[0], 999);
    assert.notEqual(second.colors[0], 999);
  } finally {
    Math.random = original;
  }
});

test('malformed sampling inputs and configuration fail clearly', () => {
  const topology = smallTopology();
  for (const seed of [-1, 4294967296, 0.5, NaN, Infinity, '123', null]) {
    assert.throws(
      () => sampleTerrainHeights(seed, SETTINGS[0], topology.directions),
      RangeError,
    );
  }
  assert.throws(() => sampleTerrainHeights(1, SETTINGS[0], [1, 0, 0]), TypeError);
  for (const directions of [
    [],
    [1, 0],
    [0, 0, 0],
    [2, 0, 0],
    [NaN, 0, 1],
    [Infinity, 0, 0],
  ]) {
    assert.throws(
      () => sampleTerrainHeights(1, SETTINGS[0], new Float64Array(directions)),
      RangeError,
    );
  }
  assert.throws(() => createWorldGenerator(topology.directions, [0, 1, 2]), TypeError);
  for (const corners of [[], [0, 1], [0, 1, 8]]) {
    assert.throws(
      () => createWorldGenerator(topology.directions, new Uint32Array(corners)),
      RangeError,
    );
  }
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  for (const value of [-1, 101, 0.5, NaN, Infinity, '1', null]) {
    assert.throws(
      () => generator.update(config(1, { ...SETTINGS[0], mountains: value })),
      RangeError,
    );
  }
  assert.throws(
    () => generator.update(config(1, SETTINGS[0], { ...PALETTE, rock: '#abc' })),
    TypeError,
  );
});
