import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import {
  BIOMES,
  classifyBiome,
  localHumidity,
  localTemperature,
  srgbToLinear,
  snowCoverage,
} from './climate.js';
import { sampleFractalNoise } from './noise.js';
import { createSeededRandom } from './random.js';
import { PALETTE_KEYS, WORLD_RECIPE } from './recipe.js';

function validateDirections(directions) {
  if (!(directions instanceof Float64Array)) {
    throw new TypeError('Directions must be a Float64Array of packed unit xyz values.');
  }
  if (!directions.length || directions.length % 3 !== 0) {
    throw new RangeError('Directions must contain complete, nonempty xyz triples.');
  }
  for (let offset = 0; offset < directions.length; offset += 3) {
    const length = Math.hypot(
      directions[offset],
      directions[offset + 1],
      directions[offset + 2],
    );
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-6) {
      throw new RangeError('Every source direction must be finite and unit length.');
    }
  }
}

function validateSettings(settings, keys) {
  for (const key of keys) {
    const value = settings?.[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new RangeError(`Setting ${key} must be an integer from 0 to 100.`);
    }
  }
}

function makeNoise(seed, salt) {
  return new SimplexNoise({ random: createSeededRandom(seed, salt) });
}

function smoothstep(start, end, value) {
  const fraction = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return fraction * fraction * (3 - 2 * fraction);
}

function samplePoint(noise, x, y, z, frequency, offset) {
  return Math.max(
    -1,
    Math.min(
      1,
      noise.noise3d(
        x * frequency + offset[0],
        y * frequency + offset[1],
        z * frequency + offset[2],
      ),
    ),
  );
}

function createTerrainFields(seed, directions, recipe) {
  const ridgeNoise = makeNoise(seed, recipe.mountains.salt);
  const detailNoise = makeNoise(seed, recipe.detail.salt);
  const ridge = new Float64Array(directions.length / 3);
  const detail = new Float64Array(ridge.length);
  for (let vertex = 0; vertex < ridge.length; vertex += 1) {
    const offset = vertex * 3;
    const x = directions[offset];
    const y = directions[offset + 1];
    const z = directions[offset + 2];
    const raw = samplePoint(
      ridgeNoise,
      x,
      y,
      z,
      recipe.mountains.frequency,
      recipe.mountains.offset,
    );
    // Cache the raw ridge; the continent mask changes when continent size changes.
    ridge[vertex] = (1 - Math.abs(raw)) ** recipe.mountains.exponent;
    detail[vertex] = sampleFractalNoise(detailNoise, x, y, z, recipe.detail);
  }
  return { continentsNoise: makeNoise(seed, recipe.continents.salt), ridge, detail };
}

function sampleContinents(noise, directions, setting, recipe, target) {
  const continents = recipe.continents;
  const frequency =
    continents.frequencyMax +
    ((continents.frequencyMin - continents.frequencyMax) * setting) / 100;
  const sampling = { ...continents, frequency };
  for (let vertex = 0; vertex < target.length; vertex += 1) {
    const offset = vertex * 3;
    const value = sampleFractalNoise(
      noise,
      directions[offset],
      directions[offset + 1],
      directions[offset + 2],
      sampling,
    );
    target[vertex] = value * continents.amplitude + continents.bias;
  }
}

function composeHeights(
  fields,
  continents,
  settings,
  recipe,
  heights,
  directions,
  positions,
) {
  const mountainAmplitude = (settings.mountains / 100) * recipe.mountains.amplitudeMax;
  const detailAmplitude = (settings.roughness / 100) * recipe.detail.amplitudeMax;
  let clampedCount = 0;
  for (let vertex = 0; vertex < heights.length; vertex += 1) {
    const mask = smoothstep(
      recipe.mountains.maskStart,
      recipe.mountains.maskEnd,
      continents[vertex],
    );
    // Keep fine roughness inland, so it doesn't cut the broad coast into islands.
    const detailMask =
      recipe.detail.coastMinimum === undefined
        ? 1
        : recipe.detail.coastMinimum +
          (1 - recipe.detail.coastMinimum) *
            smoothstep(
              recipe.detail.coastStart,
              recipe.detail.coastEnd,
              continents[vertex],
            );
    const radius =
      recipe.radius.base +
      continents[vertex] +
      fields.ridge[vertex] * mask * mountainAmplitude +
      fields.detail[vertex] * detailAmplitude * detailMask;
    const bounded = Math.max(recipe.radius.min, Math.min(recipe.radius.max, radius));
    if (bounded !== radius) clampedCount += 1;
    heights[vertex] = bounded;
    if (positions) {
      const offset = vertex * 3;
      const storedRadius = heights[vertex];
      positions[offset] = directions[offset] * storedRadius;
      positions[offset + 1] = directions[offset + 1] * storedRadius;
      positions[offset + 2] = directions[offset + 2] * storedRadius;
    }
  }
  return clampedCount;
}

/** Pure terrain radii for both defaults sampling and the interactive generator. */
export function sampleTerrainHeights(seed, settings, directions, recipe = WORLD_RECIPE) {
  validateDirections(directions);
  validateSettings(settings, ['mountains', 'continents', 'roughness']);
  const fields = createTerrainFields(seed, directions, recipe);
  const heights = new Float32Array(directions.length / 3);
  const continents = new Float64Array(heights.length);
  sampleContinents(
    fields.continentsNoise,
    directions,
    settings.continents,
    recipe,
    continents,
  );
  composeHeights(fields, continents, settings, recipe, heights);
  return heights;
}

function faceDirections(directions, cornerIndices) {
  const result = new Float64Array(cornerIndices.length);
  for (let face = 0; face < cornerIndices.length / 3; face += 1) {
    const faceOffset = face * 3;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = cornerIndices[faceOffset + corner] * 3;
      x += directions[offset];
      y += directions[offset + 1];
      z += directions[offset + 2];
    }
    const length = Math.hypot(x, y, z);
    if (length <= 1e-12)
      throw new RangeError('Face directions must have a nonzero representative.');
    result[faceOffset] = x / length;
    result[faceOffset + 1] = y / length;
    result[faceOffset + 2] = z / length;
  }
  return result;
}

function sampleFaceClimate(seed, directions, recipe, humidity, brightness, snow) {
  const noise = makeNoise(seed, recipe.climate.humiditySalt);
  const snowNoise = recipe.climate.snowFrequency
    ? makeNoise(seed, recipe.climate.snowSalt)
    : null;
  const random = createSeededRandom(seed, recipe.color.salt);
  for (let face = 0; face < humidity.length; face += 1) {
    const offset = face * 3;
    humidity[face] = samplePoint(
      noise,
      directions[offset],
      directions[offset + 1],
      directions[offset + 2],
      recipe.climate.humidityFrequency,
      recipe.climate.humidityOffset,
    );
    brightness[face] = 1 + (random() * 2 - 1) * recipe.color.variation;
    snow[face] = snowNoise
      ? samplePoint(
          snowNoise,
          directions[offset],
          directions[offset + 1],
          directions[offset + 2],
          recipe.climate.snowFrequency,
          recipe.climate.snowOffset,
        )
      : 0;
  }
}

function measureFaces(positions, heights, cornerIndices, radii, maxima, slopes) {
  for (let face = 0; face < radii.length; face += 1) {
    const first = cornerIndices[face * 3];
    const second = cornerIndices[face * 3 + 1];
    const third = cornerIndices[face * 3 + 2];
    const a = first * 3;
    const b = second * 3;
    const c = third * 3;
    const x = (positions[a] + positions[b] + positions[c]) / 3;
    const y = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    const z = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const radius = Math.hypot(x, y, z);
    const normalLength = Math.hypot(nx, ny, nz);
    radii[face] = radius;
    maxima[face] = Math.max(heights[first], heights[second], heights[third]);
    slopes[face] =
      normalLength > 0
        ? Math.min(1, Math.abs(nx * x + ny * y + nz * z) / (normalLength * radius))
        : 1;
  }
}

function readPalette(palette) {
  return PALETTE_KEYS.map((key) => {
    const hex = palette?.[key];
    if (typeof hex !== 'string' || !/^#[\da-f]{6}$/i.test(hex)) {
      throw new TypeError(`Palette ${key} must be a six-digit hex color.`);
    }
    const color = Number.parseInt(hex.slice(1), 16);
    return [
      srgbToLinear((color >>> 16) / 255),
      srgbToLinear(((color >>> 8) & 255) / 255),
      srgbToLinear((color & 255) / 255),
    ];
  });
}

/** Reuses its output arrays; callers must copy a result they want to retain. */
export function createWorldGenerator(directions, cornerIndices) {
  validateDirections(directions);
  if (!(cornerIndices instanceof Uint32Array))
    throw new TypeError('Corner indices must be a Uint32Array.');
  if (
    !cornerIndices.length ||
    cornerIndices.length % 3 !== 0 ||
    cornerIndices.some((index) => index >= directions.length / 3)
  ) {
    throw new RangeError('Corner indices must contain valid triangle vertex indices.');
  }
  const faceCount = cornerIndices.length / 3;
  const representatives = faceDirections(directions, cornerIndices);
  const continents = new Float64Array(directions.length / 3);
  const humidityNoise = new Float64Array(faceCount);
  const snowNoise = new Float64Array(faceCount);
  const brightness = new Float64Array(faceCount);
  const faceRadii = new Float64Array(faceCount);
  const faceMaxima = new Float64Array(faceCount);
  const slopeCosines = new Float64Array(faceCount);
  const result = {
    positions: new Float32Array(directions.length),
    heights: new Float32Array(directions.length / 3),
    colors: new Float32Array(cornerIndices.length * 3),
    biomes: new Uint8Array(faceCount),
    oceanRadius: 1,
    geometryChanged: true,
    stats: {
      minRadius: 0,
      maxRadius: 0,
      landFraction: 0,
      clampedCount: 0,
      biomeCounts: {},
    },
  };
  let terrainKey;
  let climateKey;
  let previousSeed;
  let previousContinents;
  let previousMountains;
  let previousRoughness;
  let fields;

  function update(config) {
    const { seed, settings, palette, recipe = WORLD_RECIPE } = config;
    validateSettings(settings, [
      'sea',
      'mountains',
      'continents',
      'roughness',
      'temperature',
      'humidity',
    ]);
    // Validate the seed even when a previous result can be reused.
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new RangeError('Seed must be an unsigned 32-bit integer.');
    const paletteColors = readPalette(palette);
    const nextTerrainKey = JSON.stringify([
      recipe.radius,
      recipe.continents,
      recipe.mountains,
      recipe.detail,
    ]);
    const nextClimateKey = JSON.stringify([recipe.climate, recipe.color]);
    const seedChanged = previousSeed !== seed;
    const fieldsChanged = seedChanged || terrainKey !== nextTerrainKey;
    const continentsChanged = fieldsChanged || previousContinents !== settings.continents;
    const geometryChanged =
      continentsChanged ||
      previousMountains !== settings.mountains ||
      previousRoughness !== settings.roughness;
    if (fieldsChanged) fields = createTerrainFields(seed, directions, recipe);
    if (continentsChanged)
      sampleContinents(
        fields.continentsNoise,
        directions,
        settings.continents,
        recipe,
        continents,
      );
    if (seedChanged || climateKey !== nextClimateKey)
      sampleFaceClimate(
        seed,
        representatives,
        recipe,
        humidityNoise,
        brightness,
        snowNoise,
      );
    if (geometryChanged) {
      result.stats.clampedCount = composeHeights(
        fields,
        continents,
        settings,
        recipe,
        result.heights,
        directions,
        result.positions,
      );
      measureFaces(
        result.positions,
        result.heights,
        cornerIndices,
        faceRadii,
        faceMaxima,
        slopeCosines,
      );
    }
    result.geometryChanged = geometryChanged;
    result.oceanRadius =
      recipe.radius.seaMin +
      ((recipe.radius.seaMax - recipe.radius.seaMin) * settings.sea) / 100;
    const biomeCounts = Object.fromEntries(PALETTE_KEYS.map((key) => [key, 0]));
    for (let face = 0; face < faceCount; face += 1) {
      const elevation = Math.max(0, faceRadii[face] - result.oceanRadius);
      const latitude = representatives[face * 3 + 1];
      const temperature = localTemperature(
        settings.temperature,
        latitude,
        elevation,
        recipe,
      );
      const baseBiome = classifyBiome(
        {
          radius: faceRadii[face],
          maxRadius: faceMaxima[face],
          slopeCos: slopeCosines[face],
          temperature,
          snowCover: 0,
          humidity: localHumidity(settings.humidity, humidityNoise[face], recipe),
          oceanRadius: result.oceanRadius,
        },
        recipe,
      );
      const snow =
        baseBiome === BIOMES.ocean
          ? 0
          : snowCoverage(temperature, latitude, snowNoise[face], recipe);
      const biome = snow >= 0.5 ? BIOMES.snow : baseBiome;
      result.biomes[face] = biome;
      biomeCounts[PALETTE_KEYS[biome]] += 1;
      const color = paletteColors[baseBiome];
      const snowColor = paletteColors[BIOMES.snow];
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = face * 9 + corner * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          result.colors[offset + channel] = Math.max(
            0,
            Math.min(
              1,
              (color[channel] * (1 - snow) + snowColor[channel] * snow) *
                brightness[face],
            ),
          );
        }
      }
    }
    let minRadius = Infinity;
    let maxRadius = -Infinity;
    let landCount = 0;
    for (const radius of result.heights) {
      minRadius = Math.min(minRadius, radius);
      maxRadius = Math.max(maxRadius, radius);
      if (radius > result.oceanRadius) landCount += 1;
    }
    Object.assign(result.stats, {
      minRadius,
      maxRadius,
      landFraction: landCount / result.heights.length,
      biomeCounts,
    });
    previousSeed = seed;
    previousContinents = settings.continents;
    previousMountains = settings.mountains;
    previousRoughness = settings.roughness;
    terrainKey = nextTerrainKey;
    climateKey = nextClimateKey;
    return result;
  }

  return { update };
}
