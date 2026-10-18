import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const sceneClip = { x: 350, y: 180, width: 700, height: 540 };
const sceneImage = (page) => page.screenshot({ clip: sceneClip });

async function checkViewport(page, width, height) {
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect
    .poll(() => page.locator('canvas').boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width,
      height,
    });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('desktop scene, camera bounds, reset, overlay isolation and resize', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/?inspect=1');
  await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
  await checkViewport(page, 1440, 900);
  const initial = await sceneImage(page);
  await page.waitForTimeout(400);
  expect((await sceneImage(page)).equals(initial)).toBe(true);

  await page.mouse.move(650, 400);
  await page.mouse.down();
  await page.mouse.move(810, 450, { steps: 15 });
  await page.mouse.up();
  expect((await sceneImage(page)).equals(initial)).toBe(false);
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await sceneImage(page)).equals(initial)).toBe(true);

  await page.locator('canvas').focus();
  await page.keyboard.press('ArrowRight');
  expect((await sceneImage(page)).equals(initial)).toBe(false);
  await page.getByRole('button', { name: 'Reset view' }).click();
  for (const slider of await page.getByRole('slider').all()) {
    const previous = await slider.inputValue();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    expect(Number(await slider.inputValue())).toBe(Number(previous) + 1);
  }
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('frozen');
  await expect(page.getByRole('combobox', { name: 'Preset' })).toHaveValue('frozen');
  const sea = page.getByRole('slider', { name: 'Sea level' });
  const seaBox = await sea.boundingBox();
  await page.mouse.move(seaBox.x + 20, seaBox.y + seaBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seaBox.x + seaBox.width - 20, seaBox.y + seaBox.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator('output[for="sea"]')).toContainText(await sea.inputValue());
  await page.getByRole('button', { name: 'Reset Sliders', exact: true }).click();
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('earthlike');
  await page.waitForFunction(() => {
    const s = window.__strataInspect();
    return s.requestedRevision === s.appliedRevision;
  });
  await sea.hover();
  await page.mouse.wheel(0, 500);
  expect((await sceneImage(page)).equals(initial)).toBe(true);

  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(150);
  const closest = await sceneImage(page);
  const near = await page.evaluate(() => window.__strataInspect());
  expect(near.cameraDistance).toBeCloseTo(near.minDistance, 8);
  expect(closest.equals(initial)).toBe(false);
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(150);
  expect((await sceneImage(page)).equals(closest)).toBe(true);
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(150);
  const farthest = await sceneImage(page);
  const far = await page.evaluate(() => window.__strataInspect());
  expect(far.maxDistance).toBe(14);
  expect(far.cameraDistance).toBeCloseTo(14, 8);
  expect(farthest.equals(closest)).toBe(false);
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(150);
  expect((await sceneImage(page)).equals(farthest)).toBe(true);
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await sceneImage(page)).equals(initial)).toBe(true);
  await page.locator('canvas').focus();
  for (let repeat = 0; repeat < 30; repeat++) await page.keyboard.press('+');
  const keyboardNear = await page.evaluate(() => window.__strataInspect());
  expect(keyboardNear.cameraDistance).toBeCloseTo(keyboardNear.minDistance, 8);
  for (let repeat = 0; repeat < 40; repeat++) await page.keyboard.press('-');
  expect(await page.evaluate(() => window.__strataInspect().cameraDistance)).toBeCloseTo(
    14,
    8,
  );
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await sceneImage(page)).equals(initial)).toBe(true);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop-preview.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await checkViewport(page, 1280, 800);
  await page.setViewportSize({ width: 390, height: 844 });
  await checkViewport(page, 390, 844);
  expect(errors).toEqual([]);
});

test('phone touch rotation, pinch, drawer scrolling and overlay isolation', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('http://127.0.0.1:4173/?inspect=1');
  await page.waitForFunction(() => window.__strataInspect?.().fingerprint);
  await checkViewport(page, 390, 844);
  const clip = { x: 30, y: 200, width: 330, height: 400 };
  const before = await page.screenshot({ clip });
  const client = await context.newCDPSession(page);
  const touch = (type, touchPoints) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await touch('touchStart', [{ x: 150, y: 350, id: 1 }]);
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', [{ x: 150 + step * 10, y: 350 + step * 4, id: 1 }]);
  }
  await touch('touchEnd', []);
  expect((await page.screenshot({ clip })).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Reset view' }).tap();
  expect((await page.screenshot({ clip })).equals(before)).toBe(true);
  await touch('touchStart', [
    { x: 155, y: 400, id: 1 },
    { x: 235, y: 400, id: 2 },
  ]);
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [
      { x: 155 - step * 8, y: 400, id: 1 },
      { x: 235 + step * 8, y: 400, id: 2 },
    ]);
  }
  await touch('touchEnd', []);
  expect((await page.screenshot({ clip })).equals(before)).toBe(false);
  for (let repeat = 0; repeat < 12; repeat++) {
    await touch('touchStart', [
      { x: 35, y: 400, id: 1 },
      { x: 355, y: 400, id: 2 },
    ]);
    await touch('touchMove', [
      { x: 185, y: 400, id: 1 },
      { x: 205, y: 400, id: 2 },
    ]);
    await touch('touchEnd', []);
  }
  expect(await page.evaluate(() => window.__strataInspect().cameraDistance)).toBeCloseTo(
    14,
    8,
  );
  for (let repeat = 0; repeat < 12; repeat++) {
    await touch('touchStart', [
      { x: 185, y: 400, id: 1 },
      { x: 205, y: 400, id: 2 },
    ]);
    await touch('touchMove', [
      { x: 35, y: 400, id: 1 },
      { x: 355, y: 400, id: 2 },
    ]);
    await touch('touchEnd', []);
  }
  const near = await page.evaluate(() => window.__strataInspect());
  expect(near.cameraDistance).toBeCloseTo(near.minDistance, 8);
  await page.getByRole('button', { name: 'Reset view' }).tap();
  expect(await page.evaluate(() => window.__strataInspect().cameraDistance)).toBeCloseTo(
    Math.hypot(0.12, 5.3),
    8,
  );
  await page.screenshot({ path: 'artifacts/phone-preview.png' });
  await page.getByRole('button', { name: 'Explore controls' }).tap();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const planetClip = { x: 30, y: 165, width: 330, height: 240 };
  const cameraBeforeOverlay = await page.evaluate(
    () => window.__strataInspect().cameraPosition,
  );
  const sea = page.getByRole('slider', { name: 'Sea level' });
  const box = await sea.boundingBox();
  await touch('touchStart', [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }]);
  await touch('touchMove', [{ x: box.x + 200, y: box.y + box.height / 2, id: 1 }]);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => window.__strataInspect().cameraPosition)).toEqual(
    cameraBeforeOverlay,
  );
  await page.screenshot({ path: 'artifacts/phone-controls.png' });
  await page.getByRole('slider', { name: 'Humidity' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('slider', { name: 'Humidity' })).toBeInViewport();
  expect(await page.evaluate(() => window.__strataInspect().cameraPosition)).toEqual(
    cameraBeforeOverlay,
  );
  await page.getByRole('button', { name: 'Close controls' }).tap();
  await page.getByRole('button', { name: 'Explore controls' }).tap();
  await page.getByRole('button', { name: 'Reset Sliders', exact: true }).click();
  await page.getByRole('button', { name: 'Close controls' }).tap();
  await page.waitForFunction(() => {
    const s = window.__strataInspect();
    return s.requestedRevision === s.appliedRevision;
  });
  expect((await page.screenshot({ clip })).equals(before)).toBe(true);
  await page.setViewportSize({ width: 360, height: 740 });
  await checkViewport(page, 360, 740);
  expect(errors).toEqual([]);
  await context.close();
});
