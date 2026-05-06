import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  parseUnits,
  formatUnits,
  pad,
  getAddress,
  isAddress,
} from 'https://esm.sh/viem@2.21';

import {
  SOURCE_CHAINS,
  INJECTIVE,
  ATTESTATION_API,
  STANDARD_FINALITY,
  STANDARD_MAX_FEE,
  ZERO_BYTES32,
  viemChain,
} from './chains.js';

import {
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  ERC20_ABI,
} from './cctp.js';

const $ = (id) => document.getElementById(id);

const elConnect = $('connect-btn');
const elSource = $('source-select');
const elAmount = $('amount');
const elMax = $('max-btn');
const elRecipient = $('recipient');
const elBridge = $('bridge-btn');
const elBalance = $('balance');
const elTimeline = $('timeline');
const elSteps = $('steps');

let account = null;
let walletClient = null;

for (const c of SOURCE_CHAINS) {
  const opt = document.createElement('option');
  opt.value = c.id;
  opt.textContent = c.name;
  elSource.appendChild(opt);
}

function getSource() {
  return SOURCE_CHAINS.find((c) => c.id === Number(elSource.value));
}

function shortAddr(a) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function ensureWallet() {
  if (!window.ethereum) {
    throw new Error('No wallet detected. Install MetaMask, Rabby, or another EIP-1193 wallet.');
  }
}

async function connect() {
  ensureWallet();
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = getAddress(accounts[0]);
  walletClient = createWalletClient({
    account,
    transport: custom(window.ethereum),
  });
  elConnect.textContent = shortAddr(account);
  if (!elRecipient.value) elRecipient.value = account;
  elBridge.disabled = false;
  refreshBalance();
}

function publicClient(c) {
  return createPublicClient({
    chain: viemChain(c),
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: 8000 }))),
  });
}

async function refreshBalance() {
  if (!account) return;
  const src = getSource();
  elBalance.textContent = 'loading balance…';
  elBalance.removeAttribute('title');
  try {
    const bal = await publicClient(src).readContract({
      address: src.usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
    elBalance.textContent = `${formatUnits(bal, 6)} USDC available`;
    elBalance.dataset.raw = bal.toString();
  } catch (err) {
    console.error('balance fetch failed for', src.name, err);
    elBalance.textContent = 'balance unavailable (hover for error)';
    elBalance.title = err.shortMessage || err.message || String(err);
    delete elBalance.dataset.raw;
  }
}

async function ensureChain(chain) {
  const hexId = '0x' + chain.id.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }],
    });
  } catch (err) {
    if (err.code === 4902 || err?.data?.originalError?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcs,
          blockExplorerUrls: [chain.explorer],
        }],
      });
    } else {
      throw err;
    }
  }
}

const STEPS = [
  { key: 'approve', label: 'Approve USDC' },
  { key: 'burn', label: 'Burn on source' },
  { key: 'attest', label: 'Wait for Circle attestation' },
  { key: 'switch', label: 'Switch to Injective EVM' },
  { key: 'mint', label: 'Mint on Injective' },
];

function renderSteps(state, skipApprove) {
  elTimeline.hidden = false;
  elSteps.innerHTML = '';
  let n = 1;
  for (const s of STEPS) {
    if (s.key === 'approve' && skipApprove) continue;
    const status = state[s.key]?.status || 'pending';
    const detail = state[s.key]?.detail || '';
    const li = document.createElement('li');
    li.className = `step ${status}`;
    const marker = status === 'done' ? '✓' : status === 'failed' ? '✕' : String(n);
    li.innerHTML = `
      <div class="step-marker">${marker}</div>
      <div class="step-body">
        <div class="step-label">${escapeHtml(s.label)}</div>
        ${detail ? `<div class="step-detail">${detail}</div>` : ''}
      </div>
    `;
    elSteps.appendChild(li);
    n++;
  }
}

function txLink(explorer, hash) {
  return `<a href="${explorer}/tx/${hash}" target="_blank" rel="noopener">${shortAddr(hash)}</a>`;
}

async function bridge() {
  elBridge.disabled = true;
  elBridge.textContent = 'Bridge to Injective';
  const state = {};
  let skipApprove = false;
  let lastKey = null;

  const setStep = (key, status, detail) => {
    state[key] = { status, detail };
    lastKey = key;
    renderSteps(state, skipApprove);
  };

  try {
    if (!account) throw new Error('Connect a wallet first.');
    const src = getSource();
    const amount = parseUnits(elAmount.value || '0', 6);
    if (amount === 0n) throw new Error('Enter an amount.');

    const recipientRaw = (elRecipient.value || '').trim() || account;
    if (!isAddress(recipientRaw)) throw new Error('Recipient must be a valid 0x… address.');
    const recipient = getAddress(recipientRaw);
    const mintRecipient = pad(recipient, { size: 32 });

    const sourceClient = publicClient(src);
    const injClient = publicClient(INJECTIVE);

    await ensureChain(src);

    const allowance = await sourceClient.readContract({
      address: src.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, src.cctp.tokenMessenger],
    });

    if (allowance >= amount) {
      skipApprove = true;
      renderSteps(state, skipApprove);
    } else {
      setStep('approve', 'active', 'sign in wallet…');
      const approveHash = await walletClient.writeContract({
        address: src.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [src.cctp.tokenMessenger, amount],
        chain: viemChain(src),
      });
      setStep('approve', 'active', `${txLink(src.explorer, approveHash)} confirming…`);
      await sourceClient.waitForTransactionReceipt({ hash: approveHash });
      setStep('approve', 'done', txLink(src.explorer, approveHash));
    }

    setStep('burn', 'active', 'sign burn in wallet…');
    const burnHash = await walletClient.writeContract({
      address: src.cctp.tokenMessenger,
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: 'depositForBurn',
      args: [
        amount,
        INJECTIVE.domain,
        mintRecipient,
        src.usdc,
        ZERO_BYTES32,
        STANDARD_MAX_FEE,
        STANDARD_FINALITY,
      ],
      chain: viemChain(src),
    });
    setStep('burn', 'active', `${txLink(src.explorer, burnHash)} confirming…`);
    await sourceClient.waitForTransactionReceipt({ hash: burnHash });
    setStep('burn', 'done', txLink(src.explorer, burnHash));

    setStep('attest', 'active', `polling Circle (${src.finalityHint || 'standard finality'})…`);
    const { message, attestation } = await pollAttestation(src.domain, burnHash, (elapsed) => {
      state.attest.detail = `polling Circle… ${formatElapsed(elapsed)} elapsed (${src.finalityHint || 'standard finality'})`;
      renderSteps(state, skipApprove);
    });
    setStep('attest', 'done', 'attestation received');

    setStep('switch', 'active', 'switching network…');
    await ensureChain(INJECTIVE);
    setStep('switch', 'done', '');

    setStep('mint', 'active', 'sign mint in wallet…');
    const mintHash = await walletClient.writeContract({
      address: INJECTIVE.cctp.messageTransmitter,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'receiveMessage',
      args: [message, attestation],
      chain: viemChain(INJECTIVE),
    });
    setStep('mint', 'active', `${txLink(INJECTIVE.explorer, mintHash)} confirming…`);
    await injClient.waitForTransactionReceipt({ hash: mintHash });
    setStep('mint', 'done', `minted to ${shortAddr(recipient)} · ${txLink(INJECTIVE.explorer, mintHash)}`);

    elBridge.textContent = 'Bridge another →';
    refreshBalance();
  } catch (err) {
    console.error(err);
    const msg = err.shortMessage || err.details || err.message || String(err);
    if (lastKey) {
      state[lastKey] = { status: 'failed', detail: escapeHtml(msg) };
    } else {
      state.approve = { status: 'failed', detail: escapeHtml(msg) };
    }
    renderSteps(state, skipApprove);
  } finally {
    elBridge.disabled = false;
  }
}

async function pollAttestation(srcDomain, txHash, onProgress) {
  const url = `${ATTESTATION_API}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  const start = Date.now();
  const timeoutMs = 30 * 60 * 1000;

  while (true) {
    if (onProgress) onProgress(Date.now() - start);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.[0];
        if (msg && msg.status === 'complete' && msg.attestation && msg.attestation !== 'PENDING') {
          return { message: msg.message, attestation: msg.attestation };
        }
      }
    } catch {
      // network blip, retry
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Attestation timed out after 30 minutes.');
    }
    await sleep(5000);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

elConnect.addEventListener('click', () => connect().catch((e) => alert(e.message)));
elSource.addEventListener('change', refreshBalance);
elMax.addEventListener('click', () => {
  if (elBalance.dataset.raw) {
    elAmount.value = formatUnits(BigInt(elBalance.dataset.raw), 6);
  }
});
elBridge.addEventListener('click', bridge);

if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then((accts) => {
    if (accts && accts.length) connect().catch(() => {});
  }).catch(() => {});

  window.ethereum.on?.('accountsChanged', (accts) => {
    if (!accts.length) {
      account = null;
      walletClient = null;
      elConnect.textContent = 'Connect';
      elBridge.disabled = true;
      elBalance.textContent = '';
    } else {
      connect().catch(() => {});
    }
  });
}
