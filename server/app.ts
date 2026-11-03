import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Activity, Member, Project, Task, Workflow } from '../shared/types.ts';
import { DomainError } from './store.ts';
import { Workspace } from './service.ts';
import { inside, normalizeScope, redact, safeEqual, secret } from './security.ts';
import { fromNodeHeaders } from 'better-auth/node';
import type { CloudAccess } from './cloud-auth.ts';
import { readModels } from './codex.ts';
import { createHackathonProject } from './hackathons.ts';
import { DesktopIdentity } from './desktop-auth.ts';
import { registerDesktopRoutes } from './desktop-routes.ts';
import { registerAegisRoutes } from './aegis-routes.ts';

const text = z.string().trim().min(1).max(200);
const id = z.string().uuid();
const scopePath = z
  .string()
  .max(500)
  .superRefine((value, ctx) => {
    try {
      normalizeScope(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
    }
  });
const taskInput = z
  .object({
    projectId: id,
    title: text,
    description: z.string().max(16000).default(''),
    kind: z.enum(['code', 'research', 'design', 'review']).default('code'),
    priority: z.enum(['high', 'medium', 'low']).default('medium'),
    scope: z.array(scopePath).max(50).default(['.']),
    dependsOn: z.array(id).max(50).default([]),
    acceptance: z.string().max(8000).default(''),
    assignedTo: id.nullable().optional(),
    status: z.enum(['ready', 'backlog']).default('ready'),
  })
  .strict();
type Session = { token: string; expires: number };
export async function buildApp(
  workspace: Workspace,
  options: {
    port?: number;
    development?: boolean;
    distDir?: string;
    cloud?: CloudAccess;
    desktopSecret?: string;
  } = {},
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 128 * 1024,
    requestTimeout: 30000,
    forceCloseConnections: true,
  });
  const eventConnections = new Set<() => void>();
  const sessions = new Map<string, Session>();
  const mutations = new WeakSet<FastifyRequest>();
  let activeMutations = 0;
  let upgradeDrain: Promise<void> | null = null;
  const desktopIdentity = options.cloud
    ? new DesktopIdentity(workspace.store, options.cloud.origin)
    : undefined;
  let bridgeConnection: { origin: string; exchangeUrl: string; bridgeKey: string } | undefined;
  const port = options.port || 4317;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (options.development) {
    allowed.add('http://127.0.0.1:5173');
    allowed.add('http://localhost:5173');
  }
  const sessionFor = (request: FastifyRequest) => {
    const value = request.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('relay_session='))
      ?.slice(14);
    return value ? sessions.get(value) : undefined;
  };
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https: http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const host = request.headers.host,
      origin = request.headers.origin;
    const cloud = options.cloud;
    const pathname = request.url.split('?')[0];
    if (
      options.desktopSecret &&
      !safeEqual(String(request.headers['x-relay-desktop'] || ''), options.desktopSecret)
    )
      return reply.code(403).send({ error: 'Open this workspace in RELAY Desktop.' });
    if (cloud) {
      const gateway = request.headers['x-relay-gateway'];
      if (typeof gateway !== 'string' || !safeEqual(gateway, cloud.gatewaySecret))
        return reply.code(403).send({ error: 'Use the authenticated workspace gateway.' });
      if (origin && origin !== cloud.origin)
        return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
      if (!['GET', 'HEAD'].includes(request.method) && origin !== cloud.origin)
        return reply.code(403).send({ error: 'A verified workspace origin is required.' });
      if (pathname.startsWith('/api/auth/') || pathname === '/api/cloud/health') return;
      if (pathname === '/api/cloud/prepare-upgrade') return;
      if (
        [
          '/api/desktop/authorize',
          '/api/desktop/token',
          '/api/desktop/bridge/exchange',
          '/api/desktop/release',
        ].includes(pathname)
      )
        return;
      if (
        ['/api/desktop/me', '/api/desktop/revoke', '/api/desktop/bridge/poll'].includes(pathname)
      ) {
        desktopIdentity!.authenticate(request.headers.authorization);
        return;
      }
      if (pathname === '/api/runner/exchange') {
        workspace.runners.authenticate(request.headers.authorization);
        return;
      }
      if (!(await cloud.auth.authorized(request.headers)))
        return reply
          .code(401)
          .send({ error: 'Sign in to your cloud workspace.', code: 'CLOUD_SIGN_IN_REQUIRED' });
    }
    if (!cloud && (!host || !allowed.has(`http://${host}`)))
      return reply.code(403).send({ error: 'RELAY only accepts requests to its local address.' });
    if (!cloud && origin && !allowed.has(origin))
      return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
    // A user following the hosted launcher must be able to open the local SPA.
    // This exception never applies to API calls, subresources, frames or mutations.
    const userDocumentNavigation =
      request.method === 'GET' &&
      request.url.split('?')[0] === '/' &&
      request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document' &&
      request.headers['sec-fetch-user'] === '?1';
    if (!cloud && request.headers['sec-fetch-site'] === 'cross-site' && !userDocumentNavigation)
      return reply.code(403).send({ error: 'Cross-site requests are not allowed.' });
    if (!cloud && options.desktopSecret && pathname === '/api/desktop/bridge-config') {
      if (!safeEqual(String(request.headers['x-relay-control'] || ''), options.desktopSecret))
        return reply
          .code(403)
          .send({ error: 'Only the desktop host can configure its connection.' });
      return;
    }
    if (!cloud && options.desktopSecret && pathname === '/api/runner/exchange') {
      workspace.runners.authenticate(request.headers.authorization);
      return;
    }
    if (request.url.startsWith('/api/') && request.url.split('?')[0] !== '/api/session') {
      const session = sessionFor(request);
      if (!session || session.expires < Date.now())
        return reply.code(401).send({ error: 'Your local session expired. Reload the workspace.' });
      if (!['GET', 'HEAD'].includes(request.method)) {
        const token = request.headers['x-relay-token'];
        if (typeof token !== 'string' || !safeEqual(token, session.token))
          return reply.code(403).send({ error: 'Missing or invalid local request token.' });
        if (!request.headers['content-type']?.startsWith('application/json'))
          return reply.code(415).send({ error: 'Use application/json for workspace changes.' });
      }
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/api/cloud/prepare-upgrade') return;
    if (upgradeDrain && request.url.startsWith('/api/'))
      return reply
        .code(503)
        .send({ error: 'RELAY is finishing a safe update. Retry after it restarts.' });
    if (!['GET', 'HEAD'].includes(request.method) && request.url.startsWith('/api/')) {
      mutations.add(request);
      activeMutations++;
    }
  });
  app.addHook('onResponse', async (request) => {
    if (mutations.delete(request)) activeMutations--;
  });
  if (desktopIdentity) registerDesktopRoutes(app, desktopIdentity);
  registerAegisRoutes(app, workspace.aegis);
  app.get('/api/desktop/release', async () => {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(options.distDir || 'dist', 'downloads', 'release.json'), 'utf8'),
      );
      return manifest;
    } catch {
      return { version: '0.3.0', available: false, platform: 'win32-x64', signed: false };
    }
  });
  if (options.desktopSecret)
    app.post('/api/desktop/bridge-config', async (request) => {
      const input = z
        .object({ url: z.string().url().max(500), key: z.string().min(43).max(128) })
        .strict()
        .parse(request.body);
      const url = new URL(input.url);
      const allowedProtocol =
        url.protocol === 'https:' ||
        (options.development && url.protocol === 'http:' && url.hostname === '127.0.0.1');
      if (
        !allowedProtocol ||
        url.username ||
        url.password ||
        url.pathname !== '/api/desktop/bridge/exchange' ||
        !z.string().uuid().safeParse(url.searchParams.get('host')).success
      )
        throw new DomainError('Use a verified RELAY desktop connection.', 400);
      bridgeConnection = { origin: url.origin, exchangeUrl: url.href, bridgeKey: input.key };
      return { configured: true };
    });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    const e = error as Error & { statusCode?: number };
    const status = error instanceof DomainError ? error.status : e.statusCode || 500;
    reply.code(status).send({ error: redact(e.message || 'The request could not be completed.') });
  });
  if (options.cloud) {
    const cloud = options.cloud;
    app.post('/api/cloud/prepare-upgrade', async (request) => {
      z.object({}).strict().parse(request.body);
      if (!upgradeDrain) {
        const busy =
          workspace.store.tasks().some((task) => task.status === 'running') ||
          workspace.store
            .sessions()
            .some((session) =>
              ['starting', 'running', 'awaiting_approval'].includes(session.status),
            ) ||
          workspace.store
            .all<{ status: string }>('handoff')
            .some((handoff) => handoff.status === 'checkpointing');
        if (activeMutations || workspace.mergeBusy.size || busy)
          throw new DomainError('Finish or pause active work before updating RELAY.', 409);
        upgradeDrain = workspace.close();
      }
      await upgradeDrain;
      return { ready: true };
    });
    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      async handler(request, reply) {
        const response = await cloud.auth.handler(
          new Request(new URL(request.url, cloud.origin), {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(!['GET', 'HEAD'].includes(request.method)
              ? { body: JSON.stringify(request.body ?? {}) }
              : {}),
          }),
        );
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('Set-Cookie', cookies);
        return reply.send(await response.text());
      },
    });
    app.get('/api/cloud/health', async () => ({
      ready: true,
      version: workspace.runtime.version,
      revision: process.env.RELAY_REVISION || null,
      expiresAt: cloud.expiresAt || null,
    }));
    app.addHook('onClose', async () => cloud.auth.close());
  }
  app.get('/api/session', async (request, reply) => {
    let session = sessionFor(request);
    if (!session || session.expires < Date.now()) {
      for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value!);
      const key = secret();
      session = { token: secret(), expires: Date.now() + 24 * 60 * 60 * 1000 };
      sessions.set(key, session);
      reply.header(
        'Set-Cookie',
        `relay_session=${key}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=86400${options.cloud ? '; Secure' : ''}`,
      );
    }
    return { token: session.token };
  });
  app.get('/api/state', async () => workspace.snapshot());
  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    reply.raw.write('event: connected\ndata: {}\n\n');
    let queued = false;
    const changed = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (!reply.raw.destroyed && !reply.raw.writableEnded)
          reply.raw.write('event: change\ndata: {}\n\n');
      }, 40).unref();
    };
    const ping = setInterval(() => reply.raw.write(': heartbeat\n\n'), 20000);
    ping.unref();
    workspace.store.on('change', changed);
    const cleanup = () => {
      clearInterval(ping);
      workspace.store.off('change', changed);
      eventConnections.delete(disconnect);
    };
    const disconnect = () => {
      cleanup();
      reply.raw.end();
    };
    eventConnections.add(disconnect);
    reply.raw.on('close', cleanup);
  });
  const params = (request: FastifyRequest) => z.object({ id }).parse(request.params).id;
  app.get('/api/runners', async () => workspace.runners.list());
  app.post('/api/runners', async (request) => {
    const input = z
      .object({ name: text, kind: z.enum(['computer', 'ssh']) })
      .strict()
      .parse(request.body);
    if (options.desktopSecret && !bridgeConnection)
      throw new DomainError(
        'Sign in on the web and wait for the desktop connection before pairing a machine.',
        409,
      );
    return {
      ...workspace.runners.add(input.name, input.kind),
      ...(bridgeConnection ? { connection: bridgeConnection } : {}),
    };
  });
  app.post('/api/runner/exchange', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    if (!options.cloud && !options.desktopSecret)
      throw new DomainError('Machine exchange requires the authenticated cloud gateway.', 403);
    const node = workspace.runners.authenticate(request.headers.authorization);
    const body = z
      .object({
        epoch: z.string().max(100).optional(),
        ready: z.boolean(),
        busy: z.boolean(),
        version: z.string().max(180),
        events: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                clientId: z.string().uuid(),
                type: z.enum(['result', 'notification', 'request', 'exit', 'error']),
                commandId: z.string().uuid().optional(),
                method: z.string().max(200).optional(),
                params: z.any().optional(),
                result: z.any().optional(),
                error: z.string().max(10000).optional(),
                files: z.array(z.any()).max(2000).optional(),
              })
              .strict(),
          )
          .max(40),
      })
      .strict()
      .parse(request.body);
    return workspace.runners.exchange(node.id, body);
  });
  app.post('/api/accounts/connect', async (request) => {
    const input = z.object({ runnerId: id.optional() }).strict().parse(request.body);
    if (input.runnerId) workspace.runners.assertReady(input.runnerId);
    if (workspace.loginOwner) throw new DomainError('Finish the pending Codex sign-in first.');
    let member =
      workspace.store
        .members()
        .find(
          (member) =>
            member.managed &&
            member.runnerId === input.runnerId &&
            !member.connectedAt &&
            !member.account &&
            !workspace.sessions.hasLive(member.id),
        ) || workspace.autonomy.addAccount();
    if (input.runnerId)
      member = workspace.store.updateMember(member.id, { runnerId: input.runnerId });
    const login = await workspace.login(member.id, 'device');
    return { member, login };
  });
  app.post('/api/members', async (request) => {
    const input = z
      .object({
        name: text,
        role: z.enum(['engineer', 'researcher', 'designer', 'reviewer']),
        color: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/)
          .optional(),
      })
      .strict()
      .parse(request.body);
    const member = workspace.store.addMember(input);
    workspace.log(`Added ${member.name} as ${member.role}.`, null, member.id, 'member');
    return member;
  });
  app.patch('/api/members/:id', async (request) => {
    const memberId = params(request);
    const patch = z
      .object({
        name: text.optional(),
        maxSessions: z.number().int().min(1).max(8).optional(),
        owner: z
          .object({
            login: z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/),
            name: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .regex(/^[^\r\n<>\x00]+$/),
            email: z.email().max(200),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(request.body);
    return workspace.store.updateMember(memberId, patch);
  });
  app.post('/api/members/:id/quota/refresh', async (request) =>
    workspace.quota.refresh(params(request)),
  );
  app.post('/api/members/:id/quota/grants', async (request) => {
    const grant = workspace.quota.grant(
      params(request),
      z
        .object({
          projectId: id,
          floor: z.number().int().min(0).max(49),
          expiresAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(request.body),
    );
    void workspace.inbox
      .dispatch(grant.projectId)
      .catch((error) => workspace.log(redact(error), null, null, 'error', grant.projectId));
    return grant;
  });
  app.post('/api/quota/grants/:id/revoke', async (request) =>
    workspace.quota.revoke(params(request)),
  );
  app.post('/api/sessions', async (request) =>
    workspace.sessions.create(
      z
        .object({
          memberId: id,
          projectId: id,
          taskId: id.optional(),
          title: text.optional(),
          scope: z.array(scopePath).max(50).optional(),
          readOnly: z.boolean().default(true),
          prompt: z.string().max(16000).optional(),
          model: z.string().min(1).max(200).nullable().optional(),
          reasoningEffort: z.string().min(1).max(40).nullable().optional(),
          modelPolicy: z.enum(['auto', 'manual']).optional(),
        })
        .strict()
        .parse(request.body),
    ),
  );
  app.get('/api/sessions/:id/events', async (request) =>
    workspace.sessions.events(params(request)),
  );
  app.get('/api/sessions/:id/remote-output', async (request, reply) => {
    const session = workspace.sessions.get(params(request));
    const packet = workspace.store.get('remoteRecovery', session.taskId);
    reply.header('Content-Disposition', 'attachment; filename="remote-recovery.json"');
    return packet;
  });
  app.patch('/api/sessions/:id/config', async (request) =>
    workspace.sessions.configure(
      params(request),
      z
        .object({
          model: z.string().min(1).max(200).nullable(),
          reasoningEffort: z.string().min(1).max(40).nullable(),
          modelPolicy: z.enum(['auto', 'manual']).optional(),
        })
        .strict()
        .parse(request.body),
    ),
  );
  app.get('/api/members/:id/models', async (request) =>
    readModels(await workspace.client(params(request))),
  );
  app.post('/api/hackathons', async (request) => createHackathonProject(workspace, request.body));
  app.post('/api/sessions/:id/send', async (request) =>
    workspace.sessions.send(
      params(request),
      z
        .object({ prompt: z.string().trim().min(1).max(16000) })
        .strict()
        .parse(request.body).prompt,
    ),
  );
  app.post('/api/sessions/:id/stop', async (request) => workspace.sessions.stop(params(request)));
  app.post('/api/sessions/:id/pause', async (request) =>
    workspace.sessions.interrupt(params(request), 'Paused by the human.'),
  );
  app.post('/api/sessions/:id/resume', async (request) =>
    workspace.sessions.resume(params(request)),
  );
  app.post('/api/sessions/:id/recover', async (request) =>
    workspace.sessions.recover(
      params(request),
      z
        .object({ confirmedStopped: z.literal(true) })
        .strict()
        .parse(request.body),
    ),
  );
  app.get('/api/mesh/:id/inbox', async (request) => {
    const query = z
      .object({
        memberId: id,
        after: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .strict()
      .parse(request.query);
    return workspace.mesh.readRoom(params(request), query.memberId, {
      after: query.after,
      limit: query.limit,
    });
  });
  app.post('/api/mesh/messages', async (request) => {
    const message = workspace.mesh.post({
      ...z
        .object({
          projectId: id,
          content: z.string().trim().min(1).max(10000),
          replyTo: id.nullable().optional(),
          mentions: z.array(id).max(16).optional(),
          taskId: id.nullable().optional(),
        })
        .strict()
        .parse(request.body),
      authorId: null,
      kind: 'message',
    });
    void workspace.inbox
      .dispatch(message.projectId)
      .catch((error) => workspace.log(redact(error), null, null, 'error', message.projectId));
    return message;
  });
  app.post('/api/mesh/:id/read', async (request) => {
    const input = z
      .object({ memberId: id, sequence: z.number().int().nonnegative() })
      .strict()
      .parse(request.body);
    return workspace.mesh.markRead(params(request), input.memberId, input.sequence);
  });
  app.post('/api/mesh/:id/ack', async (request) => {
    const input = z
      .object({ memberId: id, sequence: z.number().int().nonnegative() })
      .strict()
      .parse(request.body);
    return workspace.mesh.ack(params(request), input.memberId, input.sequence);
  });
  app.post('/api/mesh/messages/:id/claim', async (request) =>
    workspace.mesh.claim(
      params(request),
      z.object({ memberId: id }).strict().parse(request.body).memberId,
    ),
  );
  app.post('/api/requests/:id/resolve', async (request) => workspace.mesh.resolve(params(request)));
  app.post('/api/handoffs', async (request) =>
    workspace.handoffs.create(
      z
        .object({
          sessionId: id,
          toMemberId: id,
          summary: z.string().trim().min(1).max(6000),
          nextSteps: z.string().trim().min(1).max(10000),
          testEvidence: z.string().trim().min(1).max(10000),
        })
        .strict()
        .parse(request.body),
    ),
  );
  app.post('/api/handoffs/:id/retry', async (request) => workspace.handoffs.retry(params(request)));
  app.post('/api/handoffs/:id/accept', async (request) =>
    workspace.handoffs.accept(params(request)),
  );
  app.post('/api/handoffs/:id/cancel', async (request) =>
    workspace.handoffs.cancel(params(request)),
  );
  app.post('/api/members/:id/login', async (request) => {
    const { method } = z
      .object({ method: z.enum(['browser', 'device']).default('browser') })
      .strict()
      .parse(request.body);
    return workspace.login(params(request), options.cloud ? 'device' : method);
  });
  app.post('/api/members/:id/login/cancel', async (request) => {
    const memberId = params(request);
    if (workspace.loginOwner !== memberId)
      throw new DomainError('This profile has no pending sign-in.');
    const input = z.object({ loginId: z.string().min(1) }).parse(request.body);
    await (await workspace.client(memberId)).request('account/login/cancel', input);
    workspace.loginOwner = null;
    return { ok: true };
  });
  app.post('/api/members/:id/refresh', async (request) => workspace.refresh(params(request)));
  app.post('/api/members/:id/logout', async (request) => workspace.logout(params(request)));
  app.post('/api/members/:id/skills/import', async (request) =>
    workspace.importSkills(params(request)),
  );
  app.get('/api/members/:id/capabilities', async (request) => {
    const member = await workspace.refresh(params(request));
    return {
      skills: member.skills,
      plugins: member.plugins,
      errors: member.capabilitiesError ? [member.capabilitiesError] : [],
    };
  });
  app.get('/api/members/:id/setup', async (request) => ({
    home: workspace.home(params(request)),
    instructions:
      'Use this CODEX_HOME for skills, plugins, and MCP configuration. Restart this profile after editing config. Never copy auth.json between profiles.',
  }));
  app.post('/api/projects', async (request) => {
    if (options.cloud)
      throw new DomainError('Create a cloud project from a competition link.', 400);
    return workspace.addProject(
      z
        .object({
          name: text,
          path: z.string().min(1).max(2000),
          goal: z.string().max(16000).default(''),
        })
        .strict()
        .parse(request.body),
    );
  });
  app.patch('/api/projects/:id', async (request) => {
    const project = workspace.store.get<Project>('project', params(request));
    return workspace.store.put('project', {
      ...project,
      ...z
        .object({ name: text.optional(), goal: z.string().max(16000).optional() })
        .strict()
        .parse(request.body),
    });
  });
  app.post('/api/tasks', async (request) => {
    const task = workspace.store.addTask(taskInput.parse(request.body));
    workspace.log(`Created “${task.title}”.`, task.id, null, 'task');
    return task;
  });
  app.patch('/api/tasks/:id', async (request) => {
    const task = workspace.store.get<Task>('task', params(request));
    if (task.workflowId)
      throw new DomainError(
        'Workflow tasks are managed by the team. Use review feedback, pause, or resume.',
      );
    if (['running', 'review', 'done'].includes(task.status) || workspace.store.lease(task.id))
      throw new DomainError('This task cannot be edited while claimed, in review, or integrated.');
    const patch = taskInput
      .omit({ projectId: true, kind: true })
      .partial()
      .strict()
      .parse(request.body);
    if (patch.dependsOn) workspace.store.validateDependencies(task.id, patch.dependsOn);
    if (patch.scope) patch.scope = patch.scope.length ? patch.scope.map(normalizeScope) : ['.'];
    if (patch.assignedTo) workspace.store.get<Member>('member', patch.assignedTo);
    return workspace.store.updateTask(task.id, patch);
  });
  app.post('/api/tasks/:id/run', async (request) =>
    workspace.run(params(request), z.object({ memberId: id }).parse(request.body).memberId),
  );
  app.post('/api/projects/:id/dispatch', async (request) => workspace.dispatch(params(request)));
  app.post('/api/projects/:id/workflows', async (request, reply) => {
    const input = z
      .object({ prompt: z.string().trim().min(1).max(16000) })
      .strict()
      .parse(request.body);
    const workflow = await workspace.workflows.start(params(request), input.prompt);
    return reply.code(202).send(workflow);
  });
  app.post('/api/workflows/:id/pause', async (request) =>
    workspace.workflows.pause(params(request)),
  );
  app.post('/api/workflows/:id/resume', async (request) =>
    workspace.workflows.resume(params(request)),
  );
  app.post('/api/workflows/:id/cancel', async (request) =>
    workspace.workflows.cancel(params(request)),
  );
  app.post('/api/tasks/:id/stop', async (request) => workspace.stop(params(request)));
  app.get('/api/tasks/:id/diff', async (request) => workspace.diff(params(request)));
  app.post('/api/tasks/:id/accept', async (request) => workspace.accept(params(request)));
  app.post('/api/tasks/:id/revise', async (request) => {
    const task = workspace.store.get<Task>('task', params(request));
    if (workspace.mergeBusy.has(task.projectId))
      throw new DomainError('Wait for the current integration before requesting a revision.');
    if (
      task.workflowId &&
      ['cancelled', 'cancelling'].includes(
        workspace.store.get<Workflow>('workflow', task.workflowId).status,
      )
    )
      throw new DomainError(
        'This workflow has been cancelled. Create a new task for further changes.',
      );
    if (task.status !== 'review') throw new DomainError('Only a task in review can be sent back.');
    const { feedback } = z
      .object({ feedback: z.string().trim().min(1).max(8000) })
      .parse(request.body);
    const lease = workspace.store.lease(task.id);
    if (lease) workspace.store.release(task.id, lease.token);
    workspace.store.message({
      projectId: task.projectId,
      taskId: task.id,
      authorId: null,
      kind: 'message',
      content: feedback,
    });
    const revised = workspace.store.updateTask(task.id, {
      status: 'ready',
      description: task.description + '\n\nReview feedback: ' + feedback,
      error: null,
    });
    workspace.workflows.wakeProject(task.projectId);
    return revised;
  });
  app.post('/api/messages', async (request) => {
    const input = z
      .object({
        projectId: id,
        taskId: id.nullable().optional(),
        content: z.string().trim().min(1).max(10000),
      })
      .strict()
      .parse(request.body);
    workspace.store.get('project', input.projectId);
    if (
      input.taskId &&
      workspace.store.get<Task>('task', input.taskId).projectId !== input.projectId
    )
      throw new DomainError('The task belongs to another project.');
    return workspace.store.message({
      ...input,
      content: redact(input.content),
      taskId: input.taskId || null,
      authorId: null,
      kind: 'message',
    });
  });
  app.post('/api/approvals/:id', async (request) =>
    workspace.decide(
      params(request),
      z.object({ decision: z.enum(['accept', 'decline']) }).parse(request.body).decision,
    ),
  );
  app.get('/api/tasks/:id/events', async (request) => {
    const taskId = params(request);
    workspace.store.get('task', taskId);
    return workspace.store
      .all<Activity>('activity')
      .filter((a) => a.taskId === taskId)
      .slice(-300);
  });
  app.post('/api/recovery/acknowledge', async () => workspace.recover());
  if (options.distDir) {
    const root = path.resolve(options.distDir);
    app.get('/*', async (request, reply) => {
      if (request.url.startsWith('/api/'))
        return reply.code(404).send({ error: 'API route not found.' });
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      } catch {
        return reply.code(400).send('Invalid path');
      }
      let file = path.resolve(root, '.' + pathname);
      if (!inside(root, file)) return reply.code(403).send('Forbidden');
      try {
        if (!(await stat(file)).isFile()) file = path.join(root, 'index.html');
      } catch {
        file = path.join(root, 'index.html');
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      reply.type(types[path.extname(file)] || 'application/octet-stream');
      return readFile(file);
    });
  }
  app.addHook('preClose', async () => {
    for (const disconnect of eventConnections) disconnect();
  });
  app.addHook('onClose', async () => {
    await workspace.close();
  });
  return app;
}
