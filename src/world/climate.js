import { WORLD_RECIPE } from './recipe.js';

export const BIOMES = Object.freeze({
  ocean: 0,
  beach: 1,
  grassland: 2,
  forest: 3,
  desert: 4,
  rock: 5,
  snow: 6,
});

function quantize(value, precision) {
  return Math.round(value * precision) / precision;
}

export function localTemperature(baselineF, latitudeY, elevation, recipe = WORLD_RECIPE) {
  const climate = recipe.climate;
  const temperature =
    baselineF -
    climate.latitudeCooling * Math.abs(latitudeY) ** (climate.latitudePower ?? 2) -
    climate.elevationCooling * Math.max(0, elevation);
  return quantize(temperature, climate.climatePrecision);
}

function smoothstep(start, end, value) {
  const fraction = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return fraction * fraction * (3 - 2 * fraction);
}

export function snowCoverage(temperature, latitudeY, noise, recipe = WORLD_RECIPE) {
  const climate = recipe.climate;
  if (!climate.snowFrequency) return temperature <= climate.snowF ? 1 : 0;
  // Stable regional patches soften the snowline; the very tips stay white.
  const localF = temperature + noise * climate.snowVariationF;
  const cold = 1 - smoothstep(climate.fullSnowF, climate.snowF, localF);
  const pole = smoothstep(climate.polarStart, climate.polarFull, Math.abs(latitudeY));
  return Math.max(cold, pole);
}

export function localHumidity(baseline, noise, recipe = WORLD_RECIPE) {
  const fraction = baseline / 100;
  const variation =
    fraction *
    (1 - fraction) *
    Math.max(-1, Math.min(1, noise)) *
    recipe.climate.humidityVariation;
  const humidity = 100 * Math.max(0, Math.min(1, fraction + variation));
  return quantize(humidity, recipe.climate.climatePrecision);
}

/** A submerged representative can still have visible corners above the ocean. */
export function classifyBiome(sample, recipe = WORLD_RECIPE) {
  const climate = recipe.climate;
  const maximumElevation = quantize(
    sample.maxRadius - sample.oceanRadius,
    climate.geometryPrecision,
  );
  if (maximumElevation <= 0) return BIOMES.ocean;

  const temperature = quantize(sample.temperature, climate.climatePrecision);
  const humidity = quantize(sample.humidity, climate.climatePrecision);
  const elevation = quantize(
    sample.radius - sample.oceanRadius,
    climate.geometryPrecision,
  );
  const slopeCos = quantize(sample.slopeCos, climate.geometryPrecision);
  if ((sample.snowCover ?? (temperature <= climate.snowF ? 1 : 0)) >= 0.5)
    return BIOMES.snow;
  if (elevation <= climate.beachHeight) return BIOMES.beach;
  if (elevation >= climate.rockHeight || slopeCos < climate.rockSlopeCos)
    return BIOMES.rock;
  if (temperature >= climate.desertF && humidity < climate.desertHumidity)
    return BIOMES.desert;
  if (humidity >= climate.forestHumidity) return BIOMES.forest;
  return BIOMES.grassland;
}

/** Convert authored sRGB channel values to the renderer's linear vertex colors. */
export function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
