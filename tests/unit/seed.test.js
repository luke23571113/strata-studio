import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRandomSeed,
  formatWorldPath,
  parseWorldPath,
} from '../../src/world/seed.js';

const MAX_SEED = 4294967295;

function createRandomSource(value) {
  return {
    calls: 0,
    getRandomValues(values) {
      this.calls += 1;
      assert.ok(values instanceof Uint32Array);
      assert.equal(values.length, 1);
      values[0] = value;
      return values;
    },
  };
}

test('the bare root requests a random world', () => {
  assert.deepEqual(parseWorldPath('/'), { type: 'random' });
});

test('canonical seeded paths include both unsigned 32-bit bounds', () => {
  for (const seed of [0, 1, 123, 2147483648, MAX_SEED]) {
    assert.deepEqual(parseWorldPath(`/world/${seed}`), { type: 'seeded', seed });
    assert.equal(formatWorldPath(seed), `/world/${seed}`);
  }
});

test('invalid world paths reject the entire spelling without falling back to random', () => {
  const invalidPaths = [
    '/world',
    '/world/',
    '/world//',
    '/world/00',
    '/world/01',
    '/world/0123',
    '/world/-0',
    '/world/-1',
    '/world/+1',
    '/world/1.0',
    '/world/0.5',
    '/world/.5',
    '/world/1e3',
    '/world/0x10',
    '/world/ 1',
    '/world/1 ',
    '/world/1\n',
    '/world/1\t',
    '/world/%31',
    '/world/%20',
    '/world/１',
    '/world/١',
    '/world/NaN',
    '/world/Infinity',
    '/world/4294967296',
    '/world/9007199254740993',
    `/world/${'9'.repeat(400)}`,
    '/world/123/',
    '/world/123/extra',
    '/world/123abc',
    '/world/123?seed=456',
    '/world/123#456',
  ];

  for (const pathname of invalidPaths) {
    const result = parseWorldPath(pathname);
    assert.equal(result.type, 'invalid', pathname);
    assert.match(result.message, /world address is invalid/, pathname);
    assert.match(result.message, /0 to 4294967295/, pathname);
    assert.equal('seed' in result, false, pathname);
  }
});

test('unknown paths provide a useful page-not-found notice', () => {
  for (const pathname of [
    '',
    '/unknown',
    '/worlds/123',
    '/World/123',
    '//',
    '/?seed=123',
  ]) {
    const result = parseWorldPath(pathname);
    assert.equal(result.type, 'invalid', pathname);
    assert.match(result.message, /page could not be found/, pathname);
  }
});

test('pathname parsing ignores query and fragment data passed separately by URL', () => {
  const seededUrl = new URL('https://example.com/world/123?seed=456#789');
  const randomUrl = new URL('https://example.com/?seed=456#789');

  assert.deepEqual(parseWorldPath(seededUrl.pathname), { type: 'seeded', seed: 123 });
  assert.deepEqual(parseWorldPath(randomUrl.pathname), { type: 'random' });
});

test('formatting rejects values outside the numeric unsigned 32-bit contract', () => {
  for (const seed of [
    -1,
    0.5,
    MAX_SEED + 1,
    NaN,
    Infinity,
    -Infinity,
    '123',
    '',
    null,
    undefined,
  ]) {
    assert.throws(() => formatWorldPath(seed), {
      name: 'RangeError',
      message: /whole number from 0 to 4294967295/,
    });
  }
});

test('random sampling returns either bound and uses exactly one unsigned 32-bit draw', () => {
  for (const sampledSeed of [0, 123, 2147483648, MAX_SEED]) {
    const randomSource = createRandomSource(sampledSeed);
    assert.equal(createRandomSeed(undefined, randomSource), sampledSeed);
    assert.equal(randomSource.calls, 1);
  }
});

test('a different random draw is preserved when there is a previous seed', () => {
  const randomSource = createRandomSource(123);
  assert.equal(createRandomSeed(456, randomSource), 123);
  assert.equal(randomSource.calls, 1);
});

test('a repeated draw advances once, including wrapping the maximum seed to zero', () => {
  for (const [previousSeed, expectedSeed] of [
    [0, 1],
    [123, 124],
    [MAX_SEED, 0],
  ]) {
    const randomSource = createRandomSource(previousSeed);
    assert.equal(createRandomSeed(previousSeed, randomSource), expectedSeed);
    assert.equal(randomSource.calls, 1);
  }
});

test('an invalid previous seed is rejected before consuming randomness', () => {
  for (const previousSeed of [-1, 0.5, MAX_SEED + 1, NaN, Infinity, '123', null]) {
    const randomSource = createRandomSource(123);
    assert.throws(() => createRandomSeed(previousSeed, randomSource), RangeError);
    assert.equal(randomSource.calls, 0);
  }
});
