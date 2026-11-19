import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import Fastify from 'fastify';
import { buildApp } from '../../server/app.ts';
import { DesktopIdentity } from '../../server/desktop-auth.ts';
import { registerDesktopRoutes } from '../../server/desktop-routes.ts';
import { runMachine, type RunnerConfig } from '../../server/runner-agent.ts';
import type { Workspace } from '../../server/service.ts';
import type { RunnerEvent } from '../../server/runners.ts';
import { safeEqual } from '../../server/security.ts';
import { Store } from '../../server/store.ts';

const issuer = 'https://token.actions.githubusercontent.com';
const bootstrapPath = '/paired-test/config';
const statusPath = '/paired-test/status';
const exchangePath = '/api/desktop/bridge/exchange';
const enrollmentRequired = 'An unused, matching CI identity is required.';
const key = () => randomBytes(32).toString('base64url');

export function tunnelOrigin(input: string) {
  const url = new URL(input);
  assert.match(url.href, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/$/);
  return url.origin;
}

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export async function startCrossHostBridge(
  workspace: Workspace,
  projectId: string,
  node: { id: string; token: string },
  options: {
    origin: string;
    port: number;
    workflowRef: string;
    sha: string;
    runId?: string;
    dropExchange?: (body: { epoch: string; events: RunnerEvent[] }) => boolean;
  },
) {
  const origin = tunnelOrigin(options.origin);
  const response = await fetch(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('GitHub Actions signing keys are unavailable.');
  const { keys } = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
  function trusted(authorization: string | undefined) {
    try {
      const match = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(authorization || '');
      if (!match || authorization!.length > 8000) return false;
      const [, header, payload, signature] = match;
      const { kid, alg } = decode(header);
      const jwk = keys.find((entry) => entry.kid === kid && entry.kty === 'RSA');
      if (alg !== 'RS256' || !jwk) return false;
      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const data = Buffer.from(`${header}.${payload}`);
      if (!verify('RSA-SHA256', data, publicKey, Buffer.from(signature, 'base64url'))) return false;
      const claims = decode(payload);
      const now = Date.now() / 1000;
      return (
        claims.iss === issuer &&
        claims.aud === origin &&
        claims.nbf <= now &&
        claims.exp > now &&
        claims.workflow_ref === options.workflowRef &&
        claims.sha === options.sha &&
        (!options.runId || claims.run_id === options.runId) &&
        claims.event_name === 'workflow_dispatch' &&
        claims.runner_environment === 'github-hosted'
      );
    } catch {
      return false;
    }
  }

  const edgeStore = new Store(':memory:');
  const identity = new DesktopIdentity(edgeStore, origin);
  const owner = { id: 'test-windows-owner', name: 'Windows fixture owner' };
  const verifier = key();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const request = identity.authorize(challenge, 'Windows fixture device', '127.0.0.1');
  identity.approve(request.userCode, owner);
  const desktop = identity.token(request.deviceCode, verifier)!;
  const desktopSecret = key();
  const bridgeKey = key();
  const localApp = await buildApp(workspace, { desktopSecret });
  const edge = Fastify();
  const runnerAuthorization = `Bearer ${node.token}`;
  let provisioned = false;
  let verified = false;
  let acknowledged = false;
  let stopping = false;
  let failure: unknown;
  edge.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'POST' && pathname === bootstrapPath) return;
    if (request.method !== 'POST' || ![exchangePath, statusPath].includes(pathname))
      return reply.code(404).send({ error: 'Fixture route unavailable.' });
    if (!safeEqual(request.headers.authorization || '', runnerAuthorization))
      return reply.code(403).send({ error: 'Fixture machine authorization required.' });
  });
  edge.post(statusPath, { bodyLimit: 256 }, async () => {
    if (verified) acknowledged = true;
    return { verified };
  });
  if (options.dropExchange) {
    edge.addHook('preHandler', async (request, reply) => {
      if (
        request.url.split('?')[0] === exchangePath &&
        options.dropExchange!(request.body as { epoch: string; events: RunnerEvent[] })
      ) {
        // Cut the actual origin socket before the desktop bridge forwards the receipt.
        reply.hijack();
        request.raw.socket.destroy();
      }
    });
  }
  edge.post(bootstrapPath, { bodyLimit: 256 }, async (request, reply) => {
    if (provisioned || !trusted(request.headers.authorization))
      return reply.code(403).send({ error: enrollmentRequired });
    provisioned = true;
    reply.header('Cache-Control', 'no-store');
    return {
      projectId,
      id: node.id,
      token: node.token,
      bridgeKey,
      exchangeUrl: `${origin}${exchangePath}?host=${desktop.deviceId}`,
    };
  });
  registerDesktopRoutes(edge, identity, () => owner);
  let pump: Promise<void> | undefined;
  async function close() {
    stopping = true;
    identity.close();
    await pump;
    await edge.close();
    await localApp.close();
    edgeStore.close();
  }
  try {
    await edge.listen({ host: '127.0.0.1', port: options.port });
    const denied = await edge.inject({ method: 'POST', url: bootstrapPath });
    assert.equal(denied.statusCode, 403);
    pump = (async () => {
      let responses: { id: string; status: number; body: unknown }[] = [];
      while (!stopping) {
        const device = identity.authenticate(`Bearer ${desktop.accessToken}`);
        const exchange = await identity.poll(device, bridgeKey, responses);
        responses = [];
        for (const request of exchange.requests) {
          const result = await localApp.inject({
            method: 'POST',
            url: '/api/runner/exchange',
            payload: request.body as object,
            headers: {
              host: '127.0.0.1:4317',
              authorization: request.authorization,
              'x-relay-desktop': desktopSecret,
            },
          });
          responses.push({ id: request.id, status: result.statusCode, body: result.json() });
        }
      }
    })().catch((error) => {
      failure = error;
    });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    async finish() {
      verified = true;
      for (let attempt = 0; attempt < 20 && !acknowledged; attempt++) await wait(500);
      assert.ok(acknowledged, 'macOS fixture must acknowledge the completed round trip');
    },
    async ready() {
      console.log(`Cross-host fixture waiting at ${origin}`);
      const deadline = Date.now() + 480_000;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        const runner = workspace.runners.list().find((item) => item.id === node.id);
        if (runner?.online && runner.execution) return runner.execution;
        await wait(200);
      }
      throw new Error('The macOS fixture has not joined the project.');
    },
  };
}

export async function runCrossHostMac(url: string) {
  assert.equal(process.platform, 'darwin');
  const origin = tunnelOrigin(url);
  const deadline = Date.now() + 90_000;
  // Wait for the fixture's JSON response; an intermediary can also return a 403.
  for (;;) {
    const probe = await fetch(origin + bootstrapPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    }).catch(() => undefined);
    if (
      probe?.status === 403 &&
      (await probe.json().catch(() => null))?.error === enrollmentRequired
    )
      break;
    if (Date.now() >= deadline)
      throw new Error(
        `Fixture origin did not become ready (last HTTP status ${probe?.status ?? 'unreachable'}).`,
      );
    await wait(1500);
  }
  const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL!);
  tokenUrl.searchParams.set('audience', origin);
  const oidc = await fetch(tokenUrl, {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!oidc.ok) throw new Error('Unable to obtain the fixture CI identity.');
  const token = (await oidc.json()).value;
  const response = await fetch(`${origin}${bootstrapPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Fixture enrollment was rejected (${response.status}).`);
  const { projectId, id, token: runnerToken, bridgeKey, exchangeUrl } = await response.json();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'Kivuno Mac fixture-'));
  const config: RunnerConfig = {
    origin,
    token: runnerToken,
    id,
    dataDir,
    slots: 1,
    maxLoad: 1000,
    minFreeMB: 0,
    bridgeKey,
    exchangeUrl,
    executionGrant: {
      id: randomUUID(),
      projectId,
      fullAccess: true,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
    },
  };
  const running = runMachine(config);
  const watchdog = setTimeout(() => process.emit('SIGTERM'), 180_000);
  try {
    const deadline = Date.now() + 165_000;
    while (Date.now() < deadline) {
      const complete = await fetch(`${origin}${statusPath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runnerToken}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!complete.ok) throw new Error(`Fixture status was rejected (${complete.status}).`);
      if ((await complete.json()).verified) {
        console.log(
          JSON.stringify({
            platform: process.platform,
            arch: process.arch,
            result: 'round-trip-verified',
          }),
        );
        return;
      }
      await wait(1500);
    }
    throw new Error('Windows did not verify the paired transfer before the deadline.');
  } finally {
    clearTimeout(watchdog);
    process.emit('SIGTERM');
    await running;
    assert.equal(path.dirname(dataDir), os.tmpdir());
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}
