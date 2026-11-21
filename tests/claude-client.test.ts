import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { publicStatus, codeStatus, openDesktop } = require('../desktop/claude-client.cjs');

test('Claude status exposes only verified public fields and distinguishes API credentials', () => {
  assert.deepEqual(publicStatus({ loggedIn: false, email: 'old', accessToken: 'secret' }), {
    installed: true,
    signedIn: false,
  });
  assert.deepEqual(
    publicStatus({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'a@example.test',
      subscriptionType: 'pro',
      accessToken: 'secret',
      refreshToken: 'secret',
      organizationId: 'private',
    }),
    {
      installed: true,
      signedIn: true,
      subscription: true,
      email: 'a@example.test',
      plan: 'pro',
    },
  );
  assert.equal(publicStatus({ loggedIn: true, authMethod: 'api_key' }).subscription, false);
  assert.equal(publicStatus({ loggedIn: 'true' }).signedIn, false);
});

test('Claude Desktop opens the native installation, never a browser substitute', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'kivuno-claude-client-'));
  try {
    const directory = path.join(home, 'AnthropicClaude');
    await mkdir(directory);
    const executable = path.join(directory, 'claude.exe');
    await writeFile(executable, 'fixture');
    const opened: string[] = [];
    const shell = {
      openPath: async (value: string) => {
        opened.push(value);
        return '';
      },
    };
    assert.deepEqual(await openDesktop(shell, 'win32', { LOCALAPPDATA: home, USERPROFILE: home }), {
      opened: true,
    });
    assert.deepEqual(opened, [executable]);
    await assert.rejects(
      openDesktop({ openPath: async () => 'error' }, 'win32', { LOCALAPPDATA: home }),
      /could not open/,
    );
    await assert.rejects(openDesktop(shell, 'linux', { HOME: home }), /not installed/);
    assert.equal(opened.length, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('missing Claude CLI is not reported as signed in and status never installs it', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'kivuno-no-claude-'));
  try {
    assert.deepEqual(await codeStatus({ USERPROFILE: home, HOME: home, PATH: '' }), {
      installed: false,
      signedIn: false,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
