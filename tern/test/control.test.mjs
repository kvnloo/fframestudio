import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('control command file stays private, avoids token argv and is removed after CLI exit', async () => {
  const { controlFile } = await import('../tern-control.mjs');
  let file;
  const result = await controlFile('browser open "http://127.0.0.1/open?token=test-only"\n', async argv => {
    assert.deepEqual(argv.slice(0, 2), ['ctl', '--file']);
    file = argv[2];
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.ok(!argv.some(x => x.includes('test-only')));
    assert.match(await fs.readFile(file, 'utf8'), /token=test-only/);
    return 42;
  });
  assert.equal(result, 42);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});
