import fs from 'node:fs/promises';
import path from 'node:path';
import solc from 'solc';
const root = path.resolve(import.meta.dirname, '..');
const input = {
  language: 'Solidity',
  sources: {
    'RelayAegis.sol': {
      content: await fs.readFile(path.join(root, 'contracts/RelayAegis.sol'), 'utf8'),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'shanghai',
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (name) => {
      if (!name.startsWith('@openzeppelin/contracts/') || name.includes('..'))
        return { error: 'Import denied' };
      try {
        return { contents: requireRead(path.join(root, 'node_modules', name)) };
      } catch {
        return { error: `Missing dependency: ${name}` };
      }
    },
  }),
);
function requireRead(filename) {
  return readSync(filename, 'utf8');
}
import { readFileSync as readSync } from 'node:fs';
const failures = (output.errors || []).filter((entry) => entry.severity === 'error');
if (failures.length) throw new Error(failures.map((entry) => entry.formattedMessage).join('\n'));
const built = output.contracts['RelayAegis.sol'].RelayAegis;
const artifact = {
  compiler: solc.version(),
  chainId: 43113,
  abi: built.abi,
  bytecode: `0x${built.evm.bytecode.object}`,
  deployedBytecode: `0x${built.evm.deployedBytecode.object}`,
};
await fs.writeFile(
  path.join(root, 'shared/aegis-artifact.json'),
  JSON.stringify(artifact, null, 2) + '\n',
);
console.log(
  `Compiled RelayAegis with ${artifact.compiler}; ${built.evm.bytecode.object.length / 2} deployment bytes.`,
);
