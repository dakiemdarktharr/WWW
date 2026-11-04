import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { BrowserBridge } from '../server/browser.ts';

const require = createRequire(import.meta.url);
const { browserUrl, browserBounds } = require('../desktop/browser.cjs');

test('project browser denies coordinator, file/javascript URLs, credentials and local hosts', () => {
  const backend = 'http://127.0.0.1:51432';
  assert.equal(browserUrl('https://example.org/project', backend), 'https://example.org/project');
  for (const url of [
    backend,
    backend + '/api/session',
    'file:///C:/secret',
    'javascript:alert(1)',
    'https://user:secret@example.org',
    'http://example.org',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://localhost',
    'https://metadata',
    'https://router.local',
    'https://[::1]',
  ])
    assert.throws(() => browserUrl(url, backend), /./, url);
  assert.throws(() => browserUrl(backend, backend, true));
  assert.equal(browserUrl('http://127.0.0.1:50000/', backend, true), 'http://127.0.0.1:50000/');
});

test('native browser bounds cannot cover titlebar or escape window', () => {
  assert.deepEqual(browserBounds({ x: -10, y: -20, width: 9999, height: 9999 }, [1200, 800]), {
    x: 0,
    y: 40,
    width: 1200,
    height: 760,
  });
  assert.throws(() => browserBounds({ x: 0, y: NaN, width: 200, height: 400 }, [1200, 800]));
});

test('browser handoffs are session scoped, expire, and invalidate stale snapshots', () => {
  let now = Date.now();
  const browser = new BrowserBridge(() => now);
  browser.request('project-a', 'session-a', 'https://example.org/login', 'Please sign in.');
  assert.equal(browser.read('project-a', 'session-b').request, null);
  assert.equal(browser.read('project-b', 'session-a').request, null);
  const snapshot = browser.share('project-a', 'session-a', {
    url: 'https://example.org/dashboard?token=never-share#secret',
    title: 'Dashboard',
    text: 'Visible text sk-abcdefghijklmnopq and Bearer secret-token',
  });
  assert.equal(snapshot.url, 'https://example.org/dashboard');
  assert.equal(snapshot.text, 'Visible text [redacted] and Bearer [redacted]');
  assert.equal(browser.read('project-a', 'session-a').request, null);
  browser.request('project-a', 'session-a', 'https://example.org/next', 'Next page');
  assert.equal(browser.read('project-a', 'session-a').snapshot, null);
  now += 31 * 60_000;
  assert.deepEqual(browser.read('project-a', 'session-a'), { request: null, snapshot: null });
});

test('browser handoffs have bounded retention and do not return mutable internal state', () => {
  const browser = new BrowserBridge();
  for (let i = 0; i < 65; i++)
    browser.request('project', `session-${i}`, 'https://example.org', 'read');
  assert.equal(browser.read('project', 'session-0').request, null);
  const result = browser.read('project', 'session-64');
  result.request!.purpose = 'tampered';
  assert.equal(browser.read('project', 'session-64').request!.purpose, 'read');
});
