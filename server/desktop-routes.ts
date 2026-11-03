import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DesktopIdentity, type DesktopOwner } from './desktop-auth.ts';

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const code = z.string().regex(/^[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}$/);
export function registerDesktopRoutes(
  app: FastifyInstance,
  identity: DesktopIdentity,
  browserOwner: (request: FastifyRequest) => DesktopOwner,
) {
  app.post('/api/desktop/authorize', async (request) => {
    const input = z
      .object({ challenge: proof, name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(request.body);
    return identity.authorize(input.challenge, input.name, request.ip);
  });
  app.post('/api/desktop/token', async (request, reply) => {
    const input = z
      .object({ deviceCode: proof, verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) })
      .strict()
      .parse(request.body);
    const token = identity.token(input.deviceCode, input.verifier);
    return token || reply.code(202).send({ status: 'authorization_pending' });
  });
  app.get('/api/desktop/request', async (request) => {
    const query = z.object({ code }).strict().parse(request.query);
    const grant = identity.request(query.code, browserOwner(request));
    return {
      name: grant.name,
      userCode: grant.code,
      expiresAt: new Date(grant.expires).toISOString(),
      approved: grant.approved,
    };
  });
  app.post('/api/desktop/approve', async (request) =>
    identity.approve(
      z.object({ userCode: code }).strict().parse(request.body).userCode,
      browserOwner(request),
    ),
  );
  app.get('/api/desktop/me', async (request) =>
    identity.publicDevice(identity.authenticate(request.headers.authorization)),
  );
  app.post('/api/desktop/revoke', async (request) =>
    identity.revoke(identity.authenticate(request.headers.authorization)),
  );
  app.post('/api/desktop/bridge/poll', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const input = z
      .object({
        bridgeKey: z.string().min(43).max(128),
        responses: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                status: z.number().int().min(200).max(599),
                body: z.unknown(),
              })
              .strict(),
          )
          .max(8),
      })
      .strict()
      .parse(request.body);
    return identity.poll(
      identity.authenticate(request.headers.authorization),
      input.bridgeKey,
      input.responses,
    );
  });
  app.post(
    '/api/desktop/bridge/exchange',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const host = z.object({ host: z.string().uuid() }).strict().parse(request.query).host;
      const key = z.string().min(43).max(128).parse(request.headers['x-relay-bridge-key']);
      const authorization = z
        .string()
        .regex(/^Bearer [A-Za-z0-9_-]{43}$/)
        .parse(request.headers.authorization);
      const result = await identity.exchange(host, key, authorization, request.body);
      return reply.code(result.status).send(result.body);
    },
  );
  app.addHook('onClose', async () => identity.close());
}
