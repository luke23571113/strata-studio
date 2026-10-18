import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTerrainTopology,
  applyTerrainPositions,
} from '../../src/world/terrainMesh.js';
import { createWorldGenerator, sampleTerrainHeights } from '../../src/world/generator.js';
import { WORLD_RECIPE } from '../../src/world/recipe.js';
import { createWorld } from '../../src/world/worldConfig.js';

test('refined mesh is approximately twice as dense, closed and seam-free after displacement', () => {
  const topology = createTerrainTopology(WORLD_RECIPE.topology.detail);
  assert.equal(topology.directions.length / 3, 20252);
  assert.equal(topology.cornerIndices.length / 3, 40500);
  const edges = new Map();
  for (let index = 0; index < topology.cornerIndices.length; index += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = topology.cornerIndices[index + edge];
      const b = topology.cornerIndices[index + ((edge + 1) % 3)];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) assert.equal(count, 2);
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  const terrain = generator.update(createWorld(123));
  applyTerrainPositions(topology, terrain.positions);
  const positions = topology.geometry.getAttribute('position');
  const normals = topology.geometry.getAttribute('normal');
  for (let corner = 0; corner < topology.cornerIndices.length; corner++) {
    const vertex = topology.cornerIndices[corner] * 3;
    for (let axis = 0; axis < 3; axis++) {
      assert.equal(positions.array[corner * 3 + axis], terrain.positions[vertex + axis]);
      assert.equal(
        normals.array[corner * 3 + axis],
        normals.array[(corner - (corner % 3)) * 3 + axis],
      );
    }
    assert.ok(
      Math.abs(Math.hypot(...normals.array.slice(corner * 3, corner * 3 + 3)) - 1) < 1e-6,
    );
  }
  topology.geometry.dispose();
});

test('half relief scales only the mountain contribution, independently of continents and roughness', () => {
  const topology = createTerrainTopology(8);
  const settings = { ...createWorld(123).settings, mountains: 50, roughness: 0 };
  const base = sampleTerrainHeights(
    123,
    { ...settings, mountains: 0 },
    topology.directions,
  );
  const half = sampleTerrainHeights(123, settings, topology.directions);
  const full = sampleTerrainHeights(123, settings, topology.directions, {
    ...WORLD_RECIPE,
    mountains: { ...WORLD_RECIPE.mountains, amplitudeMax: 0.1 },
  });
  let raised = 0;
  for (let index = 0; index < base.length; index++) {
    assert.ok(
      Math.abs((half[index] - base[index]) * 2 - (full[index] - base[index])) < 3e-7,
    );
    if (full[index] - base[index] > 0.001) raised++;
  }
  assert.ok(raised > 20);
  topology.geometry.dispose();
});

test('refined controls retain finite extremes, complete ocean/dry worlds and climate-only cache behavior', () => {
  const topology = createTerrainTopology(WORLD_RECIPE.topology.detail);
  const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
  for (const seed of [0, 123, 4294967295]) {
    for (const preset of ['earthlike', 'frozen', 'alien']) {
      const world = createWorld(seed, preset);
      for (const endpoint of [0, 100]) {
        const config = {
          ...world,
          settings: {
            ...world.settings,
            continents: endpoint,
            mountains: endpoint,
            roughness: endpoint,
            sea: endpoint,
          },
        };
        const result = generator.update(config);
        assert.equal(result.stats.landFraction, endpoint === 0 ? 1 : 0);
        assert.ok(result.positions.every(Number.isFinite));
        assert.ok(result.colors.every(Number.isFinite));
        const geometry = result.positions.slice();
        const climate = generator.update({
          ...config,
          settings: {
            ...config.settings,
            temperature: 100 - endpoint,
            humidity: endpoint,
          },
        });
        assert.equal(climate.geometryChanged, false);
        assert.deepEqual(climate.positions, geometry);
      }
    }
  }
  topology.geometry.dispose();
});
