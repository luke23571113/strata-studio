import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

await mkdir('artifacts/performance', { recursive: true });

const baseURL = process.env.STRATA_URL || 'http://127.0.0.1:4173';
const software = process.argv.includes('--software');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: software
    ? [
        '--enable-webgl',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ]
    : [],
});
const session = await browser.newBrowserCDPSession();
const [chrome, system] = await Promise.all([
  session.send('Browser.getVersion'),
  session.send('SystemInfo.getInfo'),
]);
const inspect = (page) => page.evaluate(() => window.__strataInspect());
const settled = (page) =>
  page.waitForFunction(() => {
    const value = window.__strataInspect?.();
    return value?.fingerprint && value.requestedRevision === value.appliedRevision;
  });
function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}
function metrics(values) {
  return {
    generationMs: distribution(values.map((s) => s.generationMs)),
    updateMs: distribution(values.map((s) => s.updateMs)),
    inputLatencyMs: distribution(values.map((s) => s.inputLatencyMs)),
    eventToPaintOpportunityMs: distribution(
      values.map((s) => s.eventToPaintOpportunityMs),
    ),
  };
}
async function action(page, perform) {
  const count = await page.evaluate(() => window.__actionFrames.length);
  await perform();
  await page.waitForFunction((count) => window.__actionFrames.length > count, count);
  return {
    ...(await inspect(page)),
    eventToPaintOpportunityMs: await page.evaluate(() => window.__actionFrames.at(-1).ms),
  };
}
async function orbit(page, profile) {
  await page.evaluate(() => {
    window.__orbitFrames = [];
    window.__orbitRunning = true;
    let previous;
    function sample(time) {
      if (!window.__orbitRunning) return;
      if (previous !== undefined) window.__orbitFrames.push(time - previous);
      previous = time;
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const x = profile.width / 2;
  const y = profile.height * 0.42;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const started = performance.now();
  let step = 0;
  while (performance.now() - started < 10000) {
    step++;
    await page.mouse.move(x + Math.sin(step * 0.12) * 80, y + Math.cos(step * 0.12) * 60);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  return page.evaluate(() => {
    window.__orbitRunning = false;
    return window.__orbitFrames;
  });
}
if (process.argv.includes('--drag')) {
  const profiles = [];
  for (const profile of [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'phone', width: 390, height: 844, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.mobile ? 2 : 1,
      isMobile: profile.mobile,
      hasTouch: profile.mobile,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__dragFrames = [];
      window.__longTasks = [];
      let serial = 0;
      window.__longTaskSupported =
        PerformanceObserver.supportedEntryTypes.includes('longtask');
      if (window.__longTaskSupported)
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            window.__longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
              name: entry.name,
            });
        }).observe({ type: 'longtask', buffered: true });
      document.addEventListener(
        'input',
        (event) => {
          if (event.target.type !== 'range') return;
          const inputAt = performance.now();
          const value = Number(event.target.value);
          const control = event.target.id;
          const ownSerial = ++serial;
          const previousRevision = window.__strataInspect?.().appliedRevision;
          window.__lastDragInput = { control, value, inputAt };
          function observe() {
            if (serial !== ownSerial) return;
            const state = window.__strataInspect?.();
            if (
              state?.appliedRevision > previousRevision &&
              state.appliedRevision === state.requestedRevision &&
              state.settings[control] === value
            )
              requestAnimationFrame(() =>
                window.__dragFrames.push({
                  control,
                  value,
                  inputAt,
                  paintOpportunityAt: performance.now(),
                  revision: state.appliedRevision,
                }),
              );
            else requestAnimationFrame(observe);
          }
          requestAnimationFrame(observe);
        },
        true,
      );
      document.addEventListener(
        'pointerup',
        () => {
          window.__dragReleasedAt = performance.now();
          window.__dragReleaseState = window.__strataInspect?.();
        },
        true,
      );
    });
    await page.goto(`${baseURL}/world/123?inspect=1`);
    await settled(page);
    if (profile.mobile)
      await page.getByRole('button', { name: 'Explore controls' }).click();
    const controls = [];
    for (const control of [
      'sea',
      'mountains',
      'continents',
      'roughness',
      'temperature',
      'humidity',
    ]) {
      for (const [key, value] of Object.entries({
        sea: 15,
        mountains: 70,
        continents: 65,
        roughness: 45,
        temperature: 85,
        humidity: 50,
      }))
        await page.locator(`#${key}`).fill(String(value));
      await settled(page);
      await page.locator(`#${control}`).scrollIntoViewIfNeeded();
      const box = await page.locator(`#${control}`).boundingBox();
      const started = await page.evaluate(() => {
        window.__dragFrames = [];
        window.__longTasks = [];
        window.__lastDragInput = null;
        return performance.now();
      });
      const before = await inspect(page);
      const states = [];
      await page.mouse.move(box.x + 7, box.y + box.height / 2);
      await page.mouse.down();
      for (let step = 0; step <= 12; step++) {
        await page.mouse.move(
          box.x + 7 + ((box.width - 14) * step) / 12,
          box.y + box.height / 2,
        );
        if (step < 12) {
          await page.waitForTimeout(167);
          states.push(await inspect(page));
        }
      }
      await page.mouse.up();
      await page.waitForFunction(() => {
        const last = window.__lastDragInput;
        const painted = window.__dragFrames.at(-1);
        return last && painted?.control === last.control && painted?.value === last.value;
      });
      await settled(page);
      await page.waitForTimeout(50);
      const final = await inspect(page);
      const evidence = await page.evaluate(
        (started) => ({
          longTaskSupported: window.__longTaskSupported,
          longTasks: window.__longTasks.filter((task) => task.startTime >= started),
          frames: window.__dragFrames,
          lastInput: window.__lastDragInput,
          releasedAt: window.__dragReleasedAt,
          releaseState: window.__dragReleaseState,
        }),
        started,
      );
      const finalFrame = evidence.frames.at(-1);
      controls.push({
        control,
        durationMs: evidence.releasedAt - started,
        appliedBeforeRelease: evidence.releaseState.updateCount - before.updateCount,
        distinctSampledStates: new Set(
          states.map(
            (state) =>
              `${state.fingerprint}/${state.colorFingerprint}/${state.oceanRadius}`,
          ),
        ).size,
        maxLongTaskMs: Math.max(0, ...evidence.longTasks.map((task) => task.duration)),
        finalInputToPaintOpportunityMs:
          finalFrame.paintOpportunityAt - finalFrame.inputAt,
        finalSettleAfterReleaseMs: Math.max(
          0,
          finalFrame.paintOpportunityAt - evidence.releasedAt,
        ),
        finalRequestedRevision: final.requestedRevision,
        finalAppliedRevision: final.appliedRevision,
        finalSettings: final.settings,
        evidence,
      });
    }
    profiles.push({ profile, controls });
    await context.close();
  }
  const path = `artifacts/performance/drag-performance-${software ? 'swiftshader' : 'default-gpu'}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        method:
          'Supplementary native mouse drags lasting at least2seconds each, allsixcontrols and desktop/phoneemulation. Capture-phase native input plus RAF after observing its applied revision yields a paint-opportunity proxy, notGPUcompletion/display. Pointerup is the release clock; finalSettleAfterReleaseMs is nonnegative time from release to final paintopportunity (zero if already applied). LongTask PerformanceObserver entries are filtered to actual drag start onward. No screenshots or concurrent browser tests during measurement.',
        profiles,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        path,
        profiles: profiles.map(({ profile, controls }) => ({
          profile,
          controls: controls.map(({ evidence, ...summary }) => summary),
        })),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(0);
}

const profiles = [];
for (const profile of [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
]) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.mobile ? 2 : 1,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    let index = 0;
    Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true,
      value: (array) => {
        array[0] = Math.imul(++index, 2654435761) >>> 0;
        return array;
      },
    });
    window.__actionFrames = [];
    let serial = 0;
    function capture(event) {
      const target = event.target;
      const control =
        event.type === 'click' &&
        target.closest('button')?.textContent === 'Generate a New Seed'
          ? 'new-seed'
          : event.type === 'input' && (target.type === 'range' || target.id === 'preset')
            ? target.id
            : null;
      if (!control) return;
      const started = performance.now();
      const previousRevision = window.__strataInspect?.().appliedRevision;
      const ownSerial = ++serial;
      function observe() {
        if (serial !== ownSerial) return;
        const state = window.__strataInspect?.();
        if (
          state?.appliedRevision > previousRevision &&
          state.requestedRevision === state.appliedRevision
        )
          requestAnimationFrame(() =>
            window.__actionFrames.push({
              control,
              revision: state.appliedRevision,
              ms: performance.now() - started,
            }),
          );
        else requestAnimationFrame(observe);
      }
      requestAnimationFrame(observe);
    }
    document.addEventListener('click', capture, true);
    document.addEventListener('input', capture, true);
  });
  const navigationStart = performance.now();
  await page.goto(`${baseURL}/world/123?inspect=1`);
  await settled(page);
  const navigationToReadyMs = performance.now() - navigationStart;
  const initial = await inspect(page);
  const graphics = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      devicePixelRatio,
      viewport: [innerWidth, innerHeight],
    };
  });
  const trials = [];
  const combined = {
    newSeed: [],
    preset: [],
    controls: Object.fromEntries(
      ['sea', 'mountains', 'continents', 'roughness', 'temperature', 'humidity'].map(
        (key) => [key, []],
      ),
    ),
    frames: [],
  };
  for (let trial = 1; trial <= 3; trial++) {
    const newSeed = [];
    const preset = [];
    const live = [];
    for (let index = 0; index < 13; index++) {
      const sample = await action(page, () =>
        page.getByRole('button', { name: 'Generate a New Seed', exact: true }).click(),
      );
      if (index >= 3) newSeed.push(sample);
    }
    for (let index = 0; index < 13; index++) {
      const option = (await inspect(page)).preset === 'frozen' ? 'alien' : 'frozen';
      const sample = await action(page, () =>
        page.getByRole('combobox', { name: 'Preset' }).selectOption(option),
      );
      if (index >= 3) preset.push(sample);
    }
    if (profile.mobile)
      await page.getByRole('button', { name: 'Explore controls' }).click();
    for (const control of Object.keys(combined.controls)) {
      const values = [];
      for (let index = 0; index < 13; index++) {
        const sample = await action(page, () =>
          page.locator(`#${control}`).fill(String((index * 37 + trial) % 101)),
        );
        if (index >= 3) values.push(sample);
      }
      combined.controls[control].push(...values);
      live.push({ control, ...metrics(values) });
    }
    if (profile.mobile)
      await page.getByRole('button', { name: 'Close controls' }).click();
    const frames = await orbit(page, profile);
    combined.frames.push(...frames);
    combined.newSeed.push(...newSeed);
    combined.preset.push(...preset);
    trials.push({
      trial,
      newSeed: metrics(newSeed),
      preset: metrics(preset),
      live,
      orbitFrameMs: distribution(frames),
    });
    console.log(
      `${software ? 'software' : 'default'} ${profile.name} trial ${trial} complete`,
    );
  }
  const after = await inspect(page);
  profiles.push({
    profile,
    graphics,
    startup: {
      navigationToReadyMs,
      topologyMs: initial.topologyMs,
      coldGenerationMs: initial.generationMs,
      coldUpdateMs: initial.updateMs,
    },
    trials,
    combined: {
      newSeed: metrics(combined.newSeed),
      preset: metrics(combined.preset),
      live: Object.entries(combined.controls).map(([control, values]) => ({
        control,
        ...metrics(values),
      })),
      orbitFrameMs: distribution(combined.frames),
    },
    resourcesBefore: initial.resources,
    resourcesAfter: after.resources,
    scenesBefore: { created: initial.createdScenes, disposed: initial.disposedScenes },
    scenesAfter: { created: after.createdScenes, disposed: after.disposedScenes },
    errors,
  });
  await context.close();
}
const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    hostname: os.hostname(),
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    softwareRequested: software,
    chrome,
    gpu: system.gpu,
  },
  method:
    'Production preview in headless installed Chrome. Initial usable state after module/assets load is timed separately. Each viewport has three warm trials; each trial has three discarded warmups then ten samples for new seed, preset, and each slider, yielding thirty retained samples/action. Capture-phase native click/input timestamps precede React/default calculation. eventToPaintOpportunityMs observes a newer applied revision in RAF and measures to the following RAF, a paint-opportunity proxy including defaults plus generation plus scheduling. Actual GPU completion and input-to-present pixel latency are not measured. Inspector CPU update/inputLatency measures remain separate (new-world defaults precede those clocks). Each trial measures RAF intervals during a continuously driven ten-second mouse orbit. Phone is emulation on this desktop hardware, not a physical phone.',
  profiles,
};
const path = `artifacts/performance/performance-${software ? 'swiftshader' : 'default-gpu'}.json`;
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      path,
      profiles: profiles.map(({ profile, graphics, startup, combined, errors }) => ({
        profile,
        graphics,
        startup,
        combined,
        errors,
      })),
    },
    null,
    2,
  ),
);
await browser.close();
