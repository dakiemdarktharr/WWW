import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes as randomNodeBytes } from 'node:crypto';
import {
  Interface,
  JsonRpcProvider,
  getAddress,
  hexlify,
  randomBytes,
  verifyMessage,
} from 'ethers';
import { z } from 'zod';
import { activeProviderIds } from '../shared/providers.ts';
import type { CloudUser } from './cloud-auth.ts';
import { DomainError, type Store } from './store.ts';
import { DesktopIdentity, type DesktopDevice } from './desktop-auth.ts';
import { bankEntitlement } from './bank-checkout.ts';

export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC_URL = 'https://api.avax-test.network/ext/bc/C/rpc';
export const FUJI_USDC_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65';
export const DEFAULT_TREASURY_ADDRESS = '0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805';
const PLAN_PRICE = { plus: 2_000_000n, max: 6_000_000n } as const;
const PLAN_ID = { plus: 1, max: 2 } as const;
const billingAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const intentIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const usdcInterface = new Interface([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const planInterface = new Interface([
  'function pay(bytes32 paymentIntentId,uint8 planId,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function usdc() view returns (address)',
  'function treasury() view returns (address)',
  'function usedIntents(bytes32) view returns (bool)',
  'function subscriptions(address) view returns (uint64 paidUntil,uint8 planId)',
  'event PlanPaid(bytes32 indexed paymentIntentId,address indexed payer,uint8 indexed planId,address token,uint256 amount,uint64 paidUntil)',
]);

type Tier = 'free' | 'plus' | 'max';
type BillingWallet = { id: string; ownerId: string; address: string; updatedAt: string };
type WalletChallenge = {
  id: string;
  ownerId: string;
  address: string;
  currentAddress: string | null;
  message: string;
  currentWalletMessage?: string;
  expiresAt: number;
  usedAt?: number;
};
type Plan = 'plus' | 'max';
type PaymentIntent = {
  id: string;
  ownerId: string;
  payer: string;
  plan: Plan;
  amount: string;
  token: string;
  contract: string;
  treasury: string;
  chainId: number;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'verified';
  txHash?: string;
  logIndex?: number;
};
type Entitlement = {
  id: string;
  ownerId: string;
  tier: Exclude<Tier, 'free'>;
  paidUntil: number;
  syncedBlock: number;
  updatedAt: string;
};
type Trial = {
  id: string;
  ownerId: string;
  tier: Plan;
  startedAt: number;
  paidUntil: number;
};
const TRIAL_PERIOD = 30 * 86400_000;
type BillingProfile = {
  id: string;
  ownerId: string;
  deviceId: string;
  profileId: string;
  name: string;
  provider: 'codex' | 'gemini' | 'claude' | 'antigravity';
  state: 'reserved' | 'active' | 'released';
  selected: boolean;
  createdAt: string;
  updatedAt: string;
  reservationExpiresAt?: number;
};

function safeAddress(value: string | undefined, fallback: string): string {
  try {
    return getAddress(value || fallback);
  } catch {
    throw new Error('Billing configuration contains an invalid EVM address.');
  }
}

function unixSeconds(value: number) {
  return Math.floor(value / 1000);
}

function latestEntitlement(store: Store, userId: string) {
  const chain = store.lookup<Entitlement>('billingEntitlement', userId);
  const bank = bankEntitlement(store, userId);
  return bank && (!chain || bank.latestPaidAt >= Date.parse(chain.updatedAt)) ? bank : chain;
}

function tierFor(store: Store, userId: string, now = Date.now()): Tier {
  const entitlement = latestEntitlement(store, userId);
  if (entitlement && entitlement.paidUntil > now) return entitlement.tier;
  const trial = store.lookup<Trial>('billingTrial', userId);
  return trial && trial.paidUntil > now ? trial.tier : 'free';
}

export function effectiveTier(store: Store, userId: string, now = Date.now()): Tier {
  return tierFor(store, userId, now);
}

export function registerBillingRoutes(
  app: FastifyInstance,
  store: Store,
  currentUser: (request: FastifyRequest) => Promise<CloudUser | null>,
  desktopIdentity?: DesktopIdentity,
) {
  const contractAddress = process.env.KIVUNO_FUJI_PAYMENT_CONTRACT
    ? safeAddress(process.env.KIVUNO_FUJI_PAYMENT_CONTRACT, '')
    : '';
  const tokenAddress = safeAddress(process.env.KIVUNO_FUJI_USDC_ADDRESS, FUJI_USDC_ADDRESS);
  const treasuryAddress = safeAddress(
    process.env.KIVUNO_FUJI_TREASURY_ADDRESS,
    DEFAULT_TREASURY_ADDRESS,
  );
  const rpcUrl = process.env.KIVUNO_FUJI_RPC_URL || FUJI_RPC_URL;
  const provider = new JsonRpcProvider(rpcUrl, FUJI_CHAIN_ID, { staticNetwork: true });
  const challenges = new Map<string, { count: number; at: number }>();
  const paymentAttempts = new Map<string, { count: number; at: number }>();

  const userFor = async (request: FastifyRequest) => {
    const user = await currentUser(request);
    if (!user) throw new DomainError('Sign in to use Kivuno billing.', 401);
    return user;
  };
  const configured = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) return false;
    try {
      if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(FUJI_CHAIN_ID)) return false;
      const address = getAddress(contractAddress);
      const code = await provider.getCode(address);
      if (code === '0x') return false;
      const [configuredToken, configuredTreasury] = await Promise.all([
        provider.call({ to: address, data: planInterface.encodeFunctionData('usdc') }),
        provider.call({ to: address, data: planInterface.encodeFunctionData('treasury') }),
      ]);
      return (
        getAddress(planInterface.decodeFunctionResult('usdc', configuredToken)[0]) ===
          tokenAddress &&
        getAddress(planInterface.decodeFunctionResult('treasury', configuredTreasury)[0]) ===
          treasuryAddress
      );
    } catch {
      return false;
    }
  };
  const limited = (
    map: Map<string, { count: number; at: number }>,
    key: string,
    maximum: number,
  ) => {
    const now = Date.now();
    for (const [entry, value] of map) if (now - value.at > 60_000) map.delete(entry);
    const window = map.get(key) || { count: 0, at: now };
    if (++window.count > maximum)
      throw new DomainError('Too many billing requests. Try again later.', 429);
    map.set(key, window);
  };
  const findBinding = (userId: string) => store.lookup<BillingWallet>('billingWallet', userId);
  const requireCurrentPayer = (userId: string, payer: string) => {
    if (findBinding(userId)?.address !== payer)
      throw new DomainError('The linked wallet changed. Reload billing before continuing.', 409);
  };
  // Unsubmitted intents can be abandoned. Once Fuji has advanced beyond their
  // expiry, no further transaction can settle them within the accepted window.
  const pendingThrough = (userId: string, payer: string) => {
    const paid = latestEntitlement(store, userId);
    if (paid && paid.paidUntil > Date.now())
      throw new DomainError('Wait until the current paid term ends before changing wallets.', 409);
    let latestExpiry = 0;
    for (const intent of store.all<PaymentIntent>('billingIntent')) {
      if (intent.ownerId === userId && intent.payer === payer && intent.status === 'pending')
        latestExpiry = Math.max(latestExpiry, intent.expiresAt);
    }
    if (latestExpiry > Date.now())
      throw new DomainError('Verify the pending payment or wait for its intent to expire.', 409);
    return latestExpiry;
  };
  const readSubscription = async (contract: string, payer: string, block: number) => {
    const data = await provider.call({
      to: contract,
      data: planInterface.encodeFunctionData('subscriptions', [payer]),
      blockTag: block,
    });
    return planInterface.decodeFunctionResult('subscriptions', data);
  };
  const profileLimit = (userId: string): number | null => {
    const tier = tierFor(store, userId);
    return tier === 'max' ? null : tier === 'plus' ? 10 : 3;
  };
  const profileRows = (userId: string) =>
    store
      .all<BillingProfile>('billingProfile')
      .filter(
        (profile) =>
          profile.ownerId === userId &&
          profile.state !== 'released' &&
          profile.provider !== 'gemini',
      );
  const reservationId = (deviceId: string, profileId: string) => `${deviceId}:${profileId}`;
  const normalizeProfileSelection = (userId: string) => {
    const profiles = profileRows(userId).filter(
      (profile) =>
        profile.state === 'active' ||
        (profile.state === 'reserved' && (profile.reservationExpiresAt || 0) > Date.now()),
    );
    const limit = profileLimit(userId);
    const selected = profiles
      .filter((profile) => profile.selected)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (limit === null) {
      for (const profile of profiles)
        if (!profile.selected) store.put('billingProfile', { ...profile, selected: true });
      return;
    }
    for (const [index, profile] of selected.entries())
      if (index >= limit) store.put('billingProfile', { ...profile, selected: false });
  };
  const profileView = (userId: string) => {
    normalizeProfileSelection(userId);
    return {
      limit: profileLimit(userId),
      tier: tierFor(store, userId),
      profiles: profileRows(userId)
        .filter((profile) => profile.state === 'active')
        .map((profile) => ({
          reservationId: profile.id,
          profileId: profile.profileId,
          deviceId: profile.deviceId,
          name: profile.name,
          provider: profile.provider,
          selected: profile.selected,
        }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.reservationId.localeCompare(b.reservationId),
        ),
    };
  };

  // The matching encrypted wallet lives on the customer's device. Neither half alone signs.
  app.post('/api/billing/wallet/unlock', async (request, reply) => {
    const user = await userFor(request);
    const input = z.object({ accountId: z.string() }).strict().parse(request.body);
    if (input.accountId !== user.id) throw new DomainError('Wallet account changed.', 403);
    reply.header('Cache-Control', 'no-store');
    const record = store.transaction(
      () =>
        store.lookup<{ id: string; wrappingKey: string }>('billingWalletSeal', user.id) ??
        store.put('billingWalletSeal', {
          id: user.id,
          wrappingKey: hexlify(randomNodeBytes(32)),
        }),
    );
    return { accountId: user.id, wrappingKey: record.wrappingKey };
  });

  app.get('/api/billing/summary', async (request) => {
    const user = await userFor(request);
    const binding = findBinding(user.id);
    const entitlement = latestEntitlement(store, user.id);
    const trial = store.lookup<Trial>('billingTrial', user.id);
    const paidActive = Boolean(entitlement && entitlement.paidUntil > Date.now());
    const trialActive = Boolean(!paidActive && trial && trial.paidUntil > Date.now());
    const activeUntil = trialActive ? trial!.paidUntil : entitlement?.paidUntil;
    return {
      account: user,
      wallet: binding?.address || null,
      tier: tierFor(store, user.id),
      profileLimit: profileLimit(user.id),
      paidUntil: activeUntil ? new Date(activeUntil).toISOString() : null,
      trial: {
        eligible: !trial && !paidActive,
        active: trialActive,
        tier: trial?.tier || null,
        endsAt: trial ? new Date(trial.paidUntil).toISOString() : null,
      },
      config: {
        chainId: FUJI_CHAIN_ID,
        chainName: 'Avalanche Fuji',
        tokenAddress,
        tokenName: 'USD Coin',
        tokenVersion: '2',
        tokenDecimals: 6,
        contractAddress: contractAddress || null,
        treasuryAddress,
        available:
          (request.query as { rail?: string }).rail === 'bank' ? false : await configured(),
      },
    };
  });

  app.post('/api/billing/trial', async (request, reply) => {
    const user = await userFor(request);
    limited(paymentAttempts, `${user.id}:trial`, 5);
    const input = z
      .object({ plan: z.enum(['plus', 'max']) })
      .strict()
      .parse(request.body);
    const trial = store.transaction(() => {
      // The claim and entitlement are one record under the account primary key.
      // A simultaneous request or a change of plan can never extend the trial.
      if (store.lookup<Trial>('billingTrial', user.id))
        throw new DomainError('Tài khoản này đã sử dụng 30 days trial.', 409);
      const paid = latestEntitlement(store, user.id);
      const now = Date.now();
      if (paid && paid.paidUntil > now)
        throw new DomainError('Tài khoản đang có gói trả phí còn hiệu lực.', 409);
      return store.put('billingTrial', {
        id: user.id,
        ownerId: user.id,
        tier: input.plan,
        startedAt: now,
        paidUntil: now + TRIAL_PERIOD,
      } satisfies Trial);
    });
    return reply.code(201).send({
      tier: trial.tier,
      endsAt: new Date(trial.paidUntil).toISOString(),
      automaticRenewal: false,
    });
  });

  app.get('/api/billing/profiles', async (request) => {
    const user = await userFor(request);
    return profileView(user.id);
  });
  app.post('/api/billing/profiles/select', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const user = await userFor(request);
    const input = z
      .object({ reservationIds: z.array(z.string().min(3).max(100)) })
      .strict()
      .parse(request.body);
    if (new Set(input.reservationIds).size !== input.reservationIds.length)
      throw new DomainError('Choose each provider profile once.', 400);
    const profiles = profileRows(user.id).filter((profile) => profile.state === 'active');
    if (input.reservationIds.some((id) => !profiles.some((profile) => profile.id === id)))
      throw new DomainError('Choose only provider profiles belonging to your account.', 403);
    const limit = profileLimit(user.id);
    if (limit !== null && input.reservationIds.length > limit)
      throw new DomainError(`This plan supports up to ${limit} active profiles.`, 429);
    const selected = new Set(input.reservationIds);
    store.transaction(() => {
      for (const profile of profiles)
        store.put('billingProfile', { ...profile, selected: selected.has(profile.id) });
    });
    return profileView(user.id);
  });

  if (desktopIdentity)
    app.post('/api/desktop/profiles', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
      const { owner, deviceId } = desktopIdentity.publicDevice(
        desktopIdentity.authenticate(request.headers.authorization),
      );
      const profileInput = z
        .object({
          profileId: z.string().uuid(),
          name: z.string().trim().min(1).max(100).optional(),
          provider: z.enum(activeProviderIds).optional(),
        })
        .strict();
      const command = z.discriminatedUnion('action', [
        z
          .object({ action: z.literal('reserve') })
          .merge(profileInput)
          .strict(),
        z
          .object({ action: z.literal('commit') })
          .merge(profileInput)
          .strict(),
        z.object({ action: z.literal('release'), profileId: z.string().uuid() }).strict(),
        z
          .object({
            action: z.literal('sync'),
            profiles: z
              .array(
                z
                  .object({
                    profileId: z.string().uuid(),
                    name: z.string().trim().min(1).max(100),
                    provider: z.enum(['codex', 'gemini', 'claude', 'antigravity']),
                  })
                  .strict(),
              )
              .max(10_000),
          })
          .strict(),
      ]);
      const input = command.parse(request.body);
      return store.transaction(() => {
        const now = Date.now();
        for (const profile of store.all<BillingProfile>('billingProfile'))
          if (
            profile.ownerId === owner.id &&
            profile.state === 'reserved' &&
            (profile.reservationExpiresAt || 0) <= now
          )
            store.put('billingProfile', {
              ...profile,
              state: 'released',
              selected: false,
              updatedAt: new Date().toISOString(),
            });
        normalizeProfileSelection(owner.id);
        if (input.action === 'reserve') {
          const key = reservationId(deviceId, input.profileId);
          const existing = store.lookup<BillingProfile>('billingProfile', key);
          if (existing && existing.ownerId === owner.id && existing.state !== 'released')
            return { reserved: existing.selected, locked: !existing.selected };
          const limit = profileLimit(owner.id);
          const selectedCount = profileRows(owner.id).filter((profile) => profile.selected).length;
          if (limit !== null && selectedCount >= limit)
            throw new DomainError(
              `Your ${tierFor(store, owner.id)} plan supports ${limit} active profiles. Choose or remove a profile before adding another.`,
              429,
            );
          const createdAt = new Date().toISOString();
          const profile: BillingProfile = {
            id: key,
            ownerId: owner.id,
            deviceId,
            profileId: input.profileId,
            name: input.name || 'New provider profile',
            provider: input.provider || 'codex',
            state: 'reserved',
            selected: true,
            createdAt,
            updatedAt: createdAt,
            reservationExpiresAt: now + 5 * 60_000,
          };
          store.put('billingProfile', profile);
          return { reserved: true, locked: false };
        }
        if (input.action === 'release') {
          const key = reservationId(deviceId, input.profileId);
          const existing = store.lookup<BillingProfile>('billingProfile', key);
          if (existing && existing.ownerId === owner.id && existing.state === 'reserved')
            store.put('billingProfile', {
              ...existing,
              state: 'released',
              selected: false,
              updatedAt: new Date().toISOString(),
            });
          return { released: true };
        }
        if (input.action === 'commit') {
          const key = reservationId(deviceId, input.profileId);
          const existing = store.lookup<BillingProfile>('billingProfile', key);
          if (!existing || existing.ownerId !== owner.id || existing.state === 'released')
            throw new DomainError(
              'Provider profile reservation was not found. Reserve it again.',
              409,
            );
          if (!existing.selected)
            throw new DomainError('This profile is locked by the current plan quota.', 429);
          store.put('billingProfile', {
            ...existing,
            ...(input.name ? { name: input.name } : {}),
            ...(input.provider ? { provider: input.provider } : {}),
            state: 'active',
            reservationExpiresAt: undefined,
            updatedAt: new Date().toISOString(),
          });
          return { committed: true };
        }
        if (
          new Set(input.profiles.map((profile) => profile.profileId)).size !== input.profiles.length
        )
          throw new DomainError('Duplicate provider profile IDs were supplied.', 400);
        // Older desktops can still send retired profiles alongside current ones.
        const activeProfiles = input.profiles.filter((profile) => profile.provider !== 'gemini');
        const ids = new Set(activeProfiles.map((profile) => profile.profileId));
        // Desktop consent rotates device leases. Carry over the owner's selection
        // for the same local profile only after the former lease has retired.
        const activeDevices = new Set(
          store
            .all<DesktopDevice>('desktopDevice')
            .filter((device) => !device.revoked && Date.parse(device.expiresAt) > now)
            .map((device) => device.id),
        );
        const inherited = new Map<string, BillingProfile>();
        for (const existing of profileRows(owner.id)) {
          if (existing.state !== 'active') continue;
          const returning = ids.has(existing.profileId) && !activeDevices.has(existing.deviceId);
          if (returning && (!inherited.has(existing.profileId) || existing.selected))
            inherited.set(existing.profileId, existing);
          if (returning || (existing.deviceId === deviceId && !ids.has(existing.profileId)))
            store.put('billingProfile', {
              ...existing,
              state: 'released',
              selected: false,
              updatedAt: new Date().toISOString(),
            });
        }
        for (const previous of inherited.values()) {
          const id = reservationId(deviceId, previous.profileId);
          const current = store.lookup<BillingProfile>('billingProfile', id);
          store.put('billingProfile', {
            ...previous,
            id,
            deviceId,
            selected: previous.selected || (current?.state === 'active' && current.selected),
            updatedAt: new Date().toISOString(),
          });
        }
        for (const supplied of activeProfiles) {
          const key = reservationId(deviceId, supplied.profileId);
          const existing = store.lookup<BillingProfile>('billingProfile', key);
          if (existing && existing.ownerId === owner.id && existing.state !== 'released') {
            store.put('billingProfile', {
              ...existing,
              name: supplied.name,
              provider: supplied.provider,
              state: 'active',
              reservationExpiresAt: undefined,
              updatedAt: new Date().toISOString(),
            });
          } else {
            const limit = profileLimit(owner.id);
            const count = profileRows(owner.id).filter((profile) => profile.selected).length;
            const selected = limit === null || count < limit;
            const nowIso = new Date().toISOString();
            store.put('billingProfile', {
              id: key,
              ownerId: owner.id,
              deviceId,
              profileId: supplied.profileId,
              name: supplied.name,
              provider: supplied.provider,
              state: 'active',
              selected,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
        normalizeProfileSelection(owner.id);
        return {
          lockedIds: input.profiles
            .filter((profile) => profile.provider === 'gemini')
            .map((profile) => profile.profileId)
            .concat(
              profileRows(owner.id)
                .filter((profile) => profile.deviceId === deviceId && !profile.selected)
                .map((profile) => profile.profileId),
            ),
        };
      });
    });

  app.post('/api/billing/wallet/challenge', async (request) => {
    const user = await userFor(request);
    limited(challenges, user.id, 12);
    const input = z.object({ address: billingAddress }).strict().parse(request.body);
    let address: string;
    try {
      address = getAddress(input.address);
    } catch {
      throw new DomainError('Enter a valid EVM wallet address.', 400);
    }
    const now = Date.now();
    const expiresAt = now + 5 * 60_000;
    const id = randomNodeBytes(24).toString('base64url');
    const nonce = randomNodeBytes(32).toString('hex');
    const current = findBinding(user.id)?.address || null;
    const context = [
      'Kivuno wallet authorization',
      `Origin: ${process.env.RELAY_PUBLIC_ORIGIN || 'https://kivuno.app'}`,
      `Account: ${user.id}`,
      `New wallet: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ];
    const message = context.join('\n');
    const currentWalletMessage =
      current && current.toLowerCase() !== address.toLowerCase()
        ? [
            'Kivuno wallet-change authorization',
            `Origin: ${process.env.RELAY_PUBLIC_ORIGIN || 'https://kivuno.app'}`,
            `Account: ${user.id}`,
            `Current wallet: ${current}`,
            `New wallet: ${address}`,
            `Nonce: ${nonce}`,
            `Issued At: ${new Date(now).toISOString()}`,
            `Expiration Time: ${new Date(expiresAt).toISOString()}`,
          ].join('\n')
        : undefined;
    const challenge: WalletChallenge = {
      id,
      ownerId: user.id,
      address,
      currentAddress: current,
      message,
      ...(currentWalletMessage ? { currentWalletMessage } : {}),
      expiresAt,
    };
    store.put('billingWalletChallenge', { ...challenge, id });
    return {
      challengeId: id,
      message,
      ...(currentWalletMessage ? { currentWalletMessage } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });

  app.post('/api/billing/wallet/bind', async (request) => {
    const user = await userFor(request);
    const input = z
      .object({
        challengeId: z.string().min(20).max(100),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        currentSignature: z
          .string()
          .regex(/^0x[0-9a-fA-F]{130}$/)
          .optional(),
      })
      .strict()
      .parse(request.body);
    const challenge = store.lookup<WalletChallenge>('billingWalletChallenge', input.challengeId);
    if (!challenge || challenge.ownerId !== user.id || challenge.usedAt)
      throw new DomainError('Wallet challenge is invalid or already used.', 409);
    if (challenge.expiresAt <= Date.now())
      throw new DomainError('Wallet challenge expired. Create a new one.', 410);
    let signer: string;
    try {
      signer = getAddress(verifyMessage(challenge.message, input.signature));
    } catch {
      throw new DomainError('Wallet signature is invalid.', 400);
    }
    if (signer !== challenge.address)
      throw new DomainError('Signature does not match the new wallet.', 403);
    let checkedThrough = 0;
    if (
      challenge.currentAddress &&
      challenge.currentAddress.toLowerCase() !== challenge.address.toLowerCase()
    ) {
      if (!challenge.currentWalletMessage || !input.currentSignature)
        throw new DomainError(
          'Changing wallets requires signatures from both the current and new wallet.',
          403,
        );
      let oldSigner: string;
      try {
        oldSigner = getAddress(
          verifyMessage(challenge.currentWalletMessage, input.currentSignature),
        );
      } catch {
        throw new DomainError('Current wallet signature is invalid.', 400);
      }
      if (oldSigner.toLowerCase() !== challenge.currentAddress.toLowerCase())
        throw new DomainError('Current wallet signature does not match.', 403);
      const lastExpiry = pendingThrough(user.id, challenge.currentAddress);
      if (contractAddress) {
        if (!(await configured()))
          throw new DomainError('Cannot verify the old Fuji wallet right now. Retry later.', 503);
        let end: number;
        try {
          const block = await provider.getBlock('latest');
          if (!block) throw new Error('Missing Fuji block');
          checkedThrough = block.timestamp * 1000;
          const subscription = await readSubscription(contractAddress, oldSigner, block.number);
          end = Number(subscription[0]) * 1000;
        } catch {
          throw new DomainError('Cannot verify the old Fuji subscription. Retry later.', 503);
        }
        if (end > checkedThrough)
          throw new DomainError('The old wallet still has an active Fuji subscription.', 409);
      } else if (lastExpiry) {
        throw new DomainError('Fuji must be configured to check the previous payment.', 503);
      }
    }
    store.transaction(() => {
      const latest = store.lookup<WalletChallenge>('billingWalletChallenge', input.challengeId);
      const previous = findBinding(user.id);
      if (
        !latest ||
        latest.usedAt ||
        latest.expiresAt <= Date.now() ||
        (previous?.address || null) !== challenge.currentAddress
      )
        throw new DomainError(
          'Wallet binding changed while this request was open. Create a new challenge.',
          409,
        );
      const claimed = store.lookup<BillingWallet>(
        'billingWalletIndex',
        challenge.address.toLowerCase(),
      );
      if (claimed && claimed.ownerId !== user.id)
        throw new DomainError('This wallet is already linked to another Kivuno account.', 409);
      if (previous && previous.address.toLowerCase() !== challenge.address.toLowerCase()) {
        const lastExpiry = pendingThrough(user.id, previous.address);
        if (lastExpiry && unixSeconds(lastExpiry) >= unixSeconds(checkedThrough))
          throw new DomainError(
            'Wait for Fuji to confirm the previous payment window closed.',
            409,
          );
        store.remove('billingWalletIndex', previous.address.toLowerCase());
      }
      const binding: BillingWallet = {
        id: user.id,
        ownerId: user.id,
        address: challenge.address,
        updatedAt: new Date().toISOString(),
      };
      store.put('billingWallet', binding);
      store.put('billingWalletIndex', {
        id: challenge.address.toLowerCase(),
        ownerId: user.id,
        address: challenge.address,
        updatedAt: binding.updatedAt,
      });
      store.put('billingWalletChallenge', { ...latest, usedAt: Date.now() });
    });
    return { linked: true, address: challenge.address };
  });

  app.post('/api/billing/intent', async (request, reply) => {
    const user = await userFor(request);
    limited(paymentAttempts, user.id, 10);
    const input = z
      .object({ plan: z.enum(['plus', 'max']) })
      .strict()
      .parse(request.body);
    const binding = findBinding(user.id);
    if (!binding) throw new DomainError('Link a wallet before creating a payment.', 409);
    if (!(await configured()))
      throw new DomainError(
        'Fuji payment contract is not deployed or does not match its configuration.',
        503,
      );
    const id = hexlify(randomBytes(32));
    const createdAt = Date.now();
    const expiresAt = createdAt + 15 * 60_000;
    const intent: PaymentIntent = {
      id,
      ownerId: user.id,
      payer: binding.address,
      plan: input.plan,
      amount: PLAN_PRICE[input.plan].toString(),
      token: tokenAddress,
      contract: getAddress(contractAddress),
      treasury: treasuryAddress,
      chainId: FUJI_CHAIN_ID,
      createdAt,
      expiresAt,
      status: 'pending',
    };
    store.transaction(() => {
      requireCurrentPayer(user.id, intent.payer);
      store.put('billingIntent', intent);
    });
    return reply.code(201).send({
      id,
      plan: intent.plan,
      amount: intent.amount,
      payer: intent.payer,
      token: intent.token,
      contract: intent.contract,
      chainId: intent.chainId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  app.post('/api/billing/verify', async (request, reply) => {
    const user = await userFor(request);
    limited(paymentAttempts, `${user.id}:verify`, 30);
    const input = z
      .object({ intentId: intentIdSchema, txHash: txHashSchema })
      .strict()
      .parse(request.body);
    const intent = store.lookup<PaymentIntent>('billingIntent', input.intentId);
    if (!intent || intent.ownerId !== user.id)
      throw new DomainError('Payment intent not found.', 404);
    if (intent.status === 'verified') {
      if (intent.txHash?.toLowerCase() !== input.txHash.toLowerCase())
        throw new DomainError(
          'This payment intent was already verified with another transaction.',
          409,
        );
      return { status: 'verified', verified: true, txHash: intent.txHash };
    }
    requireCurrentPayer(user.id, intent.payer);
    if (!(await configured())) throw new DomainError('Fuji payment contract is unavailable.', 503);
    let transaction;
    let receipt;
    try {
      [transaction, receipt] = await Promise.all([
        provider.getTransaction(input.txHash),
        provider.getTransactionReceipt(input.txHash),
      ]);
    } catch {
      throw new DomainError('Fuji RPC could not read this transaction. Retry shortly.', 503);
    }
    if (!transaction || !receipt) {
      if (Date.now() > intent.expiresAt + 10 * 60_000)
        return reply.code(410).send({
          code: 'PAYMENT_EXPIRED',
          error: 'No Fuji transaction was confirmed before this payment intent expired.',
        });
      return reply.code(202).send({ status: 'pending', verified: false });
    }
    if (receipt.status !== 1)
      return reply.code(409).send({
        code: 'PAYMENT_REVERTED',
        error: 'The Fuji transaction failed; no entitlement was granted.',
      });
    const expectedContract = getAddress(intent.contract);
    if (
      Number(transaction.chainId) !== FUJI_CHAIN_ID ||
      !transaction.to ||
      getAddress(transaction.to) !== expectedContract ||
      getAddress(transaction.from) !== getAddress(intent.payer)
    )
      throw new DomainError(
        'Transaction chain, contract, or payer does not match this payment intent.',
        403,
      );
    let decodedCall;
    try {
      decodedCall = planInterface.parseTransaction({
        data: transaction.data,
        value: transaction.value,
      });
    } catch {
      throw new DomainError(
        'Transaction calldata is invalid for the configured payment contract.',
        403,
      );
    }
    if (
      !decodedCall ||
      decodedCall.name !== 'pay' ||
      String(decodedCall.args[0]).toLowerCase() !== intent.id.toLowerCase() ||
      Number(decodedCall.args[1]) !== PLAN_ID[intent.plan]
    )
      throw new DomainError('Transaction calldata does not match this payment intent.', 403);
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || block.timestamp > unixSeconds(intent.expiresAt))
      throw new DomainError('Payment transaction was mined after the intent expired.', 409);
    const expectedAmount = PLAN_PRICE[intent.plan];
    const events = receipt.logs
      .filter((log) => getAddress(log.address) === expectedContract)
      .map((log) => {
        try {
          return { log, parsed: planInterface.parseLog(log) };
        } catch {
          return { log, parsed: null };
        }
      })
      .filter((entry) => entry.parsed?.name === 'PlanPaid');
    if (events.length !== 1)
      throw new DomainError('Expected one PlanPaid event from the configured contract.', 403);
    const { log, parsed } = events[0];
    if (!parsed) throw new DomainError('Payment event could not be decoded.', 403);
    const [eventIntent, eventPayer, eventPlan, eventToken, eventAmount, paidUntil] = parsed.args;
    if (
      String(eventIntent).toLowerCase() !== intent.id.toLowerCase() ||
      getAddress(eventPayer) !== getAddress(intent.payer) ||
      Number(eventPlan) !== PLAN_ID[intent.plan] ||
      getAddress(eventToken) !== tokenAddress ||
      BigInt(eventAmount) !== expectedAmount ||
      Number(paidUntil) <= block.timestamp
    )
      throw new DomainError('Payment event does not match the server price, wallet, or plan.', 403);
    const transfers = receipt.logs
      .filter((entry) => getAddress(entry.address) === tokenAddress)
      .map((entry) => {
        try {
          const value = usdcInterface.parseLog(entry);
          return value?.name === 'Transfer' ? value.args : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const expectedTransfers = [
      { from: getAddress(intent.payer), to: expectedContract },
      { from: expectedContract, to: treasuryAddress },
    ];
    for (const expected of expectedTransfers) {
      const match = transfers.some(
        (transfer) =>
          transfer &&
          getAddress(transfer[0]) === expected.from &&
          getAddress(transfer[1]) === expected.to &&
          BigInt(transfer[2]) === expectedAmount,
      );
      if (!match)
        throw new DomainError(
          'Fuji USDC transfer to and from the payment contract is missing.',
          403,
        );
    }
    const intentUsed = await provider.call({
      to: expectedContract,
      data: planInterface.encodeFunctionData('usedIntents', [intent.id]),
      blockTag: receipt.blockNumber,
    });
    if (!planInterface.decodeFunctionResult('usedIntents', intentUsed)[0])
      throw new DomainError('The payment contract did not mark this intent as used.', 403);
    const syncedBlock = await provider.getBlockNumber();
    const subscription = await readSubscription(expectedContract, intent.payer, syncedBlock);
    const livePaidUntil = Number(subscription[0]);
    const livePlanId = Number(subscription[1]);
    if (livePaidUntil <= Date.now() / 1000 || (livePlanId !== 1 && livePlanId !== 2))
      throw new DomainError('The configured contract does not show an active subscription.', 403);
    const liveTier: Exclude<Tier, 'free'> = livePlanId === 1 ? 'plus' : 'max';
    const txHash = transaction.hash.toLowerCase();
    const logIndex = log.index;
    const paymentKey = `${FUJI_CHAIN_ID}:${txHash}:${logIndex}`;
    store.transaction(() => {
      const latestIntent = store.lookup<PaymentIntent>('billingIntent', intent.id);
      if (!latestIntent || latestIntent.ownerId !== user.id)
        throw new DomainError('Payment intent changed during verification.', 409);
      if (latestIntent.status === 'verified') {
        if (latestIntent.txHash?.toLowerCase() !== txHash)
          throw new DomainError(
            'This payment intent was already used by another transaction.',
            409,
          );
        return;
      }
      requireCurrentPayer(user.id, latestIntent.payer);
      const existingPayment = store.lookup<{ id: string; intentId: string }>(
        'billingPayment',
        paymentKey,
      );
      if (existingPayment && existingPayment.intentId !== intent.id)
        throw new DomainError('This transaction log was already applied to another payment.', 409);
      const existingIntentPayment = store.lookup<{ id: string; txHash: string }>(
        'billingAppliedIntent',
        intent.id,
      );
      if (existingIntentPayment && existingIntentPayment.txHash.toLowerCase() !== txHash)
        throw new DomainError('This payment intent has already been applied.', 409);
      const verifiedIntent: PaymentIntent = {
        ...latestIntent,
        status: 'verified',
        txHash,
        logIndex,
      };
      store.put('billingIntent', verifiedIntent);
      store.put('billingPayment', {
        id: paymentKey,
        ownerId: user.id,
        intentId: intent.id,
        txHash,
        logIndex,
        chainId: FUJI_CHAIN_ID,
        blockNumber: receipt.blockNumber,
        payer: intent.payer,
        token: tokenAddress,
        amount: intent.amount,
        plan: intent.plan,
        paidUntil: Number(paidUntil) * 1000,
        createdAt: new Date(block.timestamp * 1000).toISOString(),
      });
      store.put('billingAppliedIntent', { id: intent.id, txHash, paymentId: paymentKey });
      const previous = store.lookup<Entitlement>('billingEntitlement', user.id);
      if (!previous || syncedBlock >= previous.syncedBlock)
        store.put('billingEntitlement', {
          id: user.id,
          ownerId: user.id,
          tier: liveTier,
          paidUntil: livePaidUntil * 1000,
          syncedBlock,
          updatedAt: new Date().toISOString(),
        } satisfies Entitlement);
    });
    return {
      status: 'verified',
      verified: true,
      txHash,
      tier: liveTier,
      paidUntil: new Date(livePaidUntil * 1000).toISOString(),
    };
  });

  app.addHook('onClose', async () => provider.destroy());
}
