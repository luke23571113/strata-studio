export function sampleFractalNoise(noise, x, y, z, settings) {
  let frequency = settings.frequency;
  let weight = 1;
  let weightedSum = 0;
  let weightSum = 0;

  for (let octave = 0; octave < settings.octaves; octave += 1) {
    const sampleX = x * frequency + settings.offset[0];
    const sampleY = y * frequency + settings.offset[1];
    const sampleZ = z * frequency + settings.offset[2];
    const noiseValue = noise.noise3d(sampleX, sampleY, sampleZ);
    const boundedNoise = Math.max(-1, Math.min(1, noiseValue));
    weightedSum += boundedNoise * weight;
    weightSum += weight;
    frequency *= settings.lacunarity;
    weight *= settings.persistence;
  }

  // Every world uses the same weights; its observed extrema never rescale it.
  return weightedSum / weightSum;
}
