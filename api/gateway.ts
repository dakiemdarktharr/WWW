import type { IncomingMessage, ServerResponse } from 'node:http';
import { cloudRunner, forgetCloudRunner } from '../cloud/runner.ts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { waitUntil } from '@vercel/functions';
import { sadeProjectFileRoute } from '../shared/sade-project.ts';
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
  return url;
}

class HostedSadeDeadline extends Error {}

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
      url.pathname === sharedSadeCloudFinishPath
    ) {
      response.writeHead(403).end(JSON.stringify({ error: 'This maintenance route is private.' }));
      return;
    }
    if (url.pathname === '/api/desktop/release' && method === 'GET') {
      let release = {
        version: '0.9.2',
        releases: ['0.9.2'],
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
    if (
      (incomingOrigin && incomingOrigin !== publicOrigin) ||
      (!['GET', 'HEAD'].includes(method) && incomingOrigin !== publicOrigin)
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
      machine ||
      url.pathname === '/api/desktop/profiles' ||
      url.pathname === '/api/billing/profiles/select'
        ? 4 * 1024 * 1024
        : url.pathname === sadeProjectFileRoute
          ? 768 * 1024
          : 128 * 1024;
    let length = 0;
    if (!['GET', 'HEAD'].includes(method)) {
      if (request.body !== undefined) {
        const value = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.from(
              typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
            );
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
    const opening = cloudRunner(!machine);
    const runner = hosted ? await beforeSadeDeadline(opening, deadline - 150) : await opening;
    if (!runner) {
      response.writeHead(204).end();
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
    for (const key of ['cookie', 'content-type', 'x-relay-token', 'origin', 'x-relay-bridge-key']) {
      const value = request.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    if ((machine || desktop) && typeof request.headers.authorization === 'string')
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
    for (const key of ['content-type', 'cache-control', 'x-content-type-options']) {
      const value = upstream.headers.get(key);
      if (value) response.setHeader(key, value);
    }
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) response.setHeader('Set-Cookie', cookies);
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
