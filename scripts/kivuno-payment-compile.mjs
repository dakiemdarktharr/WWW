import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
const testBuild = process.argv.includes('--test-shanghai');
const suffix = testBuild ? '-test-shanghai' : '';
const sources = {};
for (const file of ['KivunoPlans.sol', 'KivunoPlansSponsored.sol', 'test/MockUSDC.sol']) {
  sources[file] = { content: await fs.readFile(path.join(root, 'contracts', file), 'utf8') };
}
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: testBuild ? 'shanghai' : 'cancun',
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import(name) {
      if (!name.startsWith('@openzeppelin/contracts/') || name.includes('..'))
        return { error: 'Import denied' };
      try {
        return { contents: readFileSync(path.join(root, 'node_modules', name), 'utf8') };
      } catch {
        return { error: `Missing dependency: ${name}` };
      }
    },
  }),
);
const failures = (output.errors || []).filter((entry) => entry.severity === 'error');
if (failures.length) throw new Error(failures.map((entry) => entry.formattedMessage).join('\n'));

for (const [source, contractName, target] of [
  ['KivunoPlans.sol', 'KivunoPlans', `kivuno-plans${suffix}-artifact.json`],
  [
    'KivunoPlansSponsored.sol',
    'KivunoPlansSponsored',
    `kivuno-plans-sponsored${suffix}-artifact.json`,
  ],
  ['test/MockUSDC.sol', 'MockUSDC', `mock-usdc${suffix}-artifact.json`],
]) {
  const built = output.contracts[source][contractName];
  const artifact = {
    compiler: solc.version(),
    chainId: 43113,
    abi: built.abi,
    bytecode: `0x${built.evm.bytecode.object}`,
    deployedBytecode: `0x${built.evm.deployedBytecode.object}`,
  };
  await fs.writeFile(path.join(root, 'shared', target), JSON.stringify(artifact, null, 2) + '\n');
  console.log(
    `Compiled ${contractName} with ${artifact.compiler}; ${built.evm.bytecode.object.length / 2} deployment bytes.`,
  );
}
