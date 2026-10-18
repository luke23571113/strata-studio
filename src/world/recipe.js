// Generation constants are included in every World Code.
export const WORLD_RECIPE = freezeRecipe({
  topology: {
    type: 'icosphere',
    detail: 44,
    ordering: 'three-0.186.1-shared-v1',
  },
  random: {
    algorithm: 'mulberry32-murmur-finalizer',
    noise: 'three-simplex-0.186.1',
  },
  radius: {
    base: 1,
    min: 0.88,
    max: 1.18,
    seaMin: 0.86,
    seaMax: 1.2,
  },
  continents: {
    salt: 1129270868,
    frequencyMin: 0.65,
    frequencyMax: 2.8,
    octaves: 2,
    lacunarity: 2,
    persistence: 0.18,
    amplitude: 0.1,
    bias: -0.012,
    offset: [12.37, -4.91, 7.63],
  },
  mountains: {
    salt: 1297044814,
    frequency: 5.5,
    exponent: 3,
    amplitudeMax: 0.05,
    maskStart: 0,
    maskEnd: 0.035,
    offset: [-5.17, 17.31, 9.23],
  },
  detail: {
    salt: 1145394241,
    frequency: 18,
    octaves: 2,
    lacunarity: 2,
    persistence: 0.4,
    amplitudeMax: 0.02,
    offset: [3.71, -13.47, 21.19],
    coastMinimum: 0.2,
    coastStart: -0.015,
    coastEnd: 0.025,
  },
  climate: {
    humiditySalt: 1213549897,
    humidityFrequency: 2.4,
    humidityOffset: [8.13, -2.71, 15.37],
    humidityVariation: 1,
    latitudeCooling: 60,
    elevationCooling: 250,
    snowF: 32,
    beachHeight: 0.006,
    rockHeight: 0.06,
    rockSlopeCos: 0.707107,
    desertF: 70,
    desertHumidity: 30,
    forestHumidity: 60,
    climatePrecision: 1000,
    geometryPrecision: 1000000,
    latitudePower: 4,
    snowSalt: 1397641047,
    snowFrequency: 12,
    snowOffset: [19.4, -7.2, 3.6],
    snowVariationF: 8,
    fullSnowF: 20,
    polarStart: 0.96,
    polarFull: 0.995,
  },
  color: {
    salt: 1129270354,
    variation: 0.04,
    space: 'linear-srgb',
  },
  defaults: {
    revision: 1,
    salt: 1145390675,
    hash: 'fnv1a-utf16-v1',
    samples: 2048,
    sampling: 'fibonacci-midpoints-golden-angle-v1',
    quantile: 'floor-target-times-count-minus-one',
    rounding: 'nearest-integer',
    earthlike: {
      mountains: [30, 65],
      continents: [40, 75],
      roughness: [20, 45],
      temperature: [65, 85],
      humidity: [40, 70],
      ocean: [55, 70],
    },
    frozen: {
      mountains: [25, 60],
      continents: [40, 75],
      roughness: [15, 40],
      temperature: [5, 25],
      humidity: [35, 65],
      ocean: [50, 65],
    },
    alien: {
      mountains: [35, 75],
      continents: [25, 70],
      roughness: [30, 65],
      temperature: [55, 90],
      humidity: [20, 75],
      ocean: [50, 70],
    },
  },
});

function freezeRecipe(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeRecipe(child);
  }
  return Object.freeze(value);
}

export const SETTING_KEYS = [
  'sea',
  'mountains',
  'continents',
  'roughness',
  'temperature',
  'humidity',
];
export const PALETTE_KEYS = [
  'ocean',
  'beach',
  'grassland',
  'forest',
  'desert',
  'rock',
  'snow',
];
