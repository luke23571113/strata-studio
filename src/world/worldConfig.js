import { createSeededRandom } from './random.js';
import { WORLD_RECIPE, SETTING_KEYS, PALETTE_KEYS } from './recipe.js';
import { sampleTerrainHeights } from './generator.js';

const PRESETS = {
  earthlike: [
    '#244F68',
    '#C5B384',
    '#789469',
    '#3C6554',
    '#B99862',
    '#777C7F',
    '#E7E8E0',
  ],
  frozen: ['#315D80', '#B8C9CF', '#9DAFB1', '#607E86', '#C3BDB0', '#8799A8', '#EDF4F6'],
  alien: ['#176D71', '#C3A6C9', '#9273B1', '#59466F', '#BC88A8', '#655A80', '#DED6EF'],
};
const WORLD_KEYS = [
  'formatVersion',
  'generatorVersion',
  'seed',
  'preset',
  'settings',
  'palette',
  'recipe',
];
const defaultCache = new Map();
const sampleDirections = new Float64Array(WORLD_RECIPE.defaults.samples * 3);
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

// Midpoints avoid either pole. Azimuth starts at zero and advances by the
// golden angle about y; this order is part of the current prerelease recipe.
for (let index = 0; index < WORLD_RECIPE.defaults.samples; index += 1) {
  const y = 1 - (2 * (index + 0.5)) / WORLD_RECIPE.defaults.samples;
  const radial = Math.sqrt(1 - y * y);
  sampleDirections[index * 3] = Math.cos(index * goldenAngle) * radial;
  sampleDirections[index * 3 + 1] = y;
  sampleDirections[index * 3 + 2] = Math.sin(index * goldenAngle) * radial;
}

function requireKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${label} has missing or unsupported fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label} has an invalid field.`);
    }
  }
}

function copySupportedRecipe(value, expected = WORLD_RECIPE, depth = 0) {
  if (depth > 12) throw new Error('World recipe is nested too deeply.');
  if (Array.isArray(expected)) {
    if (
      !Array.isArray(value) ||
      value.length !== expected.length ||
      Reflect.ownKeys(value).length !== expected.length + 1
    ) {
      throw new Error('Unsupported world recipe array.');
    }
    return expected.map((item, index) =>
      copySupportedRecipe(value[index], item, depth + 1),
    );
  }
  if (expected && typeof expected === 'object') {
    const keys = Object.keys(expected);
    requireKeys(value, keys, 'World recipe');
    const result = {};
    for (const key of keys)
      result[key] = copySupportedRecipe(value[key], expected[key], depth + 1);
    return result;
  }
  if (value !== expected)
    throw new Error(
      'Unsupported world recipe. This prerelease accepts only the current recipe.',
    );
  return expected;
}

function validateSeedAndPreset(seed, preset) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('A world seed must be a whole number from 0 to 4294967295.');
  }
  if (typeof preset !== 'string' || !Object.hasOwn(PRESETS, preset))
    throw new Error('Unsupported world preset.');
}

function copySettings(settings) {
  const result = {};
  for (const key of SETTING_KEYS) result[key] = settings[key];
  return result;
}

function authoredPalette(preset) {
  const result = {};
  PALETTE_KEYS.forEach((key, index) => {
    result[key] = PRESETS[preset][index];
  });
  return result;
}

function parameterRandom(seed, preset, parameter) {
  // FNV-1a over UTF-16 code units of `1:preset:parameter`, using imul after
  // each XOR. XOR the unsigned hash with defaults.salt before stream mixing.
  const name = `1:${preset}:${parameter}`;
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 16777619) >>> 0;
  }
  return createSeededRandom(seed, (hash ^ WORLD_RECIPE.defaults.salt) >>> 0)();
}

function resolveDefaults(seed, preset) {
  validateSeedAndPreset(seed, preset);
  const cacheKey = `${seed}:${preset}`;
  const cached = defaultCache.get(cacheKey);
  if (cached) return copySettings(cached);
  const ranges = WORLD_RECIPE.defaults[preset];
  const settings = { sea: 0 };
  for (const key of SETTING_KEYS.slice(1)) {
    const [minimum, maximum] = ranges[key];
    settings[key] =
      minimum + Math.floor(parameterRandom(seed, preset, key) * (maximum - minimum + 1));
  }
  const [oceanMin, oceanMax] = ranges.ocean;
  const target =
    (oceanMin + parameterRandom(seed, preset, 'ocean') * (oceanMax - oceanMin)) / 100;
  const heights = sampleTerrainHeights(seed, settings, sampleDirections, WORLD_RECIPE);
  heights.sort();
  const seaRadius = heights[Math.floor(target * (heights.length - 1))];
  settings.sea = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (100 * (seaRadius - WORLD_RECIPE.radius.seaMin)) /
          (WORLD_RECIPE.radius.seaMax - WORLD_RECIPE.radius.seaMin),
      ),
    ),
  );
  if (defaultCache.size >= 128) defaultCache.delete(defaultCache.keys().next().value);
  defaultCache.set(cacheKey, copySettings(settings));
  return copySettings(settings);
}

export function createWorld(seed, preset = 'earthlike') {
  validateSeedAndPreset(seed, preset);
  return {
    formatVersion: 1,
    generatorVersion: 1,
    seed,
    preset,
    settings: resolveDefaults(seed, preset),
    palette: authoredPalette(preset),
    recipe: copySupportedRecipe(WORLD_RECIPE),
  };
}

export function validateWorld(candidate) {
  requireKeys(candidate, WORLD_KEYS, 'World');
  if (candidate.formatVersion !== 1 || candidate.generatorVersion !== 1) {
    throw new Error('Unsupported world version. Use a current prerelease V1 code.');
  }
  validateSeedAndPreset(candidate.seed, candidate.preset);
  requireKeys(candidate.settings, SETTING_KEYS, 'World settings');
  const settings = {};
  for (const key of SETTING_KEYS) {
    const value = candidate.settings[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`World setting ${key} must be a whole number from 0 to 100.`);
    }
    settings[key] = value;
  }
  requireKeys(candidate.palette, PALETTE_KEYS, 'World palette');
  const palette = {};
  for (const key of PALETTE_KEYS) {
    const value = candidate.palette[key];
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error(`World palette ${key} must be a six-digit hex color.`);
    }
    palette[key] = value;
  }
  return {
    formatVersion: 1,
    generatorVersion: 1,
    seed: candidate.seed,
    preset: candidate.preset,
    settings,
    palette,
    recipe: copySupportedRecipe(candidate.recipe),
  };
}

export function getDefaultSettings(config) {
  if (config.formatVersion !== 1 || config.generatorVersion !== 1) {
    throw new Error('Unsupported world version.');
  }
  copySupportedRecipe(config.recipe);
  return resolveDefaults(config.seed, config.preset);
}

export function resetSettings(config) {
  const result = validateWorld(config);
  result.settings = getDefaultSettings(result);
  return result;
}

export function changePreset(config, preset) {
  validateSeedAndPreset(config.seed, preset);
  validateWorld(config);
  if (preset === config.preset) return config;
  return createWorld(config.seed, preset);
}
