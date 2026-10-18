import { createRandomSeed, parseWorldPath } from './seed.js';
import { createWorld } from './worldConfig.js';
import { decodeWorld } from './worldCode.js';

export function readSharedWorld(hash) {
  const parameters = new URLSearchParams(hash.slice(1));
  if (!parameters.has('world')) return null;
  if (hash.length > 16384) throw new Error('Share input exceeds the 16 KiB limit.');
  const codes = parameters.getAll('world');
  if (codes.length !== 1 || !codes[0]) {
    throw new Error('This share link must contain one world code in its fragment.');
  }
  return decodeWorld(codes[0]);
}

export function resolveDocumentWorld(pathname, hash = window.location.hash) {
  const route = parseWorldPath(pathname);
  if (route.type === 'invalid') return route;

  try {
    // A complete shared world takes precedence and never draws a random seed.
    const config =
      readSharedWorld(hash) ??
      createWorld(route.type === 'seeded' ? route.seed : createRandomSeed());
    return { ...route, seed: config.seed, config, revision: 0 };
  } catch (error) {
    return { type: 'invalid', message: error.message };
  }
}

export function generateNextWorld(currentWorld) {
  const seed = createRandomSeed(currentWorld.config.seed);
  const config = createWorld(seed, currentWorld.config.preset);
  const address = new URL(window.location.href);
  address.pathname = '/';
  const parameters = new URLSearchParams(address.hash.slice(1));
  if (parameters.has('world')) {
    parameters.delete('world');
    address.hash = parameters.toString();
  }
  window.history.replaceState(window.history.state, '', address);
  currentWorld.type = 'random';
  return config;
}

export function rememberWorld(currentWorld, config) {
  // Retain the whole requested world, including edits, through React remounts.
  currentWorld.config = config;
  currentWorld.seed = config.seed;
  currentWorld.revision += 1;
  return { config, revision: currentWorld.revision, requestedAt: performance.now() };
}
