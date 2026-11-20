import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { MongoClient } from 'mongodb';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { BetterAuthOptions } from 'better-auth';
import type { AccountMailSender } from './account-mail.ts';
import { passwordChangedEmail, resetEmail } from './reset-email.ts';

const ownerEmail = 'owner@relay.invalid';
const signup = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();

export type CloudUser = { id: string; name: string; email: string };

export interface CloudAccess {
  origin: string;
  gatewaySecret: string;
  auth: Awaited<ReturnType<typeof createCloudIdentity>>;
  expiresAt?: string;
}

export async function createCloudIdentity(options: {
  directory: string;
  origin: string;
  secret: string;
  bootstrapPassword: string;
  mongodbUri?: string;
  mongodbDatabase?: string;
  sendMail?: AccountMailSender;
}) {
  if (options.secret.length < 32 || options.bootstrapPassword.length < 20)
    throw new Error('Cloud authentication requires persistent strong secrets.');
  let sqlite: DatabaseSync | undefined;
  let mongo: MongoClient | undefined;
  let database: BetterAuthOptions['database'];
  if (options.mongodbUri) {
    const databaseName = options.mongodbDatabase || 'kivuno_identity';
    if (!/^[a-zA-Z0-9_-]{1,63}$/.test(databaseName))
      throw new Error('Invalid identity database name.');
    // Atlas production connections require TLS and certificate verification. A replica set
    // is mandatory because password/token/session writes share one transaction.
    if (
      !options.mongodbUri.startsWith('mongodb+srv://') ||
      /(?:[?&])(?:tls|ssl)=false|(?:[?&])tls(?:Insecure|AllowInvalidCertificates|AllowInvalidHostnames)=true/i.test(
        options.mongodbUri,
      )
    )
      throw new Error('Identity storage requires a verified TLS MongoDB Atlas connection.');
    try {
      mongo = new MongoClient(options.mongodbUri, {
        tls: true,
        tlsAllowInvalidCertificates: false,
        tlsAllowInvalidHostnames: false,
        maxPoolSize: 8,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
        timeoutMS: 15_000,
      });
      await mongo.connect();
      await mongo.db(databaseName).command({ ping: 1 });
      database = mongodbAdapter(mongo.db(databaseName), { client: mongo, transaction: true });
    } catch {
      await mongo?.close().catch(() => {});
      throw new Error('Secure identity database is unavailable. No local fallback was opened.');
    }
  } else {
    sqlite = new DatabaseSync(path.join(options.directory, 'identity.db'));
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
    database = sqlite;
  }
  const pendingMail = new Set<Promise<unknown>>();
  let deliveryFailures = 0;
  const background = (promise: Promise<unknown>) => {
    const handled = promise
      .catch(() => {
        deliveryFailures++;
      })
      .finally(() => pendingMail.delete(handled));
    pendingMail.add(handled);
  };
  let revokeDesktop: (id: string) => void = () => {};
  const common = {
    database,
    secret: options.secret,
    baseURL: options.origin,
    basePath: '/api/auth',
    trustedOrigins: [options.origin],
    advanced: {
      useSecureCookies: options.origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: ['x-relay-client-ip'] },
      backgroundTasks: { handler: background },
    },
    verification: { storeIdentifier: 'hashed' as const },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    rateLimit: { enabled: true, window: 60, max: 20, storage: 'database' as const },
    logger: { disabled: true },
  };
  // Bootstrap is private. Its immutable database ID alone retains access to the
  // legacy hosted workspace; public users only get their own desktop identities.
  const bootstrap = betterAuth({ ...common, emailAndPassword: { enabled: true } });
  if (sqlite) {
    const { runMigrations } = await getMigrations(bootstrap.options);
    await runMigrations();
  }
  const context = await bootstrap.$context;
  if (!(await context.internalAdapter.findUserByEmail(ownerEmail)))
    await bootstrap.api.signUpEmail({
      body: {
        email: ownerEmail,
        password: options.bootstrapPassword,
        name: 'Workspace owner',
      },
    });
  const owner = (await context.internalAdapter.findUserByEmail(ownerEmail))!.user;
  const auth = betterAuth({
    ...common,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 15 * 60,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendMail
        ? {
            sendResetPassword: async ({
              user,
              token,
            }: {
              user: { email: string };
              token: string;
            }) => {
              if (user.email.endsWith('.invalid')) return;
              const url = `${options.origin}/reset-password#token=${encodeURIComponent(token)}`;
              try {
                await options.sendMail!({ to: user.email, ...resetEmail(url, options.origin) });
              } catch {
                deliveryFailures++;
                throw new Error('Account email delivery failed.');
              }
            },
          }
        : {}),
      onPasswordReset: async ({ user }: { user: { id: string; email: string } }) => {
        revokeDesktop(user.id === owner.id ? 'workspace-owner' : user.id);
        if (options.sendMail)
          background(options.sendMail({ to: user.email, ...passwordChangedEmail(options.origin) }));
      },
    },
  });
  let pendingRegistrations = 0;
  let registrationWindow = { at: Date.now(), attempts: 0 };
  const recoveryLimits = new Map<string, { count: number; until: number }>();
  const limit = (key: string, max: number, duration: number) => {
    const now = Date.now();
    for (const [id, entry] of recoveryLimits) if (entry.until <= now) recoveryLimits.delete(id);
    const digest = createHmac('sha256', options.secret).update(key).digest('hex');
    const entry = recoveryLimits.get(digest) || { count: 0, until: now + duration };
    if (recoveryLimits.size >= 5000 && !recoveryLimits.has(digest)) return false;
    recoveryLimits.set(digest, entry);
    return ++entry.count <= max;
  };
  const currentUser = async (headers: IncomingHttpHeaders): Promise<CloudUser | null> => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session?.user) return null;
    return {
      id: session.user.id === owner.id ? 'workspace-owner' : session.user.id,
      name: session.user.name,
      email: session.user.email,
    };
  };
  return {
    async handler(request: Request) {
      const route = new URL(request.url).pathname;
      const methods: Record<string, string> = {
        '/api/auth/get-session': 'GET',
        '/api/auth/sign-in/email': 'POST',
        '/api/auth/sign-up/email': 'POST',
        '/api/auth/sign-out': 'POST',
        '/api/auth/request-password-reset': 'POST',
        '/api/auth/reset-password': 'POST',
      };
      if (methods[route] !== request.method)
        return Response.json({ message: 'Account operation unavailable.' }, { status: 404 });
      if (request.method === 'POST' && request.headers.get('origin') !== options.origin)
        return Response.json(
          { message: 'A verified application origin is required.' },
          { status: 403 },
        );
      if (route === '/api/auth/request-password-reset' || route === '/api/auth/reset-password') {
        const payload = await request
          .clone()
          .json()
          .catch(() => null);
        const requesting = route === '/api/auth/request-password-reset';
        const input = (
          requesting
            ? z.object({ email: z.email().trim().toLowerCase().max(254) }).strict()
            : z
                .object({
                  token: z
                    .string()
                    .min(20)
                    .max(128)
                    .regex(/^[a-zA-Z0-9_-]+$/),
                  newPassword: z.string().min(12).max(128),
                })
                .strict()
        ).safeParse(payload);
        if (!input.success || new URL(request.url).search)
          return Response.json(
            { code: 'INVALID_RECOVERY_INPUT', message: 'Check the recovery details.' },
            { status: 400 },
          );
        const suppliedIp = request.headers.get('x-relay-client-ip') || '';
        const ip = isIP(suppliedIp) ? suppliedIp : 'unknown';
        if (
          !limit(`ip:${ip}`, 20, 15 * 60_000) ||
          (requesting && !limit(`email:${(input.data as { email: string }).email}`, 5, 60 * 60_000))
        )
          return Response.json(
            { code: 'RECOVERY_RATE_LIMIT', message: 'Wait before trying again.' },
            { status: 429, headers: { 'Retry-After': '900' } },
          );
        if (requesting && (!options.sendMail || !options.origin.startsWith('https:')))
          return Response.json(
            {
              code: 'RECOVERY_UNAVAILABLE',
              message: 'Password recovery email is not configured yet.',
            },
            { status: 503 },
          );
        if (requesting && pendingMail.size >= 100)
          return Response.json(
            { code: 'RECOVERY_BUSY', message: 'Try again later.' },
            { status: 503 },
          );
        const response = await auth.handler(
          new Request(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(input.data),
          }),
        );
        if (requesting && response.ok)
          return Response.json(
            {
              status: true,
              message:
                'Request received. If the account exists, check its inbox for a recovery link.',
            },
            { status: 202 },
          );
        return response;
      }
      if (route !== '/api/auth/sign-up/email') return auth.handler(request);
      const input = signup.safeParse(
        await request
          .clone()
          .json()
          .catch(() => null),
      );
      if (!input.success)
        return Response.json(
          { message: 'Use a name, valid email and a password with 12–128 characters.' },
          { status: 400 },
        );
      if (
        input.data.email.endsWith('@relay.invalid') ||
        input.data.email.endsWith('@kivuno.invalid')
      )
        return Response.json({ message: 'This email domain is reserved.' }, { status: 400 });
      if (Date.now() - registrationWindow.at >= 60_000)
        registrationWindow = { at: Date.now(), attempts: 0 };
      const count = await context.adapter.count({ model: 'user' });
      if (registrationWindow.attempts >= 5 || count + pendingRegistrations >= 200)
        return Response.json(
          { message: 'Free registration capacity reached. Try again later.' },
          { status: 429, headers: { 'Retry-After': '60' } },
        );
      registrationWindow.attempts++;
      pendingRegistrations++;
      try {
        return await auth.handler(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(input.data),
          }),
        );
      } finally {
        pendingRegistrations--;
      }
    },
    currentUser,
    async findUser(account: string): Promise<CloudUser | null> {
      const row = account.includes('@')
        ? (await context.internalAdapter.findUserByEmail(account.toLowerCase()))?.user
        : await context.internalAdapter.findUserById(
            account === 'workspace-owner' ? owner.id : account,
          );
      return row
        ? {
            id: row.id === owner.id ? 'workspace-owner' : String(row.id),
            name: String(row.name),
            email: String(row.email),
          }
        : null;
    },
    async authorized(headers: IncomingHttpHeaders) {
      return (await currentUser(headers))?.id === 'workspace-owner';
    },
    onPasswordReset(listener: (id: string) => void) {
      revokeDesktop = listener;
    },
    async flushMail() {
      await Promise.allSettled([...pendingMail]);
      return { failures: deliveryFailures };
    },
    async close() {
      await Promise.allSettled([...pendingMail]);
      sqlite?.close();
      await mongo?.close();
    },
  };
}
