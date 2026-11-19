import {
  BrowserProvider,
  Contract,
  ContractFactory,
  formatEther,
  getAddress,
  type InterfaceAbi,
  parseEther,
  type Eip1193Provider,
  type JsonRpcSigner,
} from 'ethers';

const FUJI_CHAIN_ID = 43113;
const FUJI_EXPLORER_URL = 'https://build.avax.network/explorer/fuji/c-chain';
const USDC_ADDRESS = getAddress('0x5425890298aed601595a70AB815c96711a31Bc65');
const TREASURY_ADDRESS = getAddress('0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805');
const EXPECTED_DEPLOYER = getAddress('0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805');
const GAS_RESERVE = parseEther('0.01');
const DEPLOYMENT_ATTEMPT_KEY = 'kivuno.fuji.deployment-attempt.v1';

type DeploymentAttempt = {
  state: 'in_flight' | 'submitted' | 'confirmed' | 'unknown';
  account: string;
  chainId: number;
  startedAt: string;
  hash?: string;
  contractAddress?: string;
};

type InjectedWallet = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type ContractArtifact = {
  compiler: string;
  chainId: number;
  abi: InterfaceAbi;
  bytecode: string;
};

const connectButton = document.querySelector<HTMLButtonElement>('#connect-button')!;
const deployButton = document.querySelector<HTMLButtonElement>('#deploy-button')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const gasEstimate = document.querySelector<HTMLElement>('#gas-estimate')!;
const balanceSummary = document.querySelector<HTMLElement>('#balance-summary')!;
const transactionLink = document.querySelector<HTMLAnchorElement>('#transaction-link')!;
const attemptNotice = document.querySelector<HTMLElement>('#attempt-lock')!;
const attemptSummary = document.querySelector<HTMLElement>('#attempt-summary')!;
const attemptHashWrap = document.querySelector<HTMLElement>('#attempt-hash-wrap')!;
const attemptHash = document.querySelector<HTMLElement>('#attempt-hash')!;
const attemptExplorerLink = document.querySelector<HTMLAnchorElement>('#attempt-explorer')!;
const resolveAttemptButton = document.querySelector<HTMLButtonElement>('#resolve-attempt-button')!;

let injected: InjectedWallet | null = null;
let provider: BrowserProvider | null = null;
let signer: JsonRpcSigner | null = null;
let account = '';
let artifact: ContractArtifact | null = null;
let preflightValid = false;
let deploymentComplete = false;
let transactionSubmitted = false;
let deploymentAttempt: DeploymentAttempt | null = null;
let attemptStorageUnavailable = false;

function setStatus(message: string, tone: 'neutral' | 'error' | 'success' = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function setCheck(name: 'wallet' | 'chain' | 'token' | 'gas', ready: boolean) {
  document.querySelector(`#check-${name}`)?.classList.toggle('ready', ready);
}

function rejectReason(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; shortMessage?: unknown };
  return (
    candidate.code === 4001 ||
    candidate.code === 'ACTION_REJECTED' ||
    /user (denied|rejected)|rejected by user/i.test(
      `${candidate.message || ''} ${candidate.shortMessage || ''}`,
    )
  );
}

function readDeploymentAttempt(): DeploymentAttempt | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(DEPLOYMENT_ATTEMPT_KEY);
  } catch {
    attemptStorageUnavailable = true;
    return null;
  }
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<DeploymentAttempt>;
    if (
      (value.state === 'in_flight' ||
        value.state === 'submitted' ||
        value.state === 'confirmed' ||
        value.state === 'unknown') &&
      typeof value.account === 'string' &&
      getAddress(value.account) === EXPECTED_DEPLOYER &&
      value.chainId === FUJI_CHAIN_ID &&
      typeof value.startedAt === 'string'
    ) {
      return value as DeploymentAttempt;
    }
  } catch {
    // An unreadable marker must fail closed instead of allowing another deployment.
  }
  return {
    state: 'unknown',
    account: EXPECTED_DEPLOYER,
    chainId: FUJI_CHAIN_ID,
    startedAt: 'unknown',
  };
}

function writeDeploymentAttempt(attempt: DeploymentAttempt) {
  try {
    window.localStorage.setItem(DEPLOYMENT_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    attemptStorageUnavailable = true;
    throw new Error('Browser storage is unavailable. The deploy request was not started.');
  }
  attemptStorageUnavailable = false;
  deploymentAttempt = attempt;
  renderAttemptLock();
}

function clearDeploymentAttempt() {
  try {
    window.localStorage.removeItem(DEPLOYMENT_ATTEMPT_KEY);
  } catch {
    attemptStorageUnavailable = true;
    throw new Error('Could not clear the deployment-attempt marker. Keep the deploy locked.');
  }
  attemptStorageUnavailable = false;
  deploymentAttempt = null;
  renderAttemptLock();
}

function renderAttemptLock() {
  const locked = attemptStorageUnavailable || deploymentAttempt !== null;
  attemptNotice.hidden = !locked;
  resolveAttemptButton.hidden =
    attemptStorageUnavailable ||
    deploymentAttempt === null ||
    deploymentAttempt.state === 'confirmed';

  if (attemptStorageUnavailable) {
    attemptSummary.textContent =
      'Browser storage is unavailable. Deployment stays disabled because the page cannot protect against a duplicate request.';
    attemptHashWrap.hidden = true;
    return;
  }
  if (!deploymentAttempt) return;

  if (deploymentAttempt.state === 'confirmed') {
    const address = deploymentAttempt.contractAddress || 'address not recorded';
    attemptSummary.textContent = `A Fuji contract deployment was confirmed and verified: ${address}`;
    attemptExplorerLink.textContent = 'Open Fuji C-Chain Explorer';
    attemptExplorerLink.href = FUJI_EXPLORER_URL;
  } else if (deploymentAttempt.state === 'submitted') {
    attemptSummary.textContent =
      'A deployment transaction was submitted. Check its Fuji receipt before considering a retry.';
    attemptExplorerLink.textContent = 'Open Fuji C-Chain Explorer';
    attemptExplorerLink.href = FUJI_EXPLORER_URL;
  } else {
    attemptSummary.textContent =
      'A previous deployment request may have reached Core or Fuji without returning a transaction hash. Check Core activity and the Fuji explorer before retrying.';
    attemptExplorerLink.textContent = 'Open Fuji C-Chain Explorer';
    attemptExplorerLink.href = FUJI_EXPLORER_URL;
  }

  const hashOrAddress = deploymentAttempt.hash || deploymentAttempt.contractAddress;
  attemptHashWrap.hidden = !hashOrAddress;
  attemptHash.textContent = hashOrAddress || '';
}

function unlockAfterManualReconciliation() {
  if (!deploymentAttempt || deploymentAttempt.state === 'confirmed') return;
  const confirmed = window.confirm(
    'Only continue if you checked Core activity and the Fuji C-Chain explorer and confirmed that no successful or pending deployment exists. Clear the retry lock?',
  );
  if (!confirmed) return;
  try {
    clearDeploymentAttempt();
    transactionSubmitted = false;
    preflightValid = false;
    deployButton.disabled = true;
    setStatus('Retry lock cleared. Connect Core again to repeat all preflight checks.');
  } catch (error) {
    renderAttemptLock();
    setStatus(
      error instanceof Error ? error.message : 'The deploy retry lock remains active.',
      'error',
    );
  }
}

function selectWallet(): InjectedWallet {
  const walletWindow = window as Window & {
    avalanche?: Eip1193Provider;
    ethereum?: Eip1193Provider;
  };
  const selected = walletWindow.avalanche ?? walletWindow.ethereum;
  if (!selected)
    throw new Error('Core wallet was not detected. Open this page in Edge with Core enabled.');
  return selected as InjectedWallet;
}

async function loadArtifact() {
  const response = await fetch('/shared/kivuno-plans-artifact.json', { cache: 'no-store' });
  if (!response.ok)
    throw new Error('Compiled artifact is missing. Run npm run payment:compile first.');
  const value = (await response.json()) as ContractArtifact;
  if (
    value.chainId !== FUJI_CHAIN_ID ||
    typeof value.bytecode !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(value.bytecode) ||
    !Array.isArray(value.abi)
  ) {
    throw new Error('Compiled contract artifact is invalid or for a different network.');
  }
  return value;
}

async function connectWallet() {
  if (deploymentComplete || transactionSubmitted) return;
  deploymentAttempt = readDeploymentAttempt();
  renderAttemptLock();
  preflightValid = false;
  deployButton.disabled = true;
  setCheck('wallet', false);
  setCheck('chain', false);
  setCheck('token', false);
  setCheck('gas', false);
  transactionLink.style.display = 'none';
  connectButton.disabled = true;
  setStatus('Connecting to the wallet extension…');

  try {
    injected = selectWallet();
    provider = new BrowserProvider(injected, 'any');
    const accounts = await provider.send('eth_requestAccounts', []);
    const selectedAccount = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof selectedAccount !== 'string')
      throw new Error('The wallet did not return an account.');
    account = getAddress(selectedAccount);
    signer = await provider.getSigner(account);
    setCheck('wallet', true);

    const network = await provider.getNetwork();
    if (Number(network.chainId) !== FUJI_CHAIN_ID) {
      setCheck('wallet', true);
      throw new Error('Switch Core to Avalanche Fuji (C-Chain) and connect again.');
    }
    setCheck('chain', true);

    if (account !== EXPECTED_DEPLOYER) {
      throw new Error(
        `Connected account does not match the configured deployer ${EXPECTED_DEPLOYER}.`,
      );
    }

    artifact = await loadArtifact();
    const tokenCode = await provider.getCode(USDC_ADDRESS);
    if (tokenCode === '0x')
      throw new Error('The configured Fuji USDC address has no contract code.');
    setCheck('token', true);

    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const deployment = await factory.getDeployTransaction(USDC_ADDRESS, TREASURY_ADDRESS);
    const estimatedGas = await provider.estimateGas({ ...deployment, from: account });
    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!maxFeePerGas) throw new Error('Fuji RPC did not return a usable gas price.');

    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    const maxCost = gasLimit * maxFeePerGas;
    const balance = await provider.getBalance(account);
    if (balance < maxCost + GAS_RESERVE) {
      throw new Error('The wallet balance is below the estimated maximum gas cost plus reserve.');
    }

    gasEstimate.textContent = `${formatEther(maxCost)} AVAX`;
    balanceSummary.textContent = `Available: ${formatEther(balance)} AVAX · includes a 0.01 AVAX reserve.`;
    setCheck('gas', true);
    preflightValid = true;
    deployButton.disabled = attemptStorageUnavailable || deploymentAttempt !== null;
    setStatus(
      attemptStorageUnavailable
        ? 'Preflight passed, but browser storage is unavailable; deployment remains locked.'
        : deploymentAttempt
          ? 'Preflight passed, but an earlier deployment attempt must be reconciled first.'
          : 'Checks passed. Review the same network and account in Core before deployment.',
      attemptStorageUnavailable || deploymentAttempt ? 'error' : 'success',
    );
  } catch (error) {
    setStatus(
      rejectReason(error)
        ? 'Wallet connection was declined. No deployment transaction was sent.'
        : error instanceof Error
          ? error.message
          : 'Wallet preflight failed. No deployment transaction was sent.',
      'error',
    );
  } finally {
    connectButton.disabled = deploymentComplete || transactionSubmitted;
  }
}

async function deployContract() {
  if (
    deploymentComplete ||
    transactionSubmitted ||
    !provider ||
    !signer ||
    !injected ||
    !artifact ||
    !preflightValid
  )
    return;
  deploymentAttempt = readDeploymentAttempt();
  renderAttemptLock();
  if (attemptStorageUnavailable || deploymentAttempt) {
    preflightValid = false;
    deployButton.disabled = true;
    setStatus('An earlier deployment attempt is locked. Reconcile it before retrying.', 'error');
    return;
  }
  deployButton.disabled = true;
  connectButton.disabled = true;
  setStatus('Rechecking the account, network, token, and gas estimate…');
  transactionLink.style.display = 'none';

  let submittedHash = '';
  let deploymentRequestStarted = false;
  try {
    preflightValid = false;
    const accounts = await provider.send('eth_accounts', []);
    const selectedAccount = Array.isArray(accounts) ? accounts[0] : undefined;
    const network = await provider.getNetwork();
    if (
      typeof selectedAccount !== 'string' ||
      getAddress(selectedAccount) !== EXPECTED_DEPLOYER ||
      Number(network.chainId) !== FUJI_CHAIN_ID
    ) {
      preflightValid = false;
      throw new Error('Wallet account or network changed. Connect again before deploying.');
    }

    const tokenCode = await provider.getCode(USDC_ADDRESS);
    if (tokenCode === '0x')
      throw new Error('Fuji USDC code check failed. No deployment transaction was sent.');
    artifact = await loadArtifact();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const deployment = await factory.getDeployTransaction(USDC_ADDRESS, TREASURY_ADDRESS);
    const estimatedGas = await provider.estimateGas({ ...deployment, from: EXPECTED_DEPLOYER });
    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!maxFeePerGas) throw new Error('Fuji RPC did not return a usable gas price.');
    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    const balance = await provider.getBalance(EXPECTED_DEPLOYER);
    if (balance < gasLimit * maxFeePerGas + GAS_RESERVE) {
      throw new Error('The wallet balance is below the current gas estimate plus reserve.');
    }

    deploymentAttempt = readDeploymentAttempt();
    if (attemptStorageUnavailable || deploymentAttempt) {
      throw new Error('Another deployment attempt is locked. Reconcile it before retrying.');
    }
    const attemptStartedAt = new Date().toISOString();
    writeDeploymentAttempt({
      state: 'in_flight',
      account: EXPECTED_DEPLOYER,
      chainId: FUJI_CHAIN_ID,
      startedAt: attemptStartedAt,
    });

    preflightValid = true;
    deploymentRequestStarted = true;
    transactionSubmitted = true;
    setStatus(
      'Core is opening the deployment transaction. Check Fuji, the deployer, and the fee there.',
    );
    const deployed = await factory.deploy(USDC_ADDRESS, TREASURY_ADDRESS, { gasLimit });
    const transaction = deployed.deploymentTransaction();
    if (!transaction) throw new Error('Core returned no deployment transaction.');
    submittedHash = transaction.hash;
    writeDeploymentAttempt({
      state: 'submitted',
      account: EXPECTED_DEPLOYER,
      chainId: FUJI_CHAIN_ID,
      startedAt: attemptStartedAt,
      hash: submittedHash,
    });
    transactionLink.href = FUJI_EXPLORER_URL;
    transactionLink.textContent = `Open Fuji Explorer and search transaction ${submittedHash}`;
    transactionLink.style.display = 'inline-block';
    setStatus(
      'Transaction submitted. Waiting for Fuji confirmation; do not retry while it is pending.',
    );

    await deployed.waitForDeployment();
    const contractAddress = getAddress(await deployed.getAddress());
    const deployedCode = await provider.getCode(contractAddress);
    const reader = new Contract(contractAddress, artifact.abi, provider);
    const [configuredToken, configuredTreasury] = await Promise.all([
      reader.getFunction('usdc')(),
      reader.getFunction('treasury')(),
    ]);
    if (
      deployedCode === '0x' ||
      getAddress(String(configuredToken)) !== USDC_ADDRESS ||
      getAddress(String(configuredTreasury)) !== TREASURY_ADDRESS
    ) {
      throw new Error(
        'Transaction confirmed, but deployed code or constructor values failed verification.',
      );
    }

    writeDeploymentAttempt({
      state: 'confirmed',
      account: EXPECTED_DEPLOYER,
      chainId: FUJI_CHAIN_ID,
      startedAt: attemptStartedAt,
      hash: submittedHash,
      contractAddress,
    });
    transactionLink.href = FUJI_EXPLORER_URL;
    transactionLink.textContent = `Open Fuji Explorer and search verified contract ${contractAddress}`;
    deploymentComplete = true;
    connectButton.disabled = true;
    deployButton.disabled = true;
    setStatus(
      'Contract deployed and verified on Fuji. Save this public contract address for local app configuration.',
      'success',
    );
  } catch (error) {
    if (submittedHash) {
      setStatus(
        'A transaction was submitted. Check its Fuji receipt before taking any further action.',
        'error',
      );
    } else if (rejectReason(error)) {
      if (deploymentRequestStarted) {
        try {
          clearDeploymentAttempt();
          transactionSubmitted = false;
          preflightValid = true;
          setStatus('Deployment was declined in Core. No contract was created.', 'neutral');
          deployButton.disabled = false;
        } catch (clearError) {
          setStatus(
            clearError instanceof Error
              ? clearError.message
              : 'Deployment was declined, but the retry lock could not be cleared.',
            'error',
          );
        }
      } else {
        setStatus('Deployment was declined in Core. No contract was created.', 'neutral');
        deployButton.disabled = false;
      }
    } else if (deploymentRequestStarted) {
      preflightValid = false;
      setStatus(
        'The deployment request ended without a transaction hash. Check Core activity before trying again.',
        'error',
      );
    } else {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Preflight failed. No deployment transaction was sent.',
        'error',
      );
      deployButton.disabled =
        !preflightValid || attemptStorageUnavailable || deploymentAttempt !== null;
    }
  } finally {
    connectButton.disabled = deploymentComplete || transactionSubmitted;
  }
}

connectButton.addEventListener('click', () => void connectWallet());
deployButton.addEventListener('click', () => void deployContract());
resolveAttemptButton.addEventListener('click', unlockAfterManualReconciliation);

deploymentAttempt = readDeploymentAttempt();
renderAttemptLock();
if (deploymentAttempt || attemptStorageUnavailable) {
  deployButton.disabled = true;
  setStatus(
    attemptStorageUnavailable
      ? 'Browser storage is unavailable; deployment is locked.'
      : 'An earlier deployment attempt is locked and needs reconciliation.',
    'error',
  );
}

window.addEventListener('storage', (event) => {
  if (event.key !== DEPLOYMENT_ATTEMPT_KEY && event.key !== null) return;
  deploymentAttempt = readDeploymentAttempt();
  renderAttemptLock();
  preflightValid = false;
  deployButton.disabled = true;
  setStatus(
    deploymentAttempt || attemptStorageUnavailable
      ? 'A deployment attempt is locked in another tab or session. Reconcile it before retrying.'
      : 'Deployment state changed. Connect Core again to rerun preflight checks.',
    deploymentAttempt || attemptStorageUnavailable ? 'error' : 'neutral',
  );
});

const walletWindow = window as Window & {
  avalanche?: Eip1193Provider;
  ethereum?: Eip1193Provider;
};
const initialWallet = walletWindow.avalanche ?? walletWindow.ethereum;
if (initialWallet && 'on' in initialWallet && typeof initialWallet.on === 'function') {
  const resetPreflight = () => {
    preflightValid = false;
    deployButton.disabled = true;
    setCheck('wallet', false);
    setCheck('chain', false);
    setCheck('token', false);
    setCheck('gas', false);
    setStatus('Wallet account or network changed. Connect again to rerun preflight.');
  };
  (initialWallet as InjectedWallet).on?.('accountsChanged', resetPreflight);
  (initialWallet as InjectedWallet).on?.('chainChanged', resetPreflight);
}
