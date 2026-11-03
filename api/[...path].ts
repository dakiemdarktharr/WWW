import type { IncomingMessage, ServerResponse } from 'node:http';
import { cloudRunner, forgetCloudRunner } from '../cloud/runner.ts';

export default async function handler(
  request: IncomingMessage & { body?: unknown },
  response: ServerResponse,
) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(request.url || '/', 'https://workspace.invalid');
    if (!/^\/api\/[a-zA-Z0-9/-]+$/.test(url.pathname) || url.pathname.includes('//')) {
      response.writeHead(400).end(JSON.stringify({ error: 'Invalid workspace route.' }));
      return;
    }
    const method = request.method || 'GET';
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      response.writeHead(405).end();
      return;
    }
    const publicOrigin = process.env.RELAY_PUBLIC_ORIGIN;
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
          if (length > 128 * 1024) break;
          chunks.push(value);
        }
      if (length > 128 * 1024) {
        response.writeHead(413).end();
        return;
      }
    }
    const runner = await cloudRunner();
    const headers = new Headers({ 'X-Relay-Gateway': runner.secret });
    for (const key of ['cookie', 'content-type', 'x-relay-token', 'origin']) {
      const value = request.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    // No automatic retry: a failed mutation may already have reached the runner.
    const upstream = await fetch(`${runner.origin}${url.pathname}${url.search}`, {
      method,
      headers,
      redirect: 'manual',
      ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}),
      signal: AbortSignal.timeout(url.pathname === '/api/events' ? 240000 : 180000),
    });
    response.statusCode = upstream.status;
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
  } catch {
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
