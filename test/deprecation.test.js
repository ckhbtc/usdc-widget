import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const TARGET_URL = 'https://redirect.inj.so/';

test('index page redirects to the replacement page', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, new RegExp(`url=${TARGET_URL}`));
  assert.match(html, new RegExp(`href="${TARGET_URL}"`));
  assert.match(html, new RegExp(`location\\.replace\\('${TARGET_URL}'\\)`));
  assert.doesNotMatch(html, /src="\/app\.js"/);
});
