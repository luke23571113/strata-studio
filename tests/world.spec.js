import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const inspect = (page) => page.evaluate(() => window.__strataInspect());
const settled = (page) =>
  page.waitForFunction(() => {
    const value = window.__strataInspect?.();
    return value?.fingerprint && value.requestedRevision === value.appliedRevision;
  });
async function ready(page, path = '/world/123?inspect=1') {
  await page.goto(path);
  await settled(page);
}
async function random(page, values, persist = false) {
  await page.addInitScript(
    ({ values, persist }) => {
      let index = persist ? Number(sessionStorage.getItem('test-random-index') || 0) : 0;
      window.__randomDraws = 0;
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        value: (array) => {
          array[0] = values[index++ % values.length];
          window.__randomDraws++;
          if (persist) sessionStorage.setItem('test-random-index', String(index));
          return array;
        },
      });
    },
    { values, persist },
  );
}
async function clipboard(page, failure = false) {
  await page.addInitScript((failure) => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (failure) throw new Error('Clipboard denied for test');
          window.__copied.push(text);
        },
      },
    });
  }, failure);
}
async function copy(page, name = 'Copy World Code') {
  await page.getByRole('button', { name, exact: true }).click();
  return page.evaluate(() => window.__copied.at(-1));
}
async function load(page, text) {
  const input = page.getByRole('textbox', { name: 'World Code or link' });
  if (!(await input.isVisible()))
    await page.getByText('Load a world', { exact: true }).click();
  await input.fill(text);
  await page.getByRole('button', { name: 'Load World', exact: true }).click();
  await settled(page);
}
function decode(code) {
  return JSON.parse(
    Buffer.from(code.slice(3).replace(/^\./, ''), 'base64url').toString('utf8'),
  );
}
function encode(value, original) {
  return `SS1${original.startsWith('SS1.') ? '.' : ''}${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}
const signature = (s) => `${s.fingerprint}/${s.colorFingerprint}/${s.oceanRadius}`;

test('root reload draws fresh entropy while live edits and presets retain the document seed', async ({
  page,
}) => {
  await random(page, [123, 456, 789], true);
  await ready(page, '/?inspect=1&seed=999#root');
  const first = await inspect(page);
  expect(first.seed).toBe(123);
  await page.locator('#mountains').fill('90');
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('alien');
  await settled(page);
  const edited = await inspect(page);
  expect(edited.seed).toBe(first.seed);
  expect(edited.createdScenes).toBe(first.createdScenes);
  expect(await page.evaluate(() => window.__randomDraws)).toBe(1);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.reload();
  await settled(page);
  expect((await inspect(page)).seed).toBe(456);
  expect((await inspect(page)).preset).toBe('earthlike');
});

test('seed shortcuts reproduce current defaults across reload and independent documents', async ({
  page,
  context,
}) => {
  await random(page, [999]);
  for (const seed of [0, 123, 4294967295]) {
    await ready(page, `/world/${seed}?inspect=1&seed=999#ignored`);
    const first = await inspect(page);
    expect(first.seed).toBe(seed);
    expect(first.terrainTriangles).toBe(40500);
    expect(first.uniqueVertices).toBe(20252);
    expect(await page.evaluate(() => window.__randomDraws)).toBe(0);
    await page.reload();
    await settled(page);
    expect((await inspect(page)).config).toEqual(first.config);
    expect(signature(await inspect(page))).toBe(signature(first));
    const other = await context.newPage();
    await ready(other, `/world/${seed}?inspect=1`);
    expect(signature(await inspect(other))).toBe(signature(first));
    await other.close();
  }
});

test('invalid routes and startup codes never render an unrelated substitute', async ({
  page,
}) => {
  for (const path of [
    '/world',
    '/world/',
    '/world/-1',
    '/world/01',
    '/world/1.5',
    '/world/4294967296',
    '/world/123/',
    '/world/123/extra',
    '/world/+1',
    '/world/%201',
    '/elsewhere',
    '/#world=SS1.invalid',
  ]) {
    await page.goto(
      path.includes('?')
        ? path
        : path.replace('#', '?inspect=1#') + (path.includes('#') ? '' : '?inspect=1'),
    );
    await expect(page.getByRole('heading', { name: 'World unavailable' })).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Open a new random world' }),
    ).toHaveAttribute('href', '/');
  }
});

test('presets reset sliders, same preset is a no-op, reset retains palette, and new seed resets selected preset defaults', async ({
  page,
}) => {
  await random(page, [123, 777, 888]);
  await clipboard(page);
  await ready(page, '/world/123?inspect=1&keep=yes#fragment');
  const original = await inspect(page);
  await page.locator('canvas').focus();
  await page.keyboard.press('ArrowRight');
  const camera = (await inspect(page)).cameraPosition;
  await page.locator('#sea').fill('90');
  await settled(page);
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset Sliders', exact: true }).click();
  await settled(page);
  expect((await inspect(page)).config).toEqual(original.config);
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('frozen');
  await settled(page);
  const frozen = await inspect(page);
  expect(frozen.seed).toBe(original.seed);
  expect(frozen.cameraPosition).toEqual(camera);
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('frozen');
  await settled(page);
  expect((await inspect(page)).updateCount).toBe(frozen.updateCount);
  await page.locator('#temperature').fill('100');
  await settled(page);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Generate a New Seed', exact: true }).click();
  await settled(page);
  const next = await inspect(page);
  expect(next.seed).toBe(124);
  expect(next.preset).toBe('frozen');
  expect(next.cameraPosition).toEqual(camera);
  expect(next.resources).toEqual(original.resources);
  expect(next.createdScenes).toBe(original.createdScenes);
  expect(next.settings.temperature).toBeLessThan(30);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('?inspect=1&keep=yes');
  expect(new URL(page.url()).hash).toBe('#fragment');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await copy(page, 'Copy seed')).toBe('124');
});

test('complete codes and links round-trip edits, custom palette, direct reload and second document', async ({
  page,
  context,
}) => {
  await clipboard(page);
  await ready(page);
  await page.locator('#mountains').fill('100');
  await page.locator('#temperature').fill('87');
  await page.locator('#humidity').fill('12');
  await settled(page);
  const edited = await inspect(page);
  const code = await copy(page);
  expect(code.startsWith('SS1')).toBe(true);
  expect(code.length).toBeLessThan(4096);
  const link = await copy(page, 'Copy Link');
  expect(new URL(link).pathname).toBe('/');
  expect(new URL(link).hash).toContain('world=SS1');
  const other = await context.newPage();
  await ready(other, link.replace('/#', '/?inspect=1#'));
  expect((await inspect(other)).config).toEqual(edited.config);
  expect(signature(await inspect(other))).toBe(signature(edited));
  await other.reload();
  await settled(other);
  expect(signature(await inspect(other))).toBe(signature(edited));
  await other.close();
  const payload = decode(code);
  for (const key of Object.keys(payload.palette)) payload.palette[key] = '#aa4499';
  await load(page, encode(payload, code));
  const custom = await inspect(page);
  expect(custom.config.palette).toEqual(payload.palette);
  await page.locator('#sea').fill('100');
  await page.getByRole('button', { name: 'Reset Sliders', exact: true }).click();
  await settled(page);
  expect((await inspect(page)).config.palette).toEqual(payload.palette);
  expect(decode(await copy(page)).palette).toEqual(payload.palette);
  await load(page, code);
  expect((await inspect(page)).config).toEqual(edited.config);
});

test('invalid imports preserve current world and clipboard denial exposes captured selectable code', async ({
  page,
}) => {
  await clipboard(page, true);
  await ready(page);
  await page.getByRole('button', { name: 'Copy World Code', exact: true }).click();
  const fallback = page.getByRole('textbox').filter({ hasText: '' });
  const values = await page
    .getByRole('textbox')
    .evaluateAll((elements) => elements.map((e) => e.value));
  const captured = values.find((value) => value?.startsWith('SS1'));
  expect(captured).toBeTruthy();
  const original = await inspect(page);
  const payload = decode(captured);
  const extra = { ...payload, unexpected: true };
  const unknown = { ...payload, generatorVersion: 999 };
  for (const invalid of [
    'SS1.bad',
    captured.slice(0, -7),
    'SS1.' + 'A'.repeat(8193),
    encode(extra, captured),
    encode(unknown, captured),
    'https://example.invalid/#world=SS1.bad',
  ]) {
    await load(page, invalid);
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await inspect(page)).config).toEqual(original.config);
    expect(signature(await inspect(page))).toBe(signature(original));
  }
  expect(await fallback.count()).toBeGreaterThan(0);
});

test('all six controls apply at least three distinct planet renders during sustained drags', async ({
  page,
}) => {
  test.setTimeout(100_000);
  await ready(page);
  await mkdir('artifacts/refinement-live', { recursive: true });
  const report = [];
  for (const id of [
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
    const start = await inspect(page);
    const box = await page.locator(`#${id}`).boundingBox();
    const states = [];
    const images = [];
    await page.mouse.move(box.x + 7, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 0; step <= 12; step++) {
      await page.mouse.move(
        box.x + 7 + ((box.width - 14) * step) / 12,
        box.y + box.height / 2,
      );
      await page.waitForTimeout(160);
      const state = await inspect(page);
      states.push(state);
      if (step % 3 === 0)
        images.push(
          await page.screenshot({
            path: `artifacts/refinement-live/${id}-${step}.png`,
            clip: { x: 350, y: 180, width: 700, height: 540 },
          }),
        );
    }
    const beforeRelease = await inspect(page);
    await page.mouse.up();
    await settled(page);
    const distinct = new Set(states.map(signature)).size;
    expect(beforeRelease.updateCount - start.updateCount).toBeGreaterThanOrEqual(3);
    expect(distinct).toBeGreaterThanOrEqual(3);
    expect(
      new Set(images.map((bytes) => bytes.toString('base64'))).size,
    ).toBeGreaterThanOrEqual(3);
    expect(beforeRelease.createdScenes).toBe(start.createdScenes);
    if (['sea', 'temperature', 'humidity'].includes(id)) {
      expect(beforeRelease.fingerprint).toBe(start.fingerprint);
      expect(beforeRelease.normalFingerprint).toBe(start.normalFingerprint);
    }
    report.push({
      control: id,
      appliedBeforeRelease: beforeRelease.updateCount - start.updateCount,
      distinct,
      states: states.map(
        ({
          settings,
          fingerprint,
          colorFingerprint,
          requestedRevision,
          appliedRevision,
          updateMs,
          inputLatencyMs,
        }) => ({
          settings,
          fingerprint,
          colorFingerprint,
          requestedRevision,
          appliedRevision,
          updateMs,
          inputLatencyMs,
        }),
      ),
    });
  }
  await writeFile(
    'artifacts/refinement-live-drag.json',
    JSON.stringify(report, null, 2) + '\n',
  );
});

test('rapid reversals and copy capture latest requested config before pending rendering settles', async ({
  page,
}) => {
  await clipboard(page);
  await ready(page);
  const captured = await page.evaluate(() => {
    const slider = document.querySelector('#mountains');
    for (const value of [100, 0, 90, 10, 83]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        slider,
        String(value),
      );
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelectorAll('button').forEach((button) => {
      if (button.textContent === 'Copy World Code') button.click();
    });
    return { pending: window.__strataInspect() };
  });
  const code = await page.evaluate(() => window.__copied.at(-1));
  expect(captured.pending.settings.mountains).not.toBe(83);
  expect(decode(code).settings.mountains).toBe(83);
  await settled(page);
  expect((await inspect(page)).settings.mountains).toBe(83);
  await load(page, code);
  expect((await inspect(page)).config.settings.mountains).toBe(83);
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/refinement-pending-copy.json',
    JSON.stringify({ ...captured, settled: await inspect(page) }, null, 2) + '\n',
  );
});

test('six seeds by three presets render desktop and phone visual corpus and stable resources across 100 changes', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  await mkdir('artifacts/refinement-worlds', { recursive: true });
  const corpus = [];
  const hardware = await playwright.chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  try {
    const phoneContext = await hardware.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    for (const seed of [0, 1, 42, 123, 2026, 4294967295]) {
      await ready(page, `/world/${seed}?inspect=1`);
      for (const preset of ['earthlike', 'frozen', 'alien']) {
        await page.getByRole('combobox', { name: 'Preset' }).selectOption(preset);
        await settled(page);
        corpus.push(await inspect(page));
        await page.screenshot({
          path: `artifacts/refinement-worlds/${seed}-${preset}-desktop.png`,
        });
        const phone = await phoneContext.newPage();
        await ready(phone, `http://127.0.0.1:4173/world/${seed}?inspect=1`);
        await phone.evaluate(() => document.fonts.ready);
        await phone.getByRole('combobox', { name: 'Preset' }).selectOption(preset);
        await settled(phone);
        await phone.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await phone.waitForTimeout(300);
        expect((await inspect(phone)).config).toEqual((await inspect(page)).config);
        await expect(
          phone.getByRole('button', { name: 'Explore controls' }),
        ).toBeInViewport();
        await phone.screenshot({
          path: `artifacts/refinement-worlds/${seed}-${preset}-phone.png`,
        });
        await phone.close();
      }
    }
    const before = await inspect(page);
    for (let index = 0; index < 100; index++) {
      if (index % 2)
        await page
          .getByRole('combobox', { name: 'Preset' })
          .selectOption((await inspect(page)).preset === 'frozen' ? 'alien' : 'frozen');
      else
        await page
          .getByRole('button', { name: 'Generate a New Seed', exact: true })
          .click();
      await settled(page);
    }
    const after = await inspect(page);
    expect(after.updateCount - before.updateCount).toBe(100);
    expect(after.resources).toEqual(before.resources);
    expect(after.createdScenes).toBe(before.createdScenes);
    expect(after.disposedScenes).toBe(before.disposedScenes);
    await writeFile(
      'artifacts/refinement-world-corpus.json',
      JSON.stringify(
        {
          phoneCapture:
            'Fresh page per seed/preset in fixed-size390x844 DPR2 mobile context in installed Chrome hardware default; fonts.ready, settled plus2RAF and300ms before capture; no cross-size viewport screenshots.',
          corpus,
          before100: before,
          after100: after,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await hardware.close();
  }
});

test('context restoration keeps the latest canonical world and sharing usable during loss', async ({
  page,
}) => {
  await clipboard(page);
  await ready(page);
  await page.locator('#temperature').fill('91');
  await settled(page);
  const before = await inspect(page);
  await page.evaluate(() => {
    window.__lose = document
      .querySelector('canvas')
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('#humidity').fill('9');
  const code = await copy(page);
  expect(decode(code).settings.humidity).toBe(9);
  await page.evaluate(() => window.__lose.restoreContext());
  await expect(page.getByRole('alert')).toHaveCount(0);
  await settled(page);
  const after = await inspect(page);
  expect(after.settings.humidity).toBe(9);
  expect(after.settings.temperature).toBe(91);
  expect(after.seed).toBe(before.seed);
  expect(after.createdScenes).toBe(before.createdScenes);
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/refinement-context-restore.json',
    JSON.stringify({ before, after }, null, 2) + '\n',
  );
});

test('phone drawer keeps native keyboard/touch controls and complete sharing reachable at both narrow sizes', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await clipboard(page);
  await ready(page, 'http://127.0.0.1:4173/world/123?inspect=1');
  for (const size of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    await page.setViewportSize(size);
    const generate = page.getByRole('button', {
      name: 'Generate a New Seed',
      exact: true,
    });
    await expect(generate).toBeInViewport();
    await page.getByRole('button', { name: 'Explore controls' }).tap();
    await expect(generate).toBeInViewport();
    const before = await inspect(page);
    const humidity = page.getByRole('slider', { name: 'Humidity' });
    await humidity.scrollIntoViewIfNeeded();
    await expect(humidity).toBeInViewport();
    await humidity.focus();
    await page.keyboard.press('Home');
    await expect(humidity).toHaveValue('0');
    await page.keyboard.press('End');
    await expect(humidity).toHaveValue('100');
    await settled(page);
    expect((await inspect(page)).cameraPosition).toEqual(before.cameraPosition);
    await page.getByText('World & sharing', { exact: true }).scrollIntoViewIfNeeded();
    if (!(await page.getByRole('textbox', { name: 'World Code or link' }).isVisible()))
      await page.getByText('Load a world', { exact: true }).tap();
    const input = page.getByRole('textbox', { name: 'World Code or link' });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport();
    const code = await copy(page);
    await load(page, code);
    expect((await inspect(page)).settings.humidity).toBe(100);
    await page.getByRole('button', { name: 'Close controls' }).tap();
    await expect(generate).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      size.width,
    );
  }
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/refinement-phone-reachability.png' });
  await context.close();
});

test('preset, import and new seed supersede pending slider revisions atomically', async ({
  page,
}) => {
  await random(page, [777, 888]);
  await clipboard(page);
  await ready(page);
  const saved = await copy(page);
  const original = await inspect(page);
  const pending = async () =>
    page.evaluate(() => {
      const input = document.querySelector('#continents');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        '1',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await pending();
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('frozen');
  await settled(page);
  const frozen = await inspect(page);
  expect(frozen.preset).toBe('frozen');
  expect(frozen.settings.continents).not.toBe(1);
  await pending();
  await load(page, saved);
  expect((await inspect(page)).config).toEqual(original.config);
  expect(signature(await inspect(page))).toBe(signature(original));
  await pending();
  await page.getByRole('button', { name: 'Generate a New Seed', exact: true }).click();
  await settled(page);
  const generated = await inspect(page);
  expect(generated.seed).toBe(777);
  expect(generated.settings.continents).not.toBe(1);
  expect(generated.requestedRevision).toBe(generated.appliedRevision);
});

test('share fragments accept either parameter order, reject duplicates/empty, retain unrelated data and reject oversized pasted input', async ({
  page,
}) => {
  await clipboard(page);
  await random(page, [777]);
  await ready(page);
  await page.locator('#humidity').fill('13');
  await settled(page);
  const saved = await inspect(page);
  const code = await copy(page);
  for (const hash of [`note=keep&world=${code}`, `world=${code}&note=keep`]) {
    await ready(page, `/?inspect=1&keep=yes#${hash}`);
    expect((await inspect(page)).config).toEqual(saved.config);
    await page.getByRole('button', { name: 'Generate a New Seed', exact: true }).click();
    await settled(page);
    expect(new URL(page.url()).hash).toBe('#note=keep');
    expect(new URL(page.url()).search).toBe('?inspect=1&keep=yes');
    expect((await inspect(page)).seed).toBe(777);
  }
  for (const hash of [`world=${code}&world=${code}`, 'world=', 'note=keep&world=']) {
    await page.goto(`/?inspect=1#${hash}`);
    await expect(page.getByRole('heading', { name: 'World unavailable' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  }
  await ready(page);
  const before = await inspect(page);
  await load(page, code + ' '.repeat(17000));
  await expect(page.getByRole('alert')).toContainText('16 KiB');
  expect((await inspect(page)).config).toEqual(before.config);
});

test('latest pending request applies after hidden-page resume, using actual tab visibility when available', async ({
  page,
  context,
}) => {
  await clipboard(page);
  await ready(page);
  const before = await inspect(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  let actualHidden = await page.evaluate(() => document.hidden);
  const mode = actualHidden
    ? 'actual background tab document.hidden'
    : 'simulated document.hidden and visibilitychange (headless Chrome kept the background tab visible)';
  if (!actualHidden)
    await page.evaluate(() => {
      window.__testHidden = true;
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => window.__testHidden,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  await page.evaluate(() => {
    const input = document.querySelector('#humidity');
    for (const value of [91, 4, 14]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        String(value),
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForFunction(
    (previous) => window.__strataInspect().requestedRevision > previous,
    before.appliedRevision,
    { polling: 50 },
  );
  await page.waitForTimeout(100);
  const hidden = await inspect(page);
  expect(hidden.appliedRevision).toBe(before.appliedRevision);
  expect(hidden.requestedRevision).toBeGreaterThan(hidden.appliedRevision);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Copy World Code')
      .click(),
  );
  expect(
    decode(await page.evaluate(() => window.__copied.at(-1))).settings.humidity,
  ).toBe(14);
  if (actualHidden) await page.bringToFront();
  else
    await page.evaluate(() => {
      window.__testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  await settled(page);
  const resumed = await inspect(page);
  expect(resumed.settings.humidity).toBe(14);
  expect(resumed.seed).toBe(before.seed);
  expect(resumed.createdScenes).toBe(before.createdScenes);
  await other.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/refinement-hidden-resume.json',
    JSON.stringify({ mode, before, hidden, resumed }, null, 2) + '\n',
  );
});
