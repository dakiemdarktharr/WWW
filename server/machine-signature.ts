import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.ts';

export async function machineSigningKey(directory: string): Promise<KeyObject> {
  const file = path.join(directory, 'machine-check-key.pem');
  try {
    return createPrivateKey(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  const temporary = file + '.' + randomUUID();
  await writeFile(temporary, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
    flag: 'wx',
  });
  try {
    // Publish a complete key exactly once, including across overlapping runner processes.
    await link(temporary, file);
    return privateKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return createPrivateKey(await readFile(file));
  } finally {
    await unlink(temporary);
  }
}
export function signMachineResult(key: KeyObject, subject: unknown) {
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
  return {
    publicKey,
    signature: sign(null, Buffer.from(canonicalJson(subject)), key).toString('base64'),
  };
}
export function signerFingerprint(publicKey: string) {
  return createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
}
export function verifyMachineSignature(
  subject: unknown,
  proof: { publicKey: string; signature: string },
  trustedFingerprint: string,
) {
  if (signerFingerprint(proof.publicKey) !== trustedFingerprint)
    throw new Error('Unexpected paired runner signing key.');
  const key = createPublicKey({
    key: Buffer.from(proof.publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(null, Buffer.from(canonicalJson(subject)), key, Buffer.from(proof.signature, 'base64'))
  )
    throw new Error('Invalid paired runner signature.');
}
