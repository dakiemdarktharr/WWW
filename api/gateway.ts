import type { IncomingMessage, ServerResponse } from 'node:http';
import { cloudRunner, forgetCloudRunner } from '../cloud/runner.ts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { waitUntil } from '@vercel/functions';
import { sadeProjectFileRoute } from '../shared/sade-project.ts';
import { sadeDeckRoute, sadeDeckFinishRoute } from '../shared/sade-deck.ts';
import { settleSadeDeck } from '../cloud/sade-deck.ts';
import {
  claudeAuthorizePath,
  claudeChallenge,
  claudeIssuerMetadataPath,
  claudeMetadata,
  claudeResourceMetadataPath,
  claudeTokenPath,
  isClaudeOAuthPublicEndpoint,
} from '../shared/claude-discovery.ts';
import {
  claudeMcpPath,
  claudeWebControlPath,
  claudeConnectorOrigin,
  claudeWebBearer,
} from '../shared/claude-web.ts';
import {
  sharedSadeCloudExtended,
  sharedSadeCloudFinishPath,
  sharedSadeCloudHeader,
} from '../shared/sade-cloud.ts';
import {
  type HostedSadeTiming,
  hostedSadeBudgetMs,
  settleHostedSade,
  usesHostedSade,
} from '../cloud/shared-sade-gateway.ts';

export function gatewayTarget(requestUrl: string) {
  const url = new URL(requestUrl, 'https://workspace.invalid');
  const route = url.searchParams.get('relay_path');
  if (route !== null) {
    url.pathname = `/api/${route}`;
    url.searchParams.delete('relay_path');
  }
  // Vercel also forwards the named :path* capture as query metadata.
  // Strip only that capture; preserve application parameters for strict validation.
  if (url.searchParams.get('path') === url.pathname.slice('/api/'.length))
    url.searchParams.delete('path');
  if ([claudeResourceMetadataPath, '/.well-known/oauth-protected-resource'].includes(url.pathname))
    url.pathname = '/api/claude/resource-metadata';
  if (url.pathname === claudeIssuerMetadataPath) url.pathname = '/api/claude/issuer-metadata';
  return url;
}

class HostedSadeDeadline extends Error {}

export function claudeBackgroundRequest(pathname: string, method: string, body: Buffer) {
  if (pathname !== claudeWebControlPath || method !== 'POST') return false;
  try {
    const input = JSON.parse(body.toString('utf8'));
    if (input?.action === 'poll' && Object.keys(input).length === 1) return 'poll';
    if (input?.action === 'account-status' && Object.keys(input).length === 2) {
      const id = input.memberId ?? input.connectionId;
      if (
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        return 'account-status';
    }
    return false;
  } catch {
    return false;
  }
}

async function beforeSadeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new HostedSadeDeadline()),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(
  request: IncomingMessage & { body?: unknown },
  response: ServerResponse,
) {
  const requestStarted = Date.now();
  let hosted = false;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = gatewayTarget(request.url || '/');
    if (!/^\/api\/[a-zA-Z0-9/-]+$/.test(url.pathname) || url.pathname.includes('//')) {
      response.writeHead(400).end(JSON.stringify({ error: 'Invalid workspace route.' }));
      return;
    }
    const method = request.method || 'GET';
    if (
      url.pathname === '/api/cloud/prepare-upgrade' ||
      url.pathname === sadeDeckFinishRoute ||
      url.pathname === sharedSadeCloudFinishPath
    ) {
      response.writeHead(403).end(JSON.stringify({ error: 'This maintenance route is private.' }));
      return;
    }
    if (url.pathname === '/api/desktop/release' && method === 'GET') {
      let release = {
        version: '0.9.9',
        releases: ['0.9.9'],
        available: false,
        platform: 'win32-x64',
        signed: false,
      };
      try {
        release = JSON.parse(
          await readFile(path.join(process.cwd(), '.cloud', 'release.json'), 'utf8'),
        );
      } catch {}
      response
        .writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        })
        .end(JSON.stringify(release));
      return;
    }
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      response.writeHead(405).end();
      return;
    }
    const publicOrigin = process.env.RELAY_PUBLIC_ORIGIN;
    // Only the active production alias may wake or upgrade the shared identity
    // sandbox. Preview/immutable deployment URLs must never replace it with an
    // older revision. Do not trust a caller-supplied forwarded-host header.
    if (!publicOrigin || request.headers.host !== new URL(publicOrigin).host) {
      response.writeHead(403).end(
        JSON.stringify({
          error: 'Use the canonical RELAY website for sign-in and machine connections.',
        }),
      );
      return;
    }
    const incomingOrigin = request.headers.origin;
    const issuerMetadata = url.pathname === '/api/claude/issuer-metadata';
    if (issuerMetadata || url.pathname === '/api/claude/resource-metadata') {
      if (!['GET', 'HEAD'].includes(method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      response
        .writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        .end(
          method === 'HEAD'
            ? undefined
            : JSON.stringify(claudeMetadata(publicOrigin, issuerMetadata)),
        );
      return;
    }
    const oauthPublic = isClaudeOAuthPublicEndpoint(url.pathname);
    if (
      oauthPublic &&
      (!claudeConnectorOrigin(incomingOrigin) ||
        method !== (url.pathname === claudeAuthorizePath ? 'GET' : 'POST') ||
        (url.pathname !== claudeAuthorizePath && url.search))
    ) {
      response.writeHead(403).end(JSON.stringify({ error: 'Invalid connector sign-in request.' }));
      return;
    }
    const connector = url.pathname === claudeMcpPath;
    if (connector) {
      if (
        url.search ||
        !claudeConnectorOrigin(incomingOrigin) ||
        !['GET', 'POST', 'DELETE'].includes(method)
      ) {
        response.writeHead(403).end(JSON.stringify({ error: 'Invalid Claude connector request.' }));
        return;
      }
      if (!claudeWebBearer.test(request.headers.authorization || '')) {
        response
          .writeHead(401, { 'WWW-Authenticate': claudeChallenge(publicOrigin) })
          .end(JSON.stringify({ error: 'A Claude connector credential is required.' }));
        return;
      }
    }
    if (
      !connector &&
      !oauthPublic &&
      ((incomingOrigin && incomingOrigin !== publicOrigin) ||
        (!['GET', 'HEAD'].includes(method) && incomingOrigin !== publicOrigin))
    ) {
      response
        .writeHead(403)
        .end(JSON.stringify({ error: 'Cross-origin requests are not allowed.' }));
      return;
    }
    const chunks: Buffer[] = [];
    const machine =
      url.pathname === '/api/runner/exchange' || url.pathname.startsWith('/api/desktop/bridge/');
    const desktop = url.pathname.startsWith('/api/desktop/');
    const bodyLimit =
      connector || oauthPublic
        ? 16384
        : url.pathname === claudeWebControlPath
          ? 450000
          : machine ||
              url.pathname === '/api/desktop/profiles' ||
              url.pathname === '/api/billing/profiles/select'
            ? 4 * 1024 * 1024
            : url.pathname === sadeProjectFileRoute
              ? 768 * 1024
              : 128 * 1024;
    let length = 0;
    if (!['GET', 'HEAD'].includes(method)) {
      if (request.body !== undefined) {
        let parsedBody = request.body;
        if (
          url.pathname === claudeTokenPath &&
          request.headers['content-type']?.split(';')[0] === 'application/x-www-form-urlencoded' &&
          typeof parsedBody === 'object' &&
          parsedBody !== null &&
          !Buffer.isBuffer(parsedBody)
        ) {
          const form = new URLSearchParams();
          for (const [key, value] of Object.entries(parsedBody)) {
            if (typeof value !== 'string') {
              response.writeHead(400).end();
              return;
            }
            form.append(key, value);
          }
          parsedBody = form.toString();
        }
        const value = Buffer.isBuffer(parsedBody)
          ? parsedBody
          : Buffer.from(typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody));
        chunks.push(value);
        length = value.length;
      } else
        for await (const chunk of request) {
          const value = Buffer.from(chunk);
          length += value.length;
          if (length > bodyLimit) break;
          chunks.push(value);
        }
      if (length > bodyLimit) {
        response.writeHead(413).end();
        return;
      }
    }
    const body = Buffer.concat(chunks);
    hosted = url.pathname === '/api/desktop/groups' && method === 'POST' && usesHostedSade(body);
    const planningBudget = hostedSadeBudgetMs(body);
    const deadline = requestStarted + planningBudget;
    const background = claudeBackgroundRequest(url.pathname, method, body);
    const opening = cloudRunner(!machine && !connector && !oauthPublic && !background);
    const runner = hosted ? await beforeSadeDeadline(opening, deadline - 150) : await opening;
    if (!runner) {
      if (background === 'poll') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"jobs":[]}');
        return;
      }
      response
        .writeHead(connector || oauthPublic || background === 'account-status' ? 503 : 204)
        .end();
      return;
    }
    const headers = new Headers({ 'X-Relay-Gateway': runner.secret });
    if (hosted)
      headers.set(sharedSadeCloudHeader, planningBudget > 2_100 ? sharedSadeCloudExtended : '1');
    // Vercel overwrites this header at its edge. Never forward a caller's
    // x-relay-client-ip header or an arbitrary proxy chain into account limits.
    const platformIp = process.env.VERCEL
      ? request.headers['x-vercel-forwarded-for']
      : request.socket.remoteAddress;
    if (typeof platformIp === 'string' && isIP(platformIp))
      headers.set('x-relay-client-ip', platformIp);
    for (const key of oauthPublic
      ? ['content-type', 'accept', 'origin']
      : connector
        ? ['content-type', 'accept', 'origin', 'mcp-session-id', 'mcp-protocol-version']
        : ['cookie', 'content-type', 'x-relay-token', 'origin', 'x-relay-bridge-key']) {
      const value = request.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    if ((machine || desktop || connector) && typeof request.headers.authorization === 'string')
      headers.set('authorization', request.headers.authorization);
    // No automatic retry: a failed mutation may already have reached the runner.
    const upstream = await fetch(`${runner.origin}${url.pathname}${url.search}`, {
      method,
      headers,
      redirect: 'manual',
      ...(!['GET', 'HEAD'].includes(method) ? { body } : {}),
      signal: AbortSignal.timeout(
        hosted
          ? Math.max(1, deadline - Date.now())
          : url.pathname === '/api/events'
            ? 240000
            : 180000,
      ),
    });
    response.statusCode = upstream.status;
    if (url.pathname === sadeDeckRoute && method === 'POST' && upstream.ok) {
      const { work, ...publicResult } = (await upstream.json()) as Record<string, unknown>;
      if (work)
        waitUntil(
          settleSadeDeck(work, runner.origin, headers).catch(() => {
            console.error('A PowerPoint job could not save its result. The lease will expire.');
          }),
        );
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(publicResult));
      return;
    }
    if (connector && upstream.status === 401)
      response.setHeader('WWW-Authenticate', claudeChallenge(publicOrigin));
    if (url.pathname === claudeAuthorizePath && [302, 303].includes(upstream.status)) {
      const rawLocation = upstream.headers.get('location');
      const target = rawLocation && new URL(rawLocation, publicOrigin);
      if (!target || target.origin !== publicOrigin || target.pathname !== '/claude/connect') {
        response.writeHead(502).end();
        return;
      }
      response.setHeader('Location', target.pathname + target.search);
    }
    if (hosted && upstream.ok) {
      const admitted = Date.now();
      const timing: HostedSadeTiming = {};
      const decision = await settleHostedSade(
        upstream,
        runner.origin,
        headers,
        deadline,
        timing,
        waitUntil,
      );
      response.setHeader('Content-Type', 'application/json');
      response.setHeader(
        'Server-Timing',
        [
          `sade_admission;dur=${admitted - requestStarted}`,
          ...(timing.groundingMs === undefined ? [] : [`sade_grounding;dur=${timing.groundingMs}`]),
          ...(timing.providerMs === undefined ? [] : [`sade_provider;dur=${timing.providerMs}`]),
          ...(timing.receiptMs === undefined ? [] : [`sade_receipt;dur=${timing.receiptMs}`]),
          `sade_total;dur=${Date.now() - requestStarted}`,
        ].join(', '),
      );
      response.end(JSON.stringify(decision));
      return;
    }
    for (const key of [
      'content-type',
      'cache-control',
      'x-content-type-options',
      ...(connector ? ['mcp-session-id', 'allow'] : []),
    ]) {
      const value = upstream.headers.get(key);
      if (value) response.setHeader(key, value);
    }
    const cookies = upstream.headers.getSetCookie();
    if (!connector && !oauthPublic && cookies.length) response.setHeader('Set-Cookie', cookies);
    if (!upstream.body || method === 'HEAD') {
      response.end();
      return;
    }
    response.flushHeaders();
    const reader = upstream.body.getReader();
    response.on('close', () => {
      void reader.cancel().catch(() => {});
    });
    while (!response.destroyed) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!response.write(value))
        await new Promise<void>((resolve) => {
          response.once('drain', resolve);
          response.once('close', resolve);
        });
    }
    response.end();
  } catch (error) {
    if (
      !response.headersSent &&
      hosted &&
      (error instanceof HostedSadeDeadline ||
        (error instanceof DOMException && error.name === 'TimeoutError'))
    ) {
      response.writeHead(503, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error:
            'Chưa xác nhận được yêu cầu Sade trong thời gian cho phép. Hãy kiểm tra nhóm trước khi gửi lại.',
          code: 'SADE_NETWORK_TIMEOUT',
        }),
      );
      return;
    }
    forgetCloudRunner();
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        error:
          'Cloud runner đang khởi động, tạm ngủ hoặc đã hết hạn mức miễn phí. Thử lại sau; thao tác chưa rõ kết quả sẽ không tự gửi lại.',
        code: 'CLOUD_UNAVAILABLE',
      }),
    );
  }
}
