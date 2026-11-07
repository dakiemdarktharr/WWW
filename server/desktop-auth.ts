import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainError, type Store } from './store.ts';
import { safeEqual } from './security.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type DesktopOwner = { id: string; name: string };
const legacyOwner: DesktopOwner = { id: 'workspace-owner', name: 'Workspace owner' };
type Grant = {
  id: string;
  code: string;
  challenge: string;
  name: string;
  expires: number;
  approved: boolean;
  lastPoll: number;
  owner?: DesktopOwner;
};
export type DesktopDevice = {
  id: string;
  name: string;
  tokenHash: string;
  expiresAt: string;
  revoked: boolean;
  bridgeKeyHash?: string;
  lastSeen?: number;
  owner?: DesktopOwner;
};
type BridgeRequest = {
  id: string;
  body: unknown;
  authorization: string;
  delivered: boolean;
  resolve: (value: { status: number; body: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Browser consent + PKCE. No browser cookie or bearer token crosses a deep link. */
export class DesktopIdentity {
  private limits = new Map<string, { at: number; count: number }>();
  private pending = new Map<string, Map<string, BridgeRequest>>();
  private polling = new Set<string>();
  constructor(
    private store: Store,
    private origin: string,
  ) {}
  authorize(challenge: string, name: string, ip: string) {
    const now = Date.now();
    const limit = this.limits.get(ip);
    if (limit && now - limit.at < 60_000 && limit.count >= 6)
      throw new DomainError('Too many sign-in requests. Try again in a minute.', 429);
    this.limits.set(
      ip,
      limit && now - limit.at < 60_000
        ? { ...limit, count: limit.count + 1 }
        : { at: now, count: 1 },
    );
    for (const [key, value] of this.limits) if (now - value.at > 60_000) this.limits.delete(key);
    for (const grant of this.store.all<Grant>('desktopGrant'))
      if (grant.expires < now) this.store.remove('desktopGrant', grant.id);
    if (this.store.all('desktopGrant').length >= 100)
      throw new DomainError('Sign-in capacity reached. Try again later.', 429);
    const deviceCode = randomBytes(32).toString('base64url');
    const raw = randomBytes(5).toString('hex').toUpperCase();
    const userCode = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    const expires = now + 10 * 60_000;
    this.store.put<Grant>('desktopGrant', {
      id: digest(deviceCode),
      code: userCode,
      challenge,
      name,
      expires,
      approved: false,
      lastPoll: 0,
    });
    return {
      deviceCode,
      userCode,
      verificationUri: `${this.origin}/?activate=${userCode}`,
      expiresAt: new Date(expires).toISOString(),
      interval: 1,
    };
  }
  request(code: string, owner?: DesktopOwner) {
    const grant = this.store.all<Grant>('desktopGrant').find((g) => g.code === code.toUpperCase());
    if (!grant || grant.expires < Date.now())
      throw new DomainError('This desktop sign-in request expired or does not exist.', 404);
    if (grant.approved && owner && (grant.owner || legacyOwner).id !== owner.id)
      throw new DomainError('This desktop sign-in request belongs to another account.', 403);
    return grant;
  }
  approve(code: string, owner: DesktopOwner) {
    const grant = this.request(code, owner);
    // An approved grant cannot change owners, even before its PKCE exchange.
    this.store.put('desktopGrant', { ...grant, approved: true, owner });
    return { approved: true, name: grant.name };
  }
  token(deviceCode: string, verifier: string) {
    let grant: Grant;
    try {
      grant = this.store.get<Grant>('desktopGrant', digest(deviceCode));
    } catch {
      throw new DomainError('Desktop sign-in request expired or was already used.', 400);
    }
    if (grant.expires < Date.now()) throw new DomainError('Desktop sign-in request expired.', 400);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!safeEqual(challenge, grant.challenge))
      throw new DomainError('The desktop proof does not match this request.', 403);
    if (!grant.approved) {
      if (Date.now() - grant.lastPoll < 750)
        throw new DomainError('Wait before polling again.', 429);
      this.store.put('desktopGrant', { ...grant, lastPoll: Date.now() });
      return null;
    }
    return this.store.transaction(() => {
      this.store.get('desktopGrant', grant.id);
      const owner = grant.owner || legacyOwner;
      const now = Date.now();
      const devices = this.store.all<DesktopDevice>('desktopDevice');
      if (
        devices.filter(
          (device) =>
            !device.revoked &&
            Date.parse(device.expiresAt) > now &&
            (device.owner || legacyOwner).id === owner.id,
        ).length >= 10
      )
        throw new DomainError('This account has reached its active desktop limit.', 429);
      for (const device of devices)
        if (device.revoked || Date.parse(device.expiresAt) <= now)
          this.store.remove('desktopDevice', device.id);
      this.store.remove('desktopGrant', grant.id);
      const accessToken = randomBytes(32).toString('base64url');
      const device = this.store.put<DesktopDevice>('desktopDevice', {
        id: randomUUID(),
        name: grant.name,
        tokenHash: digest(accessToken),
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        revoked: false,
        owner,
      });
      return { accessToken, ...this.publicDevice(device) };
    });
  }
  authenticate(authorization?: string) {
    if (!authorization?.startsWith('Bearer '))
      throw new DomainError('Desktop sign-in required.', 401);
    const hash = digest(authorization.slice(7));
    const device = this.store
      .all<DesktopDevice>('desktopDevice')
      .find((d) => safeEqual(d.tokenHash, hash));
    if (!device || device.revoked || Date.parse(device.expiresAt) <= Date.now())
      throw new DomainError('Desktop sign-in expired or was revoked.', 401);
    return device;
  }
  publicDevice(device: DesktopDevice) {
    return { owner: device.owner || legacyOwner, deviceId: device.id, expiresAt: device.expiresAt };
  }
  revoke(device: DesktopDevice) {
    this.store.put('desktopDevice', { ...device, revoked: true });
    this.drop(device.id, 'The desktop connection was revoked.');
    return { revoked: true };
  }
  async poll(
    device: DesktopDevice,
    bridgeKey: string,
    responses: { id: string; status: number; body: unknown }[],
  ) {
    if (this.polling.has(device.id))
      throw new DomainError('A desktop bridge poll is already pending.', 409);
    this.polling.add(device.id);
    const ack: string[] = [];
    try {
      const keyHash = digest(bridgeKey);
      if (device.bridgeKeyHash && !safeEqual(device.bridgeKeyHash, keyHash))
        this.drop(device.id, 'Desktop connection key changed.');
      this.store.put('desktopDevice', { ...device, bridgeKeyHash: keyHash, lastSeen: Date.now() });
      for (const response of responses) {
        const pending = this.pending.get(device.id)?.get(response.id);
        if (pending?.delivered) {
          clearTimeout(pending.timer);
          this.pending.get(device.id)!.delete(response.id);
          pending.resolve({ status: response.status, body: response.body });
        }
        ack.push(response.id);
      }
      const until = Date.now() + 8000;
      while (
        Date.now() < until &&
        ![...(this.pending.get(device.id)?.values() || [])].some((p) => !p.delivered)
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      const current = this.store.get<DesktopDevice>('desktopDevice', device.id);
      if (current.revoked || Date.parse(current.expiresAt) <= Date.now())
        throw new DomainError('Desktop sign-in expired.', 401);
      const requests: { id: string; body: unknown; authorization: string }[] = [];
      let bytes = Buffer.byteLength(JSON.stringify({ requests: [], ack }));
      for (const pending of this.pending.get(device.id)?.values() || []) {
        if (pending.delivered) continue;
        const packet = { id: pending.id, body: pending.body, authorization: pending.authorization };
        const size = Buffer.byteLength(JSON.stringify(packet)) + 1;
        if (requests.length >= 4 || bytes + size > 3_900_000) break;
        pending.delivered = true;
        requests.push(packet);
        bytes += size;
      }
      return { requests, ack };
    } finally {
      this.polling.delete(device.id);
    }
  }
  exchange(host: string, key: string, authorization: string, body: unknown) {
    if (Buffer.byteLength(JSON.stringify(body) || '') > 3_800_000)
      throw new DomainError('Machine packet exceeds the desktop connection limit.', 413);
    let device: DesktopDevice;
    try {
      device = this.store.get<DesktopDevice>('desktopDevice', host);
    } catch {
      throw new DomainError('Desktop connection unavailable.', 403);
    }
    if (
      device.revoked ||
      Date.parse(device.expiresAt) <= Date.now() ||
      !device.bridgeKeyHash ||
      !safeEqual(device.bridgeKeyHash, digest(key))
    )
      throw new DomainError('Desktop connection unavailable.', 403);
    if (!device.lastSeen || Date.now() - device.lastSeen > 25_000)
      throw new DomainError('The desktop coordinator is offline. Open RELAY on its computer.', 503);
    let queue = this.pending.get(host);
    if (!queue) this.pending.set(host, (queue = new Map()));
    if (queue.size >= 8) throw new DomainError('Desktop connection is busy.', 429);
    const target = queue;
    return new Promise<{ status: number; body: unknown }>((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        target.delete(id);
        resolve({
          status: 503,
          body: {
            error:
              'Desktop response was lost. The request will not be replayed; reconnect and recover if necessary.',
          },
        });
      }, 22_000);
      target.set(id, { id, body, authorization, delivered: false, resolve, timer });
    });
  }
  private drop(id: string, error: string) {
    for (const request of this.pending.get(id)?.values() || []) {
      clearTimeout(request.timer);
      request.resolve({ status: 503, body: { error } });
    }
    this.pending.delete(id);
  }
  close() {
    for (const id of this.pending.keys())
      this.drop(id, 'Desktop bridge restarted. Recover interrupted work.');
  }
}
