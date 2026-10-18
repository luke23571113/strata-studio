import * as THREE from 'three';
import { WORLD_RECIPE } from './recipe.js';

export function createTerrainTopology(detail = WORLD_RECIPE.topology.detail) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const source = geometry.getAttribute('position');
  const directions = [];
  const cornerIndices = new Uint32Array(source.count);
  const sharedVertices = new Map();

  for (let corner = 0; corner < source.count; corner++) {
    const x = source.getX(corner);
    const y = source.getY(corner);
    const z = source.getZ(corner);
    // The key joins shared corners; the sampled direction keeps its full precision.
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let vertex = sharedVertices.get(key);

    if (vertex === undefined) {
      vertex = directions.length / 3;
      const length = Math.hypot(x, y, z);
      directions.push(x / length, y / length, z / length);
      sharedVertices.set(key, vertex);
    }

    cornerIndices[corner] = vertex;
  }

  geometry.deleteAttribute('uv');
  return { geometry, directions: new Float64Array(directions), cornerIndices };
}

export function applyTerrainPositions(topology, positions) {
  const attribute = topology.geometry.getAttribute('position');

  for (let corner = 0; corner < topology.cornerIndices.length; corner++) {
    const sourceOffset = topology.cornerIndices[corner] * 3;
    attribute.setXYZ(
      corner,
      positions[sourceOffset],
      positions[sourceOffset + 1],
      positions[sourceOffset + 2],
    );
  }

  attribute.needsUpdate = true;
  topology.geometry.computeVertexNormals();
  topology.geometry.computeBoundingBox();
  topology.geometry.computeBoundingSphere();
}

export function fingerprintTerrain(positions) {
  const bytes = new Uint8Array(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  );
  let hash = 2166136261;

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
