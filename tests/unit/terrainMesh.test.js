import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain } from '../fixtures/initialTerrain.js';
import {
  applyTerrainPositions,
  createTerrainTopology,
} from '../../src/world/terrainMesh.js';

test('canonical sphere is closed, with two triangles per edge and shared source corners', () => {
  const topology = createTerrainTopology(31);
  assert.equal(topology.directions.length / 3, 10242);
  assert.equal(topology.cornerIndices.length / 3, 20480);
  const edges = new Map();

  for (let triangle = 0; triangle < topology.cornerIndices.length; triangle += 3) {
    const vertices = Array.from(topology.cornerIndices.slice(triangle, triangle + 3));
    for (let edge = 0; edge < 3; edge++) {
      const first = vertices[edge];
      const second = vertices[(edge + 1) % 3];
      const key = `${Math.min(first, second)}:${Math.max(first, second)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  assert.equal(edges.size, 30720);
  for (const count of edges.values()) {
    assert.equal(count, 2);
  }
  topology.geometry.dispose();
});

test('displacement leaves no cracks and updates flat normals and bounds', () => {
  const topology = createTerrainTopology(31);
  const source = topology.directions.slice();

  for (const seed of [0, 123, 4294967295]) {
    const terrain = generateTerrain(seed, topology.directions);
    applyTerrainPositions(topology, terrain.positions);
    const positions = topology.geometry.getAttribute('position');
    const normals = topology.geometry.getAttribute('normal');

    for (let corner = 0; corner < topology.cornerIndices.length; corner++) {
      const offset = topology.cornerIndices[corner] * 3;
      assert.equal(positions.getX(corner), terrain.positions[offset]);
      assert.equal(positions.getY(corner), terrain.positions[offset + 1]);
      assert.equal(positions.getZ(corner), terrain.positions[offset + 2]);
      const length = Math.hypot(
        normals.getX(corner),
        normals.getY(corner),
        normals.getZ(corner),
      );
      assert.ok(Math.abs(length - 1) < 1e-6);
      const triangleStart = corner - (corner % 3);
      assert.equal(normals.getX(corner), normals.getX(triangleStart));
      assert.equal(normals.getY(corner), normals.getY(triangleStart));
      assert.equal(normals.getZ(corner), normals.getZ(triangleStart));
    }

    assert.deepEqual(topology.directions, source);
    assert.ok(topology.geometry.boundingSphere.radius > 1);
    assert.ok(topology.geometry.boundingSphere.radius < 1.3);
  }

  topology.geometry.dispose();
});
