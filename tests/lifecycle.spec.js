import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const devURL = process.env.STRATA_DEV_URL;
test('dev harness repeats ten StrictMode mount/unmount cycles and retains generated document seed', async ({
  page,
}) => {
  test.skip(
    !devURL,
    'Set STRATA_DEV_URL to a local Vite dev server for the source-only lifecycle harness.',
  );
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array) => {
        array[0] = 123;
        return array;
      },
    });
  });
  await page.goto(`${devURL}/tests/lifecycle.html?inspect=1`);
  let expectedSeed = 123;
  let resources;
  let expectedConfig;
  const cycles = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    await page.getByRole('button', { name: 'Mount app', exact: true }).click();
    await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
    await expect(page.locator('canvas')).toHaveCount(1);
    const mounted = await page.evaluate(() => window.__strataInspect());
    expect(mounted.seed).toBe(expectedSeed);
    if (expectedConfig) expect(mounted.config).toEqual(expectedConfig);
    expect(mounted.createdScenes - mounted.disposedScenes).toBe(1);
    if (resources) expect(mounted.resources).toEqual(resources);
    resources = mounted.resources;
    if (cycle === 0) {
      await page.getByRole('button', { name: 'Generate a New Seed' }).click();
      expectedSeed = 124;
      await expect(page.getByLabel('Current seed')).toHaveText('124');
      await page.locator('#temperature').fill('97');
      await page.getByRole('combobox', { name: 'Preset' }).selectOption('alien');
      await page.locator('#humidity').fill('3');
      await page.waitForFunction(() => {
        const s = window.__strataInspect();
        return s.requestedRevision === s.appliedRevision;
      });
      expectedConfig = await page.evaluate(() => window.__strataInspect().config);
    }
    // Keep a read-only inspector reference so released renderer-owned resources can be checked.
    await page.evaluate(() => {
      window.__lastInspect = window.__strataInspect;
    });
    await page.getByRole('button', { name: 'Unmount app', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    const released = await page.evaluate(() => window.__lastInspect());
    cycles.push({ cycle: cycle + 1, mounted, released });
    expect(released.createdScenes).toBe(released.disposedScenes);
    expect(released.resources.geometries).toBe(0);
    // Three's module-global 16×16 DFG lookup texture remains in renderer.info.
    // Both application-owned 64×64 CanvasTextures must be deleted explicitly.
    expect(released.resources.textures).toBe(1);
    const textures = await page.evaluate(() => window.__textureAudit);
    const owned = textures.filter(
      (texture) => texture.width === 64 && texture.height === 64,
    );
    expect(owned.length).toBe((cycle + 1) * 4); // StrictMode creates two scenes per cycle.
    expect(owned.every((texture) => texture.deleted)).toBe(true);
    const lookup = textures.filter(
      (texture) => texture.width === 16 && texture.height === 16,
    );
    expect(lookup.length).toBe((cycle + 1) * 2);
    expect(lookup.every((texture) => !texture.deleted)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.__contextAudit.every((context) => context.lost)),
      )
      .toBe(true);
    expect(await page.evaluate(() => typeof window.__strataInspect)).toBe('undefined');
  }
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/refinement-lifecycle.json',
    JSON.stringify(
      {
        cycles,
        errors,
        textureAudit: await page.evaluate(() => window.__textureAudit),
        contextAudit: await page.evaluate(() =>
          window.__contextAudit.map(({ id, lost }) => ({ id, lost })),
        ),
      },
      null,
      2,
    ) + '\n',
  );
});

test('dev and production direct seeded documents reproduce identically', async ({
  page,
  context,
}) => {
  test.skip(!devURL, 'Set STRATA_DEV_URL for dev/production comparison.');
  await page.goto('/world/123?inspect=1');
  await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
  const expected = await page.evaluate(() => window.__strataInspect().fingerprint);
  const dev = await context.newPage();
  await dev.goto(`${devURL}/world/123?inspect=1&seed=999#dev`);
  await dev.waitForFunction(() => window.__strataInspect?.().fingerprint);
  expect(await dev.evaluate(() => window.__strataInspect().fingerprint)).toBe(expected);
  await dev.reload();
  await dev.waitForFunction(() => window.__strataInspect?.().fingerprint);
  expect(await dev.evaluate(() => window.__strataInspect().fingerprint)).toBe(expected);
  await dev.close();
});

test('Chrome back-forward cache restores the complete edited requested world', async ({
  playwright,
}) => {
  const browser = await playwright.chromium.launch({
    channel: 'chrome',
    headless: true,
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    args: [
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(crypto, 'getRandomValues', {
        value: (array) => {
          const count = Number(sessionStorage.getItem('restore-draws') || 0) + 1;
          sessionStorage.setItem('restore-draws', String(count));
          array[0] = count * 123;
          return array;
        },
      });
      window.addEventListener('pageshow', (event) => {
        window.__restoredFromCache = event.persisted;
      });
    });
    await page.goto('http://127.0.0.1:4173/?inspect=1#restored');
    await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
    await page.locator('#mountains').fill('93');
    await page.getByRole('combobox', { name: 'Preset' }).selectOption('alien');
    await page.locator('#humidity').fill('7');
    await page.waitForFunction(() => {
      const s = window.__strataInspect();
      return s.requestedRevision === s.appliedRevision;
    });
    const before = await page.evaluate(() => window.__strataInspect());
    await page.goto('http://127.0.0.1:4173/world/42?inspect=1');
    await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
    const restored = await page.evaluate(() => ({
      ...window.__strataInspect(),
      persisted: window.__restoredFromCache,
      draws: Number(sessionStorage.getItem('restore-draws')),
    }));
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/refinement-restoration.json',
      JSON.stringify({ before, restored }, null, 2) + '\n',
    );
    expect(restored.persisted).toBe(true);
    expect(restored.draws).toBe(1);
    expect(restored.config).toEqual(before.config);
    expect(restored.fingerprint).toBe(before.fingerprint);
    expect(restored.colorFingerprint).toBe(before.colorFingerprint);
  } finally {
    await browser.close();
  }
});
