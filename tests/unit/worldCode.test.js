import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIOUS_RECIPE } from '../fixtures/previousRecipe.js';
import { createWorld, resetSettings } from '../../src/world/worldConfig.js';
import { encodeWorld, decodeWorld, createWorldLink } from '../../src/world/worldCode.js';
import { SETTING_KEYS } from '../../src/world/recipe.js';

function rawCode(value) {
  return (
    'SS1.' +
    Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
      'base64url',
    )
  );
}

test('default, edited, extreme and custom-palette worlds round trip for all presets', () => {
  for (const preset of ['earthlike', 'frozen', 'alien']) {
    for (const seed of [0, 42, 0xffffffff]) {
      for (const mode of ['default', 'edited', 'minimum', 'maximum']) {
        const world = createWorld(seed, preset);
        if (mode !== 'default') {
          SETTING_KEYS.forEach((key, index) => {
            world.settings[key] =
              mode === 'minimum' ? 0 : mode === 'maximum' ? 100 : index * 17;
          });
          world.palette.ocean = '#01aBcD';
          world.palette.forest = '#C0ffee';
        }
        const encoded = encodeWorld(world);
        assert.ok(encoded.startsWith('SS1.'));
        assert.ok(encoded.length < 4096, `${preset}/${mode}: ${encoded.length} chars`);
        assert.deepEqual(decodeWorld(encoded), world);
        assert.equal(encodeWorld(decodeWorld(encoded)), encoded);
        assert.equal(
          resetSettings(decodeWorld(encoded)).palette.ocean,
          world.palette.ocean,
        );
      }
    }
  }
});

test('canonical encoding does not depend on source property insertion order', () => {
  const world = createWorld(47);
  const reversed = Object.fromEntries(Object.entries(world).reverse());
  reversed.settings = Object.fromEntries(Object.entries(world.settings).reverse());
  reversed.recipe = Object.fromEntries(Object.entries(world.recipe).reverse());
  assert.equal(encodeWorld(reversed), encodeWorld(world));
});

test('full HTTP(S) links decode locally and links always use the static root', () => {
  const world = createWorld(912, 'frozen');
  const code = encodeWorld(world);
  assert.equal(
    createWorldLink(world, 'https://example.com'),
    `https://example.com/#world=${code}`,
  );
  assert.equal(
    createWorldLink(world, 'http://localhost:5173/world/2?x=1#old'),
    `http://localhost:5173/#world=${code}`,
  );
  assert.deepEqual(
    decodeWorld(`https://example.com/other?ignored=1#unrelated=value&world=${code}`),
    world,
  );
  assert.deepEqual(decodeWorld(`  ${code}\n`), world);
  assert.throws(() => createWorldLink(world, 'file:///tmp/planet'));
  assert.throws(() => createWorldLink(world, 'example.com'));
});

test('malformed, truncated, noncanonical and unsupported code inputs fail clearly', () => {
  const good = encodeWorld(createWorld(1));
  const inputs = [
    '',
    'SS2.abc',
    'SS1.',
    'SS1.A',
    'SS1.AA=',
    'SS1.A+A',
    'SS1.A/A',
    'SS1.AB', // Nonzero discarded base64 bits, although atob accepts it.
    'SS1._w', // Invalid UTF-8 byte.
    'SS1.77u_e30', // UTF-8 BOM is not a JSON character.
    rawCode('{'),
    rawCode('null'),
    rawCode('[]'),
    rawCode('true'),
    good.slice(0, -11),
    `${good}#`,
    `${good}\nother`,
    'ftp://example.com/#world=' + good,
    'javascript:alert(1)',
    'https://example.com/#world=',
    'https://example.com/#world=' + good + '&world=' + good,
    'https://example.com/?world=' + good,
    'https://example.com/#world=SS2.abc',
    'https://example.com/#world=SS1.%FF',
  ];
  for (const input of inputs)
    assert.throws(() => decodeWorld(input), { name: 'Error' }, input.slice(0, 80));
  for (const input of [undefined, null, 123, {}]) assert.throws(() => decodeWorld(input));
});

test('codes enforce the complete schema and immutable supported recipe before import/export', () => {
  const mutations = [
    (world) => {
      world.formatVersion = 2;
    },
    (world) => {
      world.generatorVersion = 3;
    },
    (world) => {
      world.seed = -1;
    },
    (world) => {
      world.preset = 'unknown';
    },
    (world) => {
      world.settings.sea = 101;
    },
    (world) => {
      world.settings.sea = 0.1;
    },
    (world) => {
      delete world.palette.rock;
    },
    (world) => {
      world.palette.ocean = 'red';
    },
    (world) => {
      world.recipe.defaults.samples = 1024;
    },
    (world) => {
      world.recipe.continents.offset = [];
    },
    (world) => {
      world.recipe.continents.offset = [[[12.37]], -4.91, 7.63];
    },
    (world) => {
      world.recipe.defaults.alien.mountains.push(100);
    },
    (world) => {
      world.camera = { x: 1 };
    },
    (world) => {
      world.recipe.extra = 1;
    },
  ];
  for (const mutate of mutations) {
    const world = createWorld(1);
    mutate(world);
    assert.throws(() => decodeWorld(rawCode(world)));
    assert.throws(() => encodeWorld(world));
  }
  const pollution = JSON.stringify(createWorld(1)).replace(
    '"settings":{',
    '"settings":{"__proto__":{},',
  );
  assert.throws(() => decodeWorld(rawCode(pollution)));
  assert.equal(Object.prototype.polluted, undefined);
});

test('payload and full-input limits are enforced without truncation', () => {
  assert.throws(() => decodeWorld('SS1.' + 'A'.repeat(8193)), /8 KiB/);
  assert.throws(
    () => decodeWorld('https://example.com/#world=SS1.' + 'A'.repeat(8193)),
    /8 KiB/,
  );
  assert.throws(() => decodeWorld('https://example.com/' + 'a'.repeat(16384)), /16 KiB/);
  assert.throws(() => decodeWorld(' '.repeat(16385)), /16 KiB/);
  const code = encodeWorld(createWorld(0));
  assert.deepEqual(
    decodeWorld('https://example.com/?padding=' + 'a'.repeat(9000) + '#world=' + code),
    createWorld(0),
  );
});

test('oversized UTF-8 link text and deeply nested unsupported values are rejected', () => {
  assert.throws(() => decodeWorld('https://example.com/' + '界'.repeat(6000)), /16 KiB/);
  const deeplyNested = '{"recipe":' + '['.repeat(1000) + '0' + ']'.repeat(1000) + '}';
  assert.throws(() => decodeWorld(rawCode(deeplyNested)), /fields/);
});

test('old recipes are rejected rather than silently changing a saved world', () => {
  for (const preset of ['earthlike', 'frozen', 'alien']) {
    const historical = { ...createWorld(123, preset), recipe: PREVIOUS_RECIPE };
    assert.throws(() => decodeWorld(rawCode(historical)), /recipe/);
    assert.throws(() => encodeWorld(historical), /recipe/);
  }
});
