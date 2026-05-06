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

// ─── Display map ──────────────────────────────────────────────────────────────
// Per-chain visual info for the redesigned UI. Keyed by chain id; mirrors the
// chain-mark CSS classes in styles.css. `chains.js` stays untouched (locked).
const CHAIN_DISPLAY = {
  1:     { mark: 'eth',  letter: 'Ξ' },
  42161: { mark: 'arb',  letter: 'A' },
  8453:  { mark: 'base', letter: 'B' },
  10:    { mark: 'op',   letter: 'OP' },
  137:   { mark: 'poly', letter: 'P' },
  43114: { mark: 'avax', letter: 'A' },
};

// ─── Phase render table ───────────────────────────────────────────────────────
// Per the design handoff (§3.2). Maps a derived phase to all visual classes /
// states. Field semantics:
//   source/circle/inj: tone string ('idle-pulse' | 'dim' | 'live cyan' |
//                                   'live amber' | 'live green' | 'live red' | 'done')
//   seg1/seg2:         segment class suffix ('empty' | 'full' | 'cyan-amber' |
//                                            'amber' | 'amber-green' | 'green')
//   seg1Fill/seg2Fill: % height for .fill (0 / 50 / 100)
//   disc:              { seg: 1|2, top: '8%'|'50%'|'92%', tone: ''|'amber'|'green', orbit: bool } | null
//   pill:              { cls: ''|'idle'|'amber'|'green'|'red', text }
//   btn:               { cls: ''|'active'|'success', label, disabled }
const PHASES = {
  idle: {
    source: 'idle-pulse', circle: 'dim', inj: 'dim',
    seg1: 'empty', seg1Fill: 0, seg2: 'empty', seg2Fill: 0,
    disc: null,
    pill: { cls: 'idle', text: 'IDLE' },
    btn:  { cls: '', label: 'BRIDGE TO INJECTIVE', disabled: false },
  },
  'approve-sign': {
    source: 'live cyan', circle: 'dim', inj: 'dim',
    seg1: 'empty', seg1Fill: 0, seg2: 'empty', seg2Fill: 0,
    disc: { seg: 1, top: '8%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  'approve-confirm': {
    source: 'live cyan', circle: 'dim', inj: 'dim',
    seg1: 'full', seg1Fill: 50, seg2: 'empty', seg2Fill: 0,
    disc: { seg: 1, top: '8%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  'burn-sign': {
    source: 'live cyan', circle: 'dim', inj: 'dim',
    seg1: 'full', seg1Fill: 50, seg2: 'empty', seg2Fill: 0,
    disc: { seg: 1, top: '8%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  'burn-confirm': {
    source: 'live cyan', circle: 'dim', inj: 'dim',
    seg1: 'full', seg1Fill: 50, seg2: 'empty', seg2Fill: 0,
    disc: { seg: 1, top: '8%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  attest: {
    source: 'done', circle: 'live amber', inj: 'dim',
    seg1: 'cyan-amber', seg1Fill: 100, seg2: 'empty', seg2Fill: 0,
    disc: { seg: 1, top: '92%', tone: 'amber', orbit: true },
    pill: { cls: 'amber', text: 'WAITING' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  switch: {
    source: 'done', circle: 'done', inj: 'dim',
    seg1: 'full', seg1Fill: 100, seg2: 'amber', seg2Fill: 50,
    disc: { seg: 2, top: '50%', tone: 'amber', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  'mint-sign': {
    source: 'done', circle: 'done', inj: 'live cyan',
    seg1: 'full', seg1Fill: 100, seg2: 'amber-green', seg2Fill: 100,
    disc: { seg: 2, top: '92%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  'mint-confirm': {
    source: 'done', circle: 'done', inj: 'live cyan',
    seg1: 'full', seg1Fill: 100, seg2: 'amber-green', seg2Fill: 100,
    disc: { seg: 2, top: '92%', tone: '', orbit: false },
    pill: { cls: '', text: 'LIVE' },
    btn:  { cls: 'active', label: 'BRIDGING…', disabled: true },
  },
  success: {
    source: 'done', circle: 'done', inj: 'live green',
    seg1: 'full', seg1Fill: 100, seg2: 'green', seg2Fill: 100,
    disc: { seg: 2, top: '92%', tone: 'green', orbit: false },
    pill: { cls: 'green', text: 'COMPLETE' },
    btn:  { cls: 'success', label: 'BRIDGE ANOTHER →', disabled: false },
  },
  failed: {
    source: 'done', circle: 'done', inj: 'live red',
    seg1: 'full', seg1Fill: 100, seg2: 'amber-green', seg2Fill: 100,
    disc: { seg: 2, top: '92%', tone: '', orbit: false },
    pill: { cls: 'red', text: 'ATTENTION' },
    btn:  { cls: '', label: 'RETRY', disabled: false },
  },
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  connectBtn: $('connect-btn'),
  connectDot: $('connect-dot'),
  connectAddr: $('connect-addr'),

  chainSelect: $('chain-select'),
  chainMenu: $('chain-menu'),
  srcMarkInline: $('src-mark-inline'),
  srcNameInline: $('src-name-inline'),

  amount: $('amount'),
  maxBtn: $('max-btn'),
  balanceNum: $('balance-num'),

  recipientRow: $('recipient-row'),
  recipientAddr: $('recipient-addr'),
  recipientInput: $('recipient-input'),
  recipientEdit: $('recipient-edit'),

  bridgeBtn: $('bridge-btn'),

  livePill: $('live-pill'),
  livePillText: $('live-pill-text'),

  nodeSource: $('node-source'),
  nodeCircle: $('node-circle'),
  nodeInj: $('node-inj'),

  srcMark: $('src-mark'),
  srcName: $('src-name'),
  srcPip: $('src-pip'),
  circlePip: $('circle-pip'),
  injPip: $('inj-pip'),

  srcStatus: $('src-status'),
  circleStatus: $('circle-status'),
  injStatus: $('inj-status'),

  seg1: $('seg1'),
  seg1Fill: $('seg1').querySelector('.fill'),
  seg2: $('seg2'),
  seg2Fill: $('seg2').querySelector('.fill'),
  disc1: $('disc1'),
  disc2: $('disc2'),

  detailStrip: $('detail-strip'),
  detailStrong: $('detail-strong'),
  detailText: $('detail-text'),
  detailHash: $('detail-hash'),
  detailElapsed: $('detail-elapsed'),

  successOverlay: $('success-overlay'),
  amountRestated: $('amount-restated'),
};

// ─── Mutable state ────────────────────────────────────────────────────────────
let account = null;
let walletClient = null;
let selectedChainId = SOURCE_CHAINS[0].id;
let recipient = '';

// Live run state — drives renderPhase().
const run = {
  phase: 'idle',
  amount: '',
  approveHash: null,
  burnHash: null,
  mintHash: null,
  elapsedMs: 0,
  error: null,
};

let pollTickId = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const shortHash = (h) => h ? h.slice(0, 6) + '…' + h.slice(-4) : '';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtAmount(s) {
  const n = Number(s);
  if (!isFinite(n)) return s;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function getSource() {
  return SOURCE_CHAINS.find((c) => c.id === selectedChainId) || SOURCE_CHAINS[0];
}

function publicClient(c) {
  return createPublicClient({
    chain: viemChain(c),
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: 8000 }))),
  });
}

function ensureWallet() {
  if (!window.ethereum) {
    throw new Error('No wallet detected. Install MetaMask, Rabby, or another EIP-1193 wallet.');
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

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderConnectChip() {
  if (account) {
    els.connectDot.classList.remove('idle');
    els.connectAddr.textContent = shortAddr(account);
  } else {
    els.connectDot.classList.add('idle');
    els.connectAddr.textContent = 'Connect';
  }
}

function renderSourceUI() {
  const c = getSource();
  const d = CHAIN_DISPLAY[c.id] || { mark: 'eth', letter: '?' };
  // Inline pill in the form
  els.srcMarkInline.className = `chain-mark ${d.mark}`;
  els.srcMarkInline.textContent = d.letter;
  els.srcNameInline.textContent = c.name;
  // Stage source node monogram + name
  els.srcMark.className = `chain-mark lg ${d.mark}`;
  els.srcMark.textContent = d.letter;
  els.srcName.textContent = c.name;
}

function renderRecipientDisplay() {
  els.recipientAddr.textContent = recipient || '—';
}

function buildChainMenu() {
  els.chainMenu.innerHTML = '';
  for (const c of SOURCE_CHAINS) {
    const d = CHAIN_DISPLAY[c.id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.chainId = c.id;
    if (c.id === selectedChainId) btn.classList.add('sel');
    btn.innerHTML = `
      <div class="chain-mark ${d.mark}">${escapeHtml(d.letter)}</div>
      <span>${escapeHtml(c.name)}</span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectChain(c.id);
    });
    els.chainMenu.appendChild(btn);
  }
}

function openChainMenu() { els.chainMenu.hidden = false; }
function closeChainMenu() { els.chainMenu.hidden = true; }

function selectChain(id) {
  selectedChainId = id;
  closeChainMenu();
  renderSourceUI();
  buildChainMenu();
  refreshBalance();
}

async function refreshBalance() {
  if (!account) {
    els.balanceNum.textContent = '—';
    delete els.balanceNum.dataset.raw;
    return;
  }
  const src = getSource();
  els.balanceNum.textContent = '…';
  try {
    const bal = await publicClient(src).readContract({
      address: src.usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
    const formatted = Number(formatUnits(bal, 6)).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 6,
    });
    els.balanceNum.textContent = formatted;
    els.balanceNum.dataset.raw = bal.toString();
    els.balanceNum.removeAttribute('title');
  } catch (err) {
    console.error('balance fetch failed for', src.name, err);
    els.balanceNum.textContent = 'unavailable';
    els.balanceNum.title = err.shortMessage || err.message || String(err);
    delete els.balanceNum.dataset.raw;
  }
}

function applyNodeTone(el, pipEl, tone) {
  el.className = 'node';
  if (tone === 'idle-pulse') {
    el.classList.add('idle-pulse');
  } else if (tone === 'dim') {
    el.classList.add('dim');
  } else if (tone === 'done') {
    el.classList.add('done');
  } else if (tone.startsWith('live ')) {
    el.classList.add('live', tone.split(' ')[1]);
  }
  // Pip
  pipEl.className = 'pip';
  if (tone === 'live cyan') {
    pipEl.classList.add('cyan');
    pipEl.textContent = '●';
    pipEl.hidden = false;
  } else if (tone === 'live amber') {
    pipEl.classList.add('amber');
    pipEl.textContent = '●';
    pipEl.hidden = false;
  } else if (tone === 'live green' || tone === 'done') {
    pipEl.classList.add('green');
    pipEl.textContent = '✓';
    pipEl.hidden = false;
  } else if (tone === 'live red') {
    pipEl.classList.add('red');
    pipEl.textContent = '!';
    pipEl.hidden = false;
  } else {
    pipEl.hidden = true;
    pipEl.textContent = '';
  }
}

function applySegment(el, fillEl, segCls, fillPct) {
  el.className = `segment ${segCls}`;
  fillEl.style.height = `${fillPct}%`;
}

function applyDisc(disc) {
  // disc = null | { seg: 1|2, top, tone, orbit }
  if (!disc) {
    els.disc1.hidden = true;
    els.disc2.hidden = true;
    els.disc1.className = 'disc';
    els.disc2.className = 'disc';
    return;
  }
  const target = disc.seg === 1 ? els.disc1 : els.disc2;
  const other  = disc.seg === 1 ? els.disc2 : els.disc1;
  other.hidden = true;
  other.className = 'disc';
  target.hidden = false;
  target.className = 'disc' + (disc.tone ? ' ' + disc.tone : '') + (disc.orbit ? ' orbit' : '');
  target.style.top = disc.top;
}

function txLink(explorer, hash, label) {
  if (!hash) return '';
  return `<a class="hash" href="${explorer}/tx/${hash}" target="_blank" rel="noopener">${escapeHtml(shortHash(hash))}</a>`;
}

function renderNodeStatuses(phase) {
  const src = getSource();
  // Source
  let srcHtml;
  if (phase === 'idle') {
    srcHtml = `<span class="status-line"><span class="tag-dim">READY</span></span>`;
  } else if (phase === 'approve-sign') {
    srcHtml = `<span class="status-line"><span class="tag-cyan">SIGNING…</span></span>`;
  } else if (phase === 'approve-confirm') {
    srcHtml = run.approveHash
      ? `<span class="status-line"><span class="tag-dim">approve</span> ${txLink(src.explorer, run.approveHash)}</span>`
      : `<span class="status-line"><span class="tag-cyan">CONFIRMING…</span></span>`;
  } else if (phase === 'burn-sign') {
    srcHtml = `<span class="status-line"><span class="tag-cyan">SIGNING…</span></span>`;
  } else if (phase === 'burn-confirm' || phase === 'attest' || phase === 'switch' ||
             phase === 'mint-sign' || phase === 'mint-confirm' || phase === 'success' || phase === 'failed') {
    srcHtml = run.burnHash
      ? `<span class="status-line"><span class="tag-dim">burn</span> ${txLink(src.explorer, run.burnHash)}</span>`
      : `<span class="status-line"><span class="tag-dim">CCTP V2</span></span>`;
  } else {
    srcHtml = `<span class="status-line"><span class="tag-dim">CCTP V2</span></span>`;
  }
  els.srcStatus.innerHTML = srcHtml;

  // Circle
  let circleHtml;
  if (phase === 'attest') {
    circleHtml =
      `<span class="status-line"><span class="tag-amber">ATTESTING</span></span>` +
      `<span class="status-line" style="font-size:11px;color:var(--text)">${formatElapsed(run.elapsedMs)}</span>`;
  } else if (phase === 'switch' || phase === 'mint-sign' || phase === 'mint-confirm' || phase === 'success' || phase === 'failed') {
    circleHtml = `<span class="status-line"><span class="tag-green">ATTESTED</span></span>`;
  } else {
    circleHtml = `<span class="status-line"><span class="tag-dim">CCTP V2</span></span>`;
  }
  els.circleStatus.innerHTML = circleHtml;

  // Injective
  let injHtml;
  if (phase === 'mint-sign' || phase === 'mint-confirm') {
    injHtml = run.mintHash
      ? `<span class="status-line"><span class="tag-cyan">CONFIRMING…</span></span>`
      : `<span class="status-line"><span class="tag-cyan">MINTING…</span></span>`;
  } else if (phase === 'success') {
    injHtml = run.mintHash
      ? `<span class="status-line"><span class="tag-green">MINTED</span> ${txLink(INJECTIVE.explorer, run.mintHash)}</span>`
      : `<span class="status-line"><span class="tag-green">MINTED</span></span>`;
  } else if (phase === 'failed') {
    injHtml = `<span class="status-line"><span class="tag-red">FAILED</span></span>`;
  } else {
    injHtml = `<span class="status-line"><span class="tag-dim">DOMAIN 29</span></span>`;
  }
  els.injStatus.innerHTML = injHtml;
}

function renderDetailStrip(phase) {
  const src = getSource();
  const srcName = src.name;

  let detail = null;
  if (phase === 'approve-sign') {
    detail = { tone: 'cyan', strong: 'APPROVE USDC', text: `Awaiting wallet signature on ${srcName}` };
  } else if (phase === 'approve-confirm') {
    detail = { tone: 'cyan', strong: 'APPROVE USDC', text: `Confirming on ${srcName}…`,
               hash: run.approveHash, explorer: src.explorer };
  } else if (phase === 'burn-sign') {
    detail = { tone: 'cyan', strong: 'BURN ON SOURCE', text: 'Awaiting wallet signature — depositForBurn' };
  } else if (phase === 'burn-confirm') {
    detail = { tone: 'cyan', strong: 'BURN ON SOURCE', text: `Confirming burn on ${srcName}`,
               hash: run.burnHash, explorer: src.explorer };
  } else if (phase === 'attest') {
    detail = { tone: 'amber', strong: 'CIRCLE ATTESTATION', text: 'Polling iris-api.circle.com',
               elapsed: formatElapsed(run.elapsedMs) };
  } else if (phase === 'switch') {
    detail = { tone: 'cyan', strong: 'SWITCH NETWORK', text: 'Switching wallet to Injective EVM (chain 1776)' };
  } else if (phase === 'mint-sign') {
    detail = { tone: 'cyan', strong: 'MINT ON INJECTIVE', text: 'Awaiting wallet signature — receiveMessage' };
  } else if (phase === 'mint-confirm') {
    detail = { tone: 'cyan', strong: 'MINT ON INJECTIVE', text: 'Confirming mint on Injective EVM',
               hash: run.mintHash, explorer: INJECTIVE.explorer };
  } else if (phase === 'success') {
    detail = { tone: 'green', strong: `${fmtAmount(run.amount)} USDC ARRIVED`,
               text: 'Mint confirmed on Injective EVM',
               hash: run.mintHash, explorer: INJECTIVE.explorer };
  } else if (phase === 'failed') {
    detail = { tone: 'red', strong: 'BRIDGE FAILED',
               text: run.error ? run.error : 'Run halted — funds remain safe' };
  }

  if (!detail) {
    els.detailStrip.hidden = true;
    return;
  }
  els.detailStrip.hidden = false;
  els.detailStrip.className = `detail-strip ${detail.tone}`;
  els.detailStrong.textContent = detail.strong;
  els.detailText.textContent = detail.text;
  if (detail.hash) {
    els.detailHash.hidden = false;
    els.detailHash.textContent = shortHash(detail.hash);
    els.detailHash.href = `${detail.explorer}/tx/${detail.hash}`;
  } else {
    els.detailHash.hidden = true;
  }
  if (detail.elapsed) {
    els.detailElapsed.hidden = false;
    els.detailElapsed.textContent = detail.elapsed;
  } else {
    els.detailElapsed.hidden = true;
  }
}

function renderPhase() {
  const phase = run.phase;
  const p = PHASES[phase] || PHASES.idle;

  // Nodes
  applyNodeTone(els.nodeSource, els.srcPip, p.source);
  applyNodeTone(els.nodeCircle, els.circlePip, p.circle);
  applyNodeTone(els.nodeInj,   els.injPip,    p.inj);

  // Segments
  applySegment(els.seg1, els.seg1Fill, p.seg1, p.seg1Fill);
  applySegment(els.seg2, els.seg2Fill, p.seg2, p.seg2Fill);

  // Disc
  applyDisc(p.disc);

  // Live pill
  els.livePill.className = 'live-pill ' + p.pill.cls;
  els.livePillText.textContent = p.pill.text;

  // Bridge button
  if (!account) {
    els.bridgeBtn.className = 'btn-primary';
    els.bridgeBtn.textContent = 'CONNECT WALLET';
    els.bridgeBtn.disabled = false;
  } else {
    els.bridgeBtn.className = 'btn-primary' + (p.btn.cls ? ' ' + p.btn.cls : '');
    els.bridgeBtn.textContent = p.btn.label;
    els.bridgeBtn.disabled = p.btn.disabled;
  }

  // Statuses on each node
  renderNodeStatuses(phase);

  // Detail strip
  renderDetailStrip(phase);

  // Success overlay
  if (phase === 'success') {
    els.successOverlay.hidden = false;
    els.amountRestated.textContent = `+${fmtAmount(run.amount)} USDC ON INJECTIVE`;
  } else {
    els.successOverlay.hidden = true;
    els.amountRestated.textContent = '';
  }
}

function setPhase(phase) {
  run.phase = phase;
  renderPhase();
}

function resetRun() {
  run.phase = 'idle';
  run.amount = '';
  run.approveHash = null;
  run.burnHash = null;
  run.mintHash = null;
  run.elapsedMs = 0;
  run.error = null;
  if (pollTickId) { clearInterval(pollTickId); pollTickId = null; }
  renderPhase();
}

// ─── Wallet flow ──────────────────────────────────────────────────────────────
async function connect() {
  ensureWallet();
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = getAddress(accounts[0]);
  walletClient = createWalletClient({
    account,
    transport: custom(window.ethereum),
  });
  if (!recipient) {
    recipient = account;
    renderRecipientDisplay();
  }
  renderConnectChip();
  refreshBalance();
  if (run.phase === 'idle') renderPhase(); // re-enable button
}

function disconnect() {
  account = null;
  walletClient = null;
  recipient = '';
  renderConnectChip();
  renderRecipientDisplay();
  els.balanceNum.textContent = '—';
  resetRun();
}

// ─── Bridge flow ──────────────────────────────────────────────────────────────
async function bridge() {
  if (!account) { alert('Connect a wallet first.'); return; }

  // Reset run state for a fresh bridge
  run.approveHash = null;
  run.burnHash = null;
  run.mintHash = null;
  run.elapsedMs = 0;
  run.error = null;

  const src = getSource();

  // Validate amount
  let amount;
  try {
    amount = parseUnits(els.amount.value || '0', 6);
  } catch {
    alert('Invalid amount.');
    return;
  }
  if (amount === 0n) { alert('Enter an amount.'); return; }

  // Validate recipient
  const recipientRaw = (recipient || account || '').trim();
  if (!isAddress(recipientRaw)) { alert('Recipient must be a valid 0x… address.'); return; }
  const recipientChecksummed = getAddress(recipientRaw);
  const mintRecipient = pad(recipientChecksummed, { size: 32 });

  run.amount = els.amount.value;

  const sourceClient = publicClient(src);
  const injClient = publicClient(INJECTIVE);

  try {
    await ensureChain(src);

    // Allowance check — skip approve if sufficient
    const allowance = await sourceClient.readContract({
      address: src.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, src.cctp.tokenMessenger],
    });

    if (allowance < amount) {
      setPhase('approve-sign');
      const approveHash = await walletClient.writeContract({
        address: src.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [src.cctp.tokenMessenger, amount],
        chain: viemChain(src),
      });
      run.approveHash = approveHash;
      setPhase('approve-confirm');
      await sourceClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // Burn
    setPhase('burn-sign');
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
    run.burnHash = burnHash;
    setPhase('burn-confirm');
    await sourceClient.waitForTransactionReceipt({ hash: burnHash });

    // Attest
    setPhase('attest');
    run.elapsedMs = 0;
    const startedAt = Date.now();
    pollTickId = setInterval(() => {
      run.elapsedMs = Date.now() - startedAt;
      // Update only the parts that depend on elapsed — avoid full re-render
      renderNodeStatuses('attest');
      // Also tick the detail strip's elapsed cell
      els.detailElapsed.textContent = formatElapsed(run.elapsedMs);
    }, 1000);

    const { message, attestation } = await pollAttestation(src.domain, burnHash);
    if (pollTickId) { clearInterval(pollTickId); pollTickId = null; }

    // Switch
    setPhase('switch');
    await ensureChain(INJECTIVE);

    // Mint
    setPhase('mint-sign');
    const mintHash = await walletClient.writeContract({
      address: INJECTIVE.cctp.messageTransmitter,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'receiveMessage',
      args: [message, attestation],
      chain: viemChain(INJECTIVE),
    });
    run.mintHash = mintHash;
    setPhase('mint-confirm');
    await injClient.waitForTransactionReceipt({ hash: mintHash });

    setPhase('success');
    refreshBalance();
  } catch (err) {
    if (pollTickId) { clearInterval(pollTickId); pollTickId = null; }
    console.error('bridge failed', err);
    run.error = err.shortMessage || err.details || err.message || String(err);
    setPhase('failed');
  }
}

async function pollAttestation(srcDomain, txHash) {
  const url = `${ATTESTATION_API}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  const start = Date.now();
  const timeoutMs = 30 * 60 * 1000;

  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.[0];
        if (msg && msg.status === 'complete' && msg.attestation && msg.attestation !== 'PENDING') {
          return { message: msg.message, attestation: msg.attestation };
        }
      }
    } catch {/* network blip — retry */}
    if (Date.now() - start > timeoutMs) {
      throw new Error('Attestation timed out after 30 minutes.');
    }
    await sleep(5000);
  }
}

// ─── Wire up ──────────────────────────────────────────────────────────────────

// Bridge button: disconnected → connect, idle → start, success → reset,
// failed → retry from idle.
els.bridgeBtn.addEventListener('click', () => {
  if (!account) { connect().catch((e) => alert(e.message)); return; }
  if (run.phase === 'success') { resetRun(); return; }
  if (run.phase === 'failed')  { resetRun(); bridge(); return; }
  bridge();
});

// Connect chip
els.connectBtn.addEventListener('click', () => {
  if (account) return; // simplest behavior — no disconnect UI for now
  connect().catch((e) => alert(e.message));
});

// Chain dropdown
els.chainSelect.addEventListener('click', (e) => {
  if (e.target.closest('.chain-menu')) return;
  els.chainMenu.hidden ? openChainMenu() : closeChainMenu();
});
document.addEventListener('click', (e) => {
  if (!els.chainSelect.contains(e.target)) closeChainMenu();
});

// Max button
els.maxBtn.addEventListener('click', () => {
  if (els.balanceNum.dataset.raw) {
    els.amount.value = formatUnits(BigInt(els.balanceNum.dataset.raw), 6);
  }
});

// Recipient edit
function openRecipientEditor() {
  els.recipientInput.value = recipient || account || '';
  els.recipientAddr.hidden = true;
  els.recipientInput.hidden = false;
  els.recipientEdit.textContent = 'DONE';
  els.recipientInput.focus();
  els.recipientInput.select();
}
function closeRecipientEditor() {
  const v = els.recipientInput.value.trim();
  if (v && isAddress(v)) {
    recipient = getAddress(v);
  }
  renderRecipientDisplay();
  els.recipientInput.hidden = true;
  els.recipientAddr.hidden = false;
  els.recipientEdit.textContent = 'EDIT';
}
els.recipientEdit.addEventListener('click', () => {
  if (els.recipientInput.hidden) openRecipientEditor();
  else closeRecipientEditor();
});
els.recipientInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); closeRecipientEditor(); }
  if (e.key === 'Escape') {
    els.recipientInput.value = recipient || '';
    closeRecipientEditor();
  }
});
els.recipientInput.addEventListener('blur', () => {
  if (!els.recipientInput.hidden) closeRecipientEditor();
});

// Wallet account change
if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', (accts) => {
    if (!accts || !accts.length) disconnect();
    else connect().catch(() => {});
  });
  // Auto-connect if already authorized
  window.ethereum.request({ method: 'eth_accounts' })
    .then((accts) => { if (accts && accts.length) connect().catch(() => {}); })
    .catch(() => {});
}

// Initial render
buildChainMenu();
renderSourceUI();
renderRecipientDisplay();
renderConnectChip();
renderPhase();
