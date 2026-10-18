import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [manifest, markup, app] = await Promise.all([
  readFile('package.json', 'utf8').then(JSON.parse),
  readFile('ui/index.html', 'utf8'),
  readFile('ui/app.mjs', 'utf8')
]);

test('manifest grants the plugin browser detection and download capabilities', () => {
  assert.deepEqual(manifest.commerce.permissions.browser, ['detect', 'download']);
});

test('plugin UI owns browser candidate controls and uses the SDK bridge', () => {
  for (const id of ['browser-panel', 'browser-list', 'browser-select-all', 'browser-batch-download', 'browser-rescan']) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
  for (const method of ['client.browser.status()', 'client.browser.rescan', 'client.browser.download', 'client.browser.cancel', 'client.browser.onEvent']) {
    assert.match(app, new RegExp(method.replace(/[.()]/g, '\\$&')));
  }
});
