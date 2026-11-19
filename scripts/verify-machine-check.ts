import { readFile } from 'node:fs/promises';
import { runnerEvidence } from '../server/machine-checks.ts';
import { verifyMachineSignature } from '../server/machine-signature.ts';

const [file, trustedFingerprint] = process.argv.slice(2);
if (!file || !/^[a-f0-9]{64}$/.test(trustedFingerprint || ''))
  throw new Error(
    'Usage: node --import tsx scripts/verify-machine-check.ts <export.json> <trusted runner fingerprint>',
  );
const { evidence, proof } = JSON.parse(await readFile(file, 'utf8'));
const result = runnerEvidence.parse(evidence);
verifyMachineSignature(result, proof, trustedFingerprint);
console.log(JSON.stringify({ signature: 'verified', ...result }, null, 2));
