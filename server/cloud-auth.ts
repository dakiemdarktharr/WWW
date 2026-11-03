import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';

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
}) {
  if (options.secret.length < 32 || options.bootstrapPassword.length < 20)
    throw new Error('Cloud authentication requires persistent strong secrets.');
  const database = new DatabaseSync(path.join(options.directory, 'identity.db'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
  const common = {
    database,
    secret: options.secret,
    baseURL: options.origin,
    basePath: '/api/auth',
    trustedOrigins: [options.origin],
    advanced: { useSecureCookies: options.origin.startsWith('https:') },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    rateLimit: { enabled: true, window: 60, max: 20, storage: 'database' as const },
    logger: { disabled: true },
  };
  // Bootstrap is private. Its immutable database ID alone retains access to the
  // legacy hosted workspace; public users only get their own desktop identities.
  const bootstrap = betterAuth({ ...common, emailAndPassword: { enabled: true } });
  const { runMigrations } = await getMigrations(bootstrap.options);
  await runMigrations();
  if (!database.prepare('SELECT id FROM user WHERE email=?').get(ownerEmail))
    await bootstrap.api.signUpEmail({
      body: {
        email: ownerEmail,
        password: options.bootstrapPassword,
        name: 'Workspace owner',
      },
    });
  const owner = database.prepare('SELECT id FROM user WHERE email=?').get(ownerEmail)!;
  const auth = betterAuth({
    ...common,
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
  });
  let pendingRegistrations = 0;
  let registrationWindow = { at: Date.now(), attempts: 0 };
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
      // Expose only the account operations actually supported by this release.
      // There is no email sender, verification link or password-reset promise.
      const methods: Record<string, string> = {
        '/api/auth/get-session': 'GET',
        '/api/auth/sign-in/email': 'POST',
        '/api/auth/sign-up/email': 'POST',
        '/api/auth/sign-out': 'POST',
      };
      if (methods[route] !== request.method)
        return Response.json({ message: 'Account operation unavailable.' }, { status: 404 });
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
      const count = Number(database.prepare('SELECT COUNT(*) AS count FROM user').get()!.count);
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
    async authorized(headers: IncomingHttpHeaders) {
      return (await currentUser(headers))?.id === 'workspace-owner';
    },
    close: () => database.close(),
  };
}
