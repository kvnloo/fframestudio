import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const setTestLocation = () => {
  globalThis.location = { origin: 'https://ffs.test' };
};
const restoreLocation = () => {
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
  else delete globalThis.location;
};

// Provide the browser origin before evaluating the module, then isolate each test.
globalThis.location = { origin: 'https://ffs.test' };
after(restoreLocation);
const { isCopy, assetPath, sourceLink, copyMedia } = await import('../../web/src/examples.js');
beforeEach(setTestLocation);
afterEach(restoreLocation);

test('isCopy recognizes copy IDs and rejects other values', () => {
  assert.equal(isCopy('example-copy-1'), true);
  assert.equal(isCopy('x'), false);
  assert.equal(isCopy(null), false);
  assert.equal(isCopy(42), false);
});

test('assetPath resolves files below /examples/', () => {
  assert.equal(assetPath('a/b.mp4'), '/examples/a/b.mp4');
  assert.equal(assetPath('/examples/x.png'), '/examples/x.png');
  assert.equal(assetPath('c.png', '/examples/sub/manifest.json'), '/examples/sub/c.png');
});

test('assetPath rejects escapes and URL query or fragment components', () => {
  for (const value of [
    '../x.png',
    'https://evil.test/examples/a',
    '/examples/a?x=1',
    '/examples/a#h',
    '/examples/../x',
  ]) {
    assert.throws(() => assetPath(value), /same-origin files under \/examples\//, value);
  }
});

test('sourceLink preserves HTTP(S) source URLs', () => {
  assert.equal(sourceLink('https://a.test/x'), 'https://a.test/x');
  assert.equal(sourceLink('http://a.test'), 'http://a.test/');
});

test('sourceLink rejects non-HTTP(S) or unparseable links', () => {
  assert.equal(sourceLink('javascript:alert(1)'), '');
  assert.equal(sourceLink('not a url'), '');
  assert.equal(sourceLink('ftp://a'), '');
});

test('copyMedia only resolves valid media for example copies and swallows invalid paths', () => {
  assert.equal(copyMedia('x', 'a.png'), null);
  assert.equal(copyMedia('example-copy-1', ''), null);
  assert.equal(copyMedia('example-copy-1', 'a.png'), '/examples/a.png');
  assert.equal(copyMedia('example-copy-1', 'https://evil.test/examples/a'), '');
});
