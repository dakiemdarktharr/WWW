// Consent expiry UX with a controlled clock; never contacts a real provider.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.install();
  let decisions = 0;
  let rejectDecision = false;
  await context.route('https://consent.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/get-session')
      return route.fulfill({ json: { user: { name: 'Test owner' } } });
    if (url.pathname === '/api/session') return route.fulfill({ json: { token: 'fixture' } });
    if (url.pathname === '/api/claude/oauth/consent') {
      if (route.request().method() === 'POST') {
        decisions++;
        assert(rejectDecision, 'Expired UI must not submit another consent decision.');
        return route.fulfill({
          status: 400,
          json: { code: 'CLAUDE_CONSENT_UNAVAILABLE', error: 'unavailable' },
        });
      }
      return route.fulfill({
        json: {
          requestRemainingMs: 300000,
          account: { name: 'Test owner' },
          scope: 'connector.connect mesh.read',
          grants: [
            {
              kind: 'account',
              connectionId: 'fixture-connection',
              memberId: 'fixture-member',
              memberName: 'Atlas',
              deviceName: 'Test desktop',
              expiresAt: '2026-12-22T00:00:00Z',
            },
          ],
        },
      });
    }
    const filename = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
    const mime: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
    };
    try {
      return await route.fulfill({
        body: await readFile(path.join('dist', filename)),
        contentType: mime[path.extname(filename)] || 'application/octet-stream',
      });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  const target =
    'https://consent.test/claude/connect?request=11111111-1111-4111-8111-111111111111&lang=en';
  await page.goto(target);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByText('Confirm this request within', { exact: false })).toBeVisible();
  await expect(page.getByText('Link valid until', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link account', exact: true })).toBeEnabled();
  await page.clock.fastForward(301000);
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('button', { name: 'Link account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to Claude', exact: true })).toHaveAttribute(
    'href',
    'https://claude.ai/plugins/yours?filter=connectors',
  );
  assert.equal(decisions, 0);
  rejectDecision = true;
  await page.reload();
  await page.getByRole('button', { name: 'Link account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('button', { name: 'Link account', exact: true })).toHaveCount(0);
  assert.equal(decisions, 1);
  console.log('Consent countdown, expiry recovery, and server rejection passed.');
} finally {
  await browser.close();
}
