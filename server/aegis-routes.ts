import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AegisReceiptBundle } from '../shared/aegis.ts';
import { Aegis } from './aegis.ts';

/** Mount behind the same authenticated session + CSRF guard as the workspace. */
export function registerAegisRoutes(app: FastifyInstance, aegis: Aegis) {
  const projectId = z.string().uuid();
  const machineId = z.union([z.literal('local'), z.string().uuid()]);
  const params = (request: { params: unknown }) =>
    z.object({ id: z.string().uuid() }).parse(request.params).id;
  app.get('/api/aegis', () => aegis.status());
  app.post('/api/aegis/setup', async (request) => {
    z.object({}).strict().parse(request.body);
    return aegis.setup();
  });
  app.post('/api/aegis/deploy', async (request) => {
    z.object({}).strict().parse(request.body);
    return aegis.deploy();
  });
  app.post('/api/aegis/recover', async (request) => {
    z.object({}).strict().parse(request.body);
    return aegis.recover();
  });
  app.post('/api/aegis/projects', async (request) => {
    const input = z.object({ projectId, enabled: z.boolean() }).strict().parse(request.body);
    return aegis.setProject(input.projectId, input.enabled);
  });
  app.post('/api/aegis/grants', async (request) => {
    const input = z
      .object({
        projectId,
        machineId,
        permissions: z.union([z.literal(1), z.literal(3)]),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .parse(request.body);
    return aegis.setGrant(input.projectId, input.machineId, input.permissions, input.expiresAt);
  });
  app.post('/api/aegis/revoke', async (request) => {
    const input = z.object({ projectId, machineId }).strict().parse(request.body);
    return aegis.setGrant(input.projectId, input.machineId, 0, 0);
  });
  app.post('/api/aegis/approve-merge', async (request) => {
    const input = z
      .object({ taskId: z.string().uuid(), payloadDigest: z.string().regex(/^0x[\da-f]{64}$/i) })
      .strict()
      .parse(request.body);
    return aegis.approveMerge(input.taskId, input.payloadDigest);
  });
  app.get('/api/aegis/merge-preview', (request) =>
    aegis.mergePreview(z.object({ taskId: z.string().uuid() }).parse(request.query).taskId),
  );
  app.post('/api/aegis/receipts/:id/anchor', (request) => aegis.anchorReceipt(params(request)));
  app.get('/api/aegis/receipts/:id/export', (request, reply) => {
    reply.header(
      'Content-Disposition',
      `attachment; filename="relay-aegis-${params(request)}.json"`,
    );
    return aegis.exportReceipt(params(request));
  });
  app.post('/api/aegis/verify', async (request) => {
    const receipt = z
      .object({
        id: z.string().uuid(),
        projectId: z.string().uuid(),
        handoffId: z.string().uuid(),
        digest: z.string().regex(/^0x[\da-f]{64}$/i),
        signer: z.string().regex(/^0x[\da-f]{40}$/i),
        signature: z.string().max(512),
        contractAddress: z.string().regex(/^0x[\da-f]{40}$/i),
        projectKey: z.string().regex(/^0x[\da-f]{64}$/i),
        receiptKey: z.string().regex(/^0x[\da-f]{64}$/i),
        chainId: z.literal(43113),
        status: z.enum(['signed', 'anchoring', 'anchored', 'uncertain']),
        transactionHash: z.string().nullable(),
        createdAt: z.string(),
      })
      .strict();
    const { bundle } = z
      .object({
        bundle: z
          .object({ version: z.literal(1), receipt, payload: z.record(z.string(), z.unknown()) })
          .strict(),
      })
      .strict()
      .parse(request.body);
    return aegis.verify(bundle as AegisReceiptBundle);
  });
}
