import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { safeEqual } from './security.ts';
import type { DynamicTool } from './codex.ts';

/** Loopback MCP endpoint scoped to one owned subprocess; no browser or network principals. */
export class GeminiTools {
  private server: Server | null = null;
  private token = randomBytes(32).toString('base64url');
  constructor(
    private tools: () => readonly DynamicTool[],
    private invoke: (name: string, args: unknown) => Promise<unknown>,
  ) {}
  async start() {
    this.server = createServer(async (request, response) => {
      if (
        request.method !== 'POST' ||
        request.url !== '/mcp' ||
        request.headers.origin ||
        !safeEqual(String(request.headers.authorization || ''), `Bearer ${this.token}`)
      ) {
        response.writeHead(403).end();
        return;
      }
      let raw = '',
        rpc: any;
      try {
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 128_000) throw new Error('MCP request is too large.');
        }
        rpc = JSON.parse(raw);
        if (rpc.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        let result: unknown;
        if (rpc.method === 'initialize')
          result = {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'kivuno-session', version: '1.0.0' },
          };
        else if (rpc.method === 'ping') result = {};
        else if (rpc.method === 'tools/list')
          result = { tools: this.tools().map(({ type, ...tool }) => tool) };
        else if (rpc.method === 'tools/call') {
          if (!this.tools().some((tool) => tool.name === rpc.params?.name))
            throw new Error('Tool not available in this conversation.');
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  await this.invoke(rpc.params.name, rpc.params.arguments || {}),
                ),
              },
            ],
          };
        } else throw new Error('Unsupported MCP method.');
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      } catch (error) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc?.id ?? null,
            error: { code: -32602, message: (error as Error).message },
          }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Cannot bind the session tool bridge.');
    return {
      type: 'http',
      name: 'kivuno',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${this.token}` }],
    };
  }
  async close() {
    if (!this.server) return;
    this.token = randomBytes(32).toString('base64url');
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
