import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetEmail } from '../server/reset-email.ts';

test('recovery email links are restricted to the HTTPS application origin', () => {
  for (const link of [
    'https://attacker.test/reset',
    'javascript:alert(1)',
    'https://user:password@kivuno.test/reset',
  ])
    assert.throws(() => resetEmail(link, 'https://kivuno.test'));
  assert.throws(() => resetEmail('http://kivuno.test/reset', 'http://kivuno.test'));
  const email = resetEmail('https://kivuno.test/reset?token=abc&other="x"', 'https://kivuno.test');
  assert.match(email.html, /&amp;other=/);
  assert.doesNotMatch(email.html, /<script|<img|<iframe/i);
  assert.match(email.text, /daethphate@gmail.com/);
});
