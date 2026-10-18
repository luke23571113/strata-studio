import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createWorldGenerator } from '../../src/world/generator.js';
import { createTerrainTopology } from '../../src/world/terrainMesh.js';
import { createWorld } from '../../src/world/worldConfig.js';
import { decodeWorld, encodeWorld } from '../../src/world/worldCode.js';
import { WORLD_RECIPE } from '../../src/world/recipe.js';

function signature(world) {
  const result = { oceanRadius: world.oceanRadius };
  for (const key of ['positions', 'heights', 'biomes', 'colors']) {
    const array = world[key];
    result[key] = createHash('sha256')
      .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
      .digest('hex');
  }
  return result;
}

test('30 seeds × three actual presets reproduce complete generated data through saved-world round trips', (context) => {
  const topology = createTerrainTopology(WORLD_RECIPE.topology.detail);
  context.after(() => topology.geometry.dispose());
  const original = createWorldGenerator(topology.directions, topology.cornerIndices);
  const restored = createWorldGenerator(topology.directions, topology.cornerIndices);
  const seeds = [0, 4294967295];
  for (let index = 1; index <= 28; index += 1) {
    seeds.push(Math.imul(index, 2654435761) >>> 0);
  }

  for (const seed of seeds) {
    for (const preset of ['earthlike', 'frozen', 'alien']) {
      const world = createWorld(seed, preset);
      const expected = signature(original.update(world));
      const imported = decodeWorld(encodeWorld(world));
      assert.deepEqual(imported, world);
      restored.update(createWorld((seed ^ 12345) >>> 0, 'frozen'));
      assert.deepEqual(signature(restored.update(imported)), expected);

      const edited = {
        ...world,
        settings: { ...world.settings, sea: 40, temperature: 88, humidity: 20 },
        palette: { ...world.palette, forest: '#225544' },
      };
      const savedEdit = decodeWorld(encodeWorld(edited));
      assert.deepEqual(savedEdit, edited);
      assert.deepEqual(
        signature(restored.update(savedEdit)),
        signature(original.update(edited)),
      );
    }
  }
});
