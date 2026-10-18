import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Keep Chrome's native back/forward cache enabled for this separate restoration check.
const browser = await chromium.launch({
  channel: 'chrome',
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
});
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
const report = {
  before,
  restored,
  verified:
    restored.persisted === true &&
    before.seed === restored.seed &&
    before.fingerprint === restored.fingerprint &&
    restored.draws === 1,
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/world-restoration.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (restored.persisted && !report.verified) process.exitCode = 1;
