import { Wallet, getAddress, getBytes, hexlify } from 'ethers';
import { api } from './api';

type SealedWallet = {
  format: 'kivuno-fuji-wallet-v1';
  accountId: string;
  address: string;
  iv: string;
  ciphertext: string;
};

const format = 'kivuno-fuji-wallet-v1';
const wallets = 'wallets';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('kivuno-fuji-wallets', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(wallets, {
        keyPath: ['accountId', 'address'],
      });
      store.createIndex('account', 'accountId');
    };
    request.onerror = () => reject(new Error('Không mở được bộ nhớ ví của trình duyệt.'));
    request.onsuccess = () => resolve(request.result);
  });
}

// The read and optional insert share one transaction. Concurrent tabs must return
// the same committed candidate before either asks the backend to bind it.
async function deviceRecord(
  accountId: string,
  address: string | null,
  insert?: SealedWallet,
  restore = false,
): Promise<SealedWallet | null> {
  const db = await openDatabase();
  try {
    return await new Promise<SealedWallet | null>((resolve, reject) => {
      const tx = db.transaction(wallets, insert ? 'readwrite' : 'readonly');
      const store = tx.objectStore(wallets);
      const request = address
        ? store.get([accountId, address])
        : store.index('account').get(accountId);
      let record: SealedWallet | null = null;
      request.onsuccess = () => {
        record = request.result ?? null;
        if (insert && (restore || !record)) {
          store.put(insert);
          record = insert;
        }
      };
      tx.oncomplete = () => resolve(record);
      tx.onabort = () => reject(new Error('Không lưu hoặc đọc được ví trên thiết bị này.'));
    });
  } finally {
    db.close();
  }
}

async function unlockKey(accountId: string): Promise<CryptoKey> {
  const grant = await api<{ accountId: string; wrappingKey: string }>('/billing/wallet/unlock', {
    accountId,
  });
  if (grant.accountId !== accountId || !/^0x[\da-f]{64}$/i.test(grant.wrappingKey))
    throw new Error('Phiên Kivuno đã thay đổi. Hãy đăng nhập lại.');
  const raw = new Uint8Array(getBytes(grant.wrappingKey));
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

function cipherParams(accountId: string, address: string, iv: Uint8Array<ArrayBuffer>) {
  return {
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(JSON.stringify([format, 43113, accountId, address])),
  };
}

function validated(value: unknown, accountId: string, expected: string | null): SealedWallet {
  const record = value as Partial<SealedWallet> | null;
  if (
    !record ||
    record.format !== format ||
    record.accountId !== accountId ||
    typeof record.address !== 'string' ||
    !/^0x[\da-f]{40}$/i.test(record.address) ||
    typeof record.iv !== 'string' ||
    !/^0x[\da-f]{24}$/i.test(record.iv) ||
    typeof record.ciphertext !== 'string' ||
    !/^0x[\da-f]{96}$/i.test(record.ciphertext)
  )
    throw new Error('Bản sao ví không hợp lệ hoặc thuộc tài khoản Kivuno khác.');
  const address = getAddress(record.address);
  if (expected && address !== expected)
    throw new Error('Địa chỉ trong bản sao không khớp với ví đang liên kết.');
  return { format, accountId, address, iv: record.iv, ciphertext: record.ciphertext };
}

async function seal(key: CryptoKey, accountId: string): Promise<SealedWallet> {
  const wallet = Wallet.createRandom();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = new Uint8Array(getBytes(wallet.privateKey));
  try {
    const cipher = await crypto.subtle.encrypt(
      cipherParams(accountId, wallet.address, iv),
      key,
      raw,
    );
    return {
      format,
      accountId,
      address: wallet.address,
      iv: hexlify(iv),
      ciphertext: hexlify(new Uint8Array(cipher)),
    };
  } finally {
    raw.fill(0);
  }
}

async function unseal(key: CryptoKey, record: SealedWallet): Promise<Wallet> {
  const iv = new Uint8Array(getBytes(record.iv));
  const data = new Uint8Array(getBytes(record.ciphertext));
  const plaintext = await crypto.subtle
    .decrypt(cipherParams(record.accountId, record.address, iv), key, data)
    .catch(() => {
      throw new Error('Không giải mã được ví này với tài khoản Kivuno hiện tại.');
    });
  const raw = new Uint8Array(plaintext);
  try {
    const wallet = new Wallet(hexlify(raw));
    if (wallet.address !== record.address) throw new Error('Địa chỉ ví không khớp với bản sao.');
    return wallet;
  } finally {
    raw.fill(0);
  }
}

export async function walletForAccount(
  accountId: string,
  bound: string | null,
  create: boolean,
): Promise<Wallet | null> {
  const address = bound ? getAddress(bound) : null;
  let record = await deviceRecord(accountId, address);
  if (!record && (address || !create)) return null;
  const key = await unlockKey(accountId);
  if (!record) record = await deviceRecord(accountId, null, await seal(key, accountId));
  return unseal(key, validated(record, accountId, address));
}

export async function backupWallet(accountId: string, bound: string): Promise<void> {
  const address = getAddress(bound);
  const record = validated(await deviceRecord(accountId, address), accountId, address);
  // Verify the backup is recoverable before offering it as the user's copy.
  await unseal(await unlockKey(accountId), record);
  const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `kivuno-fuji-${address}.json`;
  try {
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function restoreWallet(accountId: string, bound: string, file: File): Promise<void> {
  if (!file.size || file.size > 4096) throw new Error('Hãy chọn tệp sao lưu JSON do Kivuno tạo.');
  const address = getAddress(bound);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Không đọc được tệp sao lưu JSON.');
  }
  const record = validated(parsed, accountId, address);
  await unseal(await unlockKey(accountId), record);
  await deviceRecord(accountId, address, record, true);
}
