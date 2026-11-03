import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';

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
  // The bootstrap instance is never mounted as an HTTP handler. Public sign-up
  // stays disabled, including on a newly created/restored cloud workspace.
  const bootstrap = betterAuth({ ...common, emailAndPassword: { enabled: true } });
  const { runMigrations } = await getMigrations(bootstrap.options);
  await runMigrations();
  if (!database.prepare('SELECT id FROM user WHERE email=?').get('owner@relay.invalid'))
    await bootstrap.api.signUpEmail({
      body: {
        email: 'owner@relay.invalid',
        password: options.bootstrapPassword,
        name: 'Workspace owner',
      },
    });
  const auth = betterAuth({
    ...common,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 20 },
  });
  return {
    handler: auth.handler,
    async authorized(headers: IncomingHttpHeaders) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      return session?.user.email === 'owner@relay.invalid';
    },
    close: () => database.close(),
  };
}
