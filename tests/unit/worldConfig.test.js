import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorld,
  getDefaultSettings,
  resetSettings,
  changePreset,
  validateWorld,
} from '../../src/world/worldConfig.js';
import { WORLD_RECIPE, SETTING_KEYS, PALETTE_KEYS } from '../../src/world/recipe.js';
import { sampleTerrainHeights } from '../../src/world/generator.js';

const presets = ['earthlike', 'frozen', 'alien'];
const seeds = Array.from(
  { length: 30 },
  (_, index) => Math.imul(index, 2654435761) >>> 0,
);
const clone = (value) => JSON.parse(JSON.stringify(value));

test('30 seeds across all presets repeat across cache eviction and interleaving', () => {
  const snapshots = [];
  for (const seed of seeds) {
    for (const preset of presets) {
      const world = createWorld(seed, preset);
      const ranges = WORLD_RECIPE.defaults[preset];
      assert.equal(world.seed, seed);
      assert.equal(world.preset, preset);
      assert.equal(world.generatorVersion, 1);
      assert.deepEqual(world.recipe, WORLD_RECIPE);
      assert.deepEqual(Object.keys(world.settings), SETTING_KEYS);
      assert.deepEqual(Object.keys(world.palette), PALETTE_KEYS);
      for (const key of SETTING_KEYS.slice(1)) {
        assert.ok(
          world.settings[key] >= ranges[key][0] && world.settings[key] <= ranges[key][1],
          `${seed}/${preset}/${key}`,
        );
      }
      assert.ok(Number.isInteger(world.settings.sea));
      assert.ok(world.settings.sea >= 0 && world.settings.sea <= 100);
      snapshots.push(world);
    }
  }
  for (let index = 0; index < 140; index += 1) createWorld(index + 1000, 'alien');
  sampleTerrainHeights(
    123,
    { mountains: 100, continents: 0, roughness: 100 },
    new Float64Array([1, 0, 0, 0, 1, 0]),
  );
  for (const world of snapshots.reverse()) {
    assert.deepEqual(createWorld(world.seed, world.preset), world);
    assert.deepEqual(getDefaultSettings(world), world.settings);
  }
});

test('returned worlds and defaults are independent mutable snapshots', () => {
  const world = createWorld(42);
  const expected = clone(world);
  const defaults = getDefaultSettings(world);
  defaults.sea = 100;
  assert.deepEqual(world, expected);
  world.settings.temperature = 0;
  world.palette.ocean = '#123aBc';
  world.recipe.continents.offset[0] = 999;
  assert.deepEqual(createWorld(42), expected);
  assert.ok(Object.isFrozen(WORLD_RECIPE.continents.offset));
});

test('reset restores only seed/preset defaults while retaining an imported palette', () => {
  const original = createWorld(0xffffffff, 'frozen');
  const edited = clone(original);
  for (const key of SETTING_KEYS) edited.settings[key] = 100;
  edited.palette.ocean = '#123aBc';
  const snapshot = clone(edited);
  assert.deepEqual(getDefaultSettings(edited), original.settings);
  assert.deepEqual(edited, snapshot);
  const reset = resetSettings(edited);
  assert.equal(reset.seed, original.seed);
  assert.equal(reset.preset, original.preset);
  assert.deepEqual(reset.settings, original.settings);
  assert.deepEqual(reset.palette, edited.palette);
  assert.deepEqual(reset.recipe, edited.recipe);
  assert.deepEqual(edited, snapshot);
  assert.notEqual(reset.palette, edited.palette);
});

test('preset changes preserve seed, apply authored defaults/palette, and same-preset is an identity no-op', () => {
  const world = createWorld(456);
  world.settings.sea = 100;
  world.palette.snow = '#112233';
  assert.equal(changePreset(world, 'earthlike'), world);
  for (const preset of ['frozen', 'alien']) {
    const changed = changePreset(world, preset);
    assert.deepEqual(changed, createWorld(world.seed, preset));
    assert.equal(world.settings.sea, 100);
    assert.equal(world.palette.snow, '#112233');
  }
});

test('manual setting endpoints are valid without default balancing', () => {
  for (const endpoint of [0, 100]) {
    const world = createWorld(1, 'alien');
    for (const key of SETTING_KEYS) world.settings[key] = endpoint;
    assert.deepEqual(validateWorld(world), world);
  }
});

test('full schema validation rejects unsupported values, keys, recipes and malformed arrays', () => {
  const mutations = [
    (world) => {
      world.seed = -1;
    },
    (world) => {
      world.seed = 0x100000000;
    },
    (world) => {
      world.seed = '123';
    },
    (world) => {
      world.formatVersion = 2;
    },
    (world) => {
      world.generatorVersion = 0;
    },
    (world) => {
      world.preset = 'Earthlike';
    },
    (world) => {
      world.preset = { toString: () => 'earthlike' };
    },
    (world) => {
      world.extra = true;
    },
    (world) => {
      delete world.settings.sea;
    },
    (world) => {
      world.settings.extra = 1;
    },
    (world) => {
      world.settings.sea = NaN;
    },
    (world) => {
      world.settings.sea = Infinity;
    },
    (world) => {
      world.settings.sea = 50.5;
    },
    (world) => {
      world.settings.sea = 101;
    },
    (world) => {
      world.palette.snow = '#fff';
    },
    (world) => {
      world.palette.snow = '#123456\n';
    },
    (world) => {
      world.palette.extra = '#ffffff';
    },
    (world) => {
      world.recipe.defaults.revision = 2;
    },
    (world) => {
      world.recipe.climate.snowF = 31;
    },
    (world) => {
      world.recipe.continents.offset.push(1);
    },
    (world) => {
      world.recipe.continents.offset = { 0: 12.37, 1: -4.91, 2: 7.63 };
    },
    (world) => {
      world.recipe.continents.offset[0] = [12.37];
    },
    (world) => {
      world.recipe.radius.other = 1;
    },
    (world) => {
      world.recipe.color = null;
    },
    (world) => {
      world[Symbol('extra')] = 1;
    },
    (world) => {
      Object.defineProperty(world, 'seed', { get: () => 1 });
    },
  ];
  for (const mutate of mutations) {
    const candidate = createWorld(123);
    mutate(candidate);
    assert.throws(() => validateWorld(candidate), undefined, String(mutate));
  }
  for (const invalid of [null, [], 1, undefined])
    assert.throws(() => validateWorld(invalid));
  for (const seed of [-1, 1.5, Infinity, '1', 0x100000000])
    assert.throws(() => createWorld(seed));
  assert.throws(() => createWorld(1, '__proto__'));
  assert.throws(() => changePreset(createWorld(1), 'invalid'));
});

test('validation returns fresh canonical nested objects in deterministic order', () => {
  const source = createWorld(42, 'alien');
  source.palette.forest = '#abcdef';
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  const actual = validateWorld(reordered);
  assert.deepEqual(actual, source);
  assert.deepEqual(Object.keys(actual), [
    'formatVersion',
    'generatorVersion',
    'seed',
    'preset',
    'settings',
    'palette',
    'recipe',
  ]);
  assert.notEqual(actual, source);
  assert.notEqual(actual.settings, source.settings);
  assert.notEqual(
    actual.recipe.defaults.alien.mountains,
    source.recipe.defaults.alien.mountains,
  );
});

test('default sea coverage stays near the authored target ranges with slider quantization', () => {
  // An independently phased and denser sphere sample checks approximate coverage;
  // integer sea steps are 0.0034 radii, so allow 8 percentage points of slack.
  const count = 4096;
  const directions = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = (index + 0.25) * Math.PI * (3 - Math.sqrt(5));
    directions[index * 3] = radius * Math.cos(angle);
    directions[index * 3 + 1] = y;
    directions[index * 3 + 2] = radius * Math.sin(angle);
  }
  for (const seed of seeds) {
    for (const preset of presets) {
      const world = createWorld(seed, preset);
      const heights = sampleTerrainHeights(
        seed,
        world.settings,
        directions,
        WORLD_RECIPE,
      );
      const seaRadius =
        WORLD_RECIPE.radius.seaMin +
        (world.settings.sea / 100) *
          (WORLD_RECIPE.radius.seaMax - WORLD_RECIPE.radius.seaMin);
      const coverage =
        (100 * heights.filter((height) => height < seaRadius).length) / count;
      const [minimum, maximum] = WORLD_RECIPE.defaults[preset].ocean;
      assert.ok(
        coverage >= minimum - 8 && coverage <= maximum + 8,
        `${seed}/${preset}: ${coverage}% outside target ${minimum}–${maximum}% plus quantization tolerance`,
      );
    }
  }
});

test('only the current prerelease generator version is accepted by world actions', () => {
  assert.equal(createWorld(42).generatorVersion, 1);
  assert.deepEqual(createWorld(42).recipe, WORLD_RECIPE);
  for (const generatorVersion of [0, 2, 3, -1, 1.5, '1', null, Infinity, NaN]) {
    const world = createWorld(42);
    world.generatorVersion = generatorVersion;
    assert.throws(() => validateWorld(world), /version/);
    assert.throws(() => getDefaultSettings(world), /version/);
    assert.throws(() => resetSettings(world), /version/);
    assert.throws(() => changePreset(world, 'frozen'), /version/);
  }
});
