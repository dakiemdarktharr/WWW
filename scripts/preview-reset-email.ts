import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { resetEmail } from '../server/reset-email.ts';

await mkdir('.local', { recursive: true });
const email = resetEmail(
  'https://kivuno.vercel.app/reset-password?token=DEMO-NOT-A-REAL-TOKEN',
  'https://kivuno.vercel.app',
);
await writeFile('.local/reset-email-preview.html', email.html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 760, height: 940 },
    deviceScaleFactor: 1,
  });
  await page.setContent(email.html);
  await page.screenshot({ path: '.local/reset-email-preview.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: '.local/reset-email-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Email overflows on mobile.');
  console.log('Email design preview saved in .local. No email was sent.');
} finally {
  await browser.close();
}
