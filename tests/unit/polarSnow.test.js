import test from 'node:test';
import assert from 'node:assert/strict';
import { snowCoverage } from '../../src/world/climate.js';
import { createWorldGenerator } from '../../src/world/generator.js';
import { createTerrainTopology } from '../../src/world/terrainMesh.js';
import { createWorld } from '../../src/world/worldConfig.js';

test('snow keeps both polar tips, varies through the transition and retreats as temperature rises', () => {
  for (const pole of [-1, 1]) assert.equal(snowCoverage(100, pole, 1), 1);
  assert.equal(snowCoverage(80, 0, -1), 0);
  assert.equal(snowCoverage(0, 0, 1), 1);
  assert.ok(snowCoverage(26, 0.85, -1) > snowCoverage(26, 0.85, 1));
  assert.ok(snowCoverage(26, 0.85, 0) > 0 && snowCoverage(26, 0.85, 0) < 1);
  for (const latitude of [0, 0.8, 0.97, 1]) {
    for (const noise of [-1, 0, 1]) {
      let previous = 1;
      for (let temperature = -20; temperature <= 100; temperature++) {
        const cover = snowCoverage(temperature, latitude, noise);
        assert.ok(cover >= 0 && cover <= previous);
        assert.equal(cover, snowCoverage(temperature, -latitude, noise));
        previous = cover;
      }
    }
  }
});

test('patchy snow changes colors without changing terrain and repeats after climate edits', () => {
  const topology = createTerrainTopology(12);
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  const world = createWorld(123);
  const initial = generator.update(world);
  const positions = initial.positions.slice();
  const colors = initial.colors.slice();
  const warmer = generator.update({
    ...world,
    settings: { ...world.settings, temperature: 100 },
  });
  assert.equal(warmer.geometryChanged, false);
  assert.deepEqual(warmer.positions, positions);
  assert.notDeepEqual(warmer.colors, colors);
  assert.deepEqual(generator.update(world).colors, colors);
  topology.geometry.dispose();
});
