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
  FAST_FINALITY,
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
  1:     { mark: 'eth',  letter: 'Ξ',   icon: '/eth.png' },
  42161: { mark: 'arb',  letter: 'A',   icon: '/arb.png' },
  8453:  { mark: 'base', letter: 'B',   icon: '/base.png' },
  10:    { mark: 'op',   letter: 'OP',  icon: '/op.png' },
  137:   { mark: 'poly', letter: 'P' },   // monogram fallback — no icon yet
  43114: { mark: 'avax', letter: 'A' },   // monogram fallback — no icon yet
  1776:  { mark: 'inj',  letter: 'INJ', icon: '/inj.png' },  // Injective (used in outbound mode)
};

// Paint a chain-mark element in place. If the chain has an icon, render an
// <img>; otherwise render the monogram letter with the gradient background.
function paintChainMark(el, displayKey, size = '') {
  const d = CHAIN_DISPLAY[displayKey] || {};
  const sizeCls = size ? ` ${size}` : '';
  if (d.icon) {
    el.className = `chain-mark${sizeCls} ${d.mark} has-icon`;
    el.innerHTML = `<img src="${d.icon}" alt="" loading="lazy">`;
  } else {
    el.className = `chain-mark${sizeCls} ${d.mark}`;
    el.textContent = d.letter || '?';
  }
}

// Same thing but as an HTML string, for places that build markup from scratch
// (the chain dropdown menu items).
function chainMarkHtml(displayKey, size = '') {
  const d = CHAIN_DISPLAY[displayKey] || {};
  const sizeCls = size ? ` ${size}` : '';
  if (d.icon) {
    return `<div class="chain-mark${sizeCls} ${d.mark} has-icon"><img src="${d.icon}" alt="" loading="lazy"></div>`;
  }
  return `<div class="chain-mark${sizeCls} ${d.mark}">${escapeHtml(d.letter || '?')}</div>`;
}

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

  // Direction toggle (segmented tabs above the split + labels in the brand)
  dirFrom: $('dir-from'),
  dirTo: $('dir-to'),
  tabIn: $('tab-in'),
  tabOut: $('tab-out'),

  // Form labels (toggle copy on direction)
  fromLabel: $('from-label'),
  recipientLabel: $('recipient-label'),

  chainSelect: $('chain-select'),
  chainMenu: $('chain-menu'),
  srcMarkInline: $('src-mark-inline'),
  srcNameInline: $('src-name-inline'),

  amount: $('amount'),
  maxBtn: $('max-btn'),
  balanceNum: $('balance-num'),

  speedStandard: $('speed-standard'),
  speedFast: $('speed-fast'),
  speedFastFee: $('speed-fast-fee'),
  speedMeta: $('speed-meta'),

  recipientRow: $('recipient-row'),
  recipientAddr: $('recipient-addr'),
  recipientInput: $('recipient-input'),
  recipientEdit: $('recipient-edit'),

  bridgeBtn: $('bridge-btn'),

  livePill: $('live-pill'),
  livePillText: $('live-pill-text'),

  nodeSource: $('node-source'),
  nodeCircle: $('node-circle'),
  nodeDst: $('node-dst'),

  srcMark: $('src-mark'),
  srcName: $('src-name'),
  srcPip: $('src-pip'),
  circlePip: $('circle-pip'),
  dstMark: $('dst-mark'),
  dstName: $('dst-name'),
  dstPip: $('dst-pip'),

  srcStatus: $('src-status'),
  circleStatus: $('circle-status'),
  dstStatus: $('dst-status'),

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
// Direction: 'in' = USDC (selected chain) → Injective. 'out' = Injective → USDC (selected chain).
// The chain dropdown always represents the *non-Injective* side of the route.
let direction = 'in';
let transferMode = 'standard';

// Live run state — drives renderPhase().
const run = {
  phase: 'idle',
  amount: '',
  transferMode: 'standard',
  approveHash: null,
  burnHash: null,
  mintHash: null,
  elapsedMs: 0,
  error: null,
};

let pollTickId = null;
let bridgeInFlight = false;
let feeQuoteRequestId = 0;
const feeQuoteCache = new Map();
const feeQuoteState = {
  routeKey: '',
  loading: false,
  error: null,
  entries: null,
};

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

function fmtUsdcSubunits(units, maxFractionDigits = 6) {
  const n = Number(formatUnits(units, 6));
  if (!isFinite(n)) return formatUnits(units, 6);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: units === 0n ? 0 : 2,
    maximumFractionDigits,
  });
}

function fmtBps(bps) {
  const n = Number(bps);
  if (!isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function divCeil(n, d) {
  return n === 0n ? 0n : ((n - 1n) / d) + 1n;
}

function feeBpsToMaxFee(amount, bps) {
  const n = Number(bps);
  if (!isFinite(n) || n <= 0) return 0n;
  const scaledBps = BigInt(Math.ceil(n * 100));
  const protocolFee = divCeil(amount * scaledBps, 1_000_000n);
  return divCeil(protocolFee * 120n, 100n);
}

function decimalUsdcToSubunits(value) {
  const raw = String(value ?? '0').trim();
  const [wholeRaw = '0', fracRaw = ''] = raw.split('.');
  const whole = wholeRaw.replace(/[^\d]/g, '') || '0';
  const frac = (fracRaw.replace(/[^\d]/g, '') + '000000').slice(0, 6);
  return (BigInt(whole) * 1_000_000n) + BigInt(frac);
}

function readAmountInput() {
  try {
    return parseUnits(els.amount.value || '0', 6);
  } catch {
    return null;
  }
}

function getOtherChain() {
  return SOURCE_CHAINS.find((c) => c.id === selectedChainId) || SOURCE_CHAINS[0];
}
function getSrcChain() {
  return direction === 'in' ? getOtherChain() : INJECTIVE;
}
function getDstChain() {
  return direction === 'in' ? INJECTIVE : getOtherChain();
}
// Back-compat alias for the legacy callsites that still say `getSource()`.
const getSource = getSrcChain;

function getRouteKey(src = getSrcChain(), dst = getDstChain()) {
  return `${src.domain}:${dst.domain}`;
}

function publicClient(c) {
  return createPublicClient({
    chain: viemChain(c),
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: 8000 }))),
  });
}

function parseFeeEntries(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      finalityThreshold: Number(row.finalityThreshold),
      minimumFee: Number(row.minimumFee),
    }))
    .filter((row) => Number.isFinite(row.finalityThreshold) && Number.isFinite(row.minimumFee));
}

function findFeeEntry(entries, finalityThreshold) {
  return entries?.find((entry) => entry.finalityThreshold === finalityThreshold) || null;
}

async function fetchRouteFees(src, dst, { fresh = false } = {}) {
  const key = getRouteKey(src, dst);
  if (!fresh && feeQuoteCache.has(key)) return feeQuoteCache.get(key);

  const res = await fetch(`${ATTESTATION_API}/v2/burn/USDC/fees/${src.domain}/${dst.domain}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Circle fee quote failed (${res.status}).`);

  const entries = parseFeeEntries(await res.json());
  if (!entries.length) throw new Error('Circle fee quote is unavailable for this route.');
  feeQuoteCache.set(key, entries);
  return entries;
}

async function fetchFastAllowance() {
  const res = await fetch(`${ATTESTATION_API}/v2/fastBurn/USDC/allowance`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Circle fast allowance check failed (${res.status}).`);
  const data = await res.json();
  return decimalUsdcToSubunits(data.allowance);
}

async function refreshSpeedQuote({ fresh = false } = {}) {
  const src = getSrcChain();
  const dst = getDstChain();
  const key = getRouteKey(src, dst);
  const requestId = ++feeQuoteRequestId;

  feeQuoteState.routeKey = key;
  feeQuoteState.loading = true;
  feeQuoteState.error = null;
  if (fresh) feeQuoteState.entries = null;
  renderSpeedUI();

  try {
    const entries = await fetchRouteFees(src, dst, { fresh });
    if (requestId !== feeQuoteRequestId || key !== getRouteKey()) return;
    feeQuoteState.routeKey = key;
    feeQuoteState.loading = false;
    feeQuoteState.error = null;
    feeQuoteState.entries = entries;
  } catch (err) {
    if (requestId !== feeQuoteRequestId || key !== getRouteKey()) return;
    feeQuoteState.routeKey = key;
    feeQuoteState.loading = false;
    feeQuoteState.error = err.shortMessage || err.message || String(err);
    feeQuoteState.entries = null;
  }
  renderSpeedUI();
}

async function getTransferParams(amount, src, dst, mode = transferMode) {
  if (mode !== 'fast') {
    return {
      maxFee: STANDARD_MAX_FEE,
      finalityThreshold: STANDARD_FINALITY,
      feeBps: 0,
    };
  }

  const entries = await fetchRouteFees(src, dst, { fresh: true });
  const fastFee = findFeeEntry(entries, FAST_FINALITY);
  if (!fastFee) throw new Error('Fast CCTP is not available for this route.');

  const allowance = await fetchFastAllowance();
  if (allowance < amount) {
    throw new Error(`Fast CCTP allowance is ${fmtUsdcSubunits(allowance)} USDC. Use Standard or retry later.`);
  }

  return {
    maxFee: feeBpsToMaxFee(amount, fastFee.minimumFee),
    finalityThreshold: FAST_FINALITY,
    feeBps: fastFee.minimumFee,
  };
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

function renderRouteUI() {
  const other = getOtherChain();
  const src = getSrcChain();
  const dst = getDstChain();

  // Header swap label
  els.dirFrom.textContent = direction === 'in' ? 'USDC' : 'INJECTIVE';
  els.dirTo.textContent   = direction === 'in' ? 'INJECTIVE' : 'USDC';

  // Tab active state
  els.tabIn.classList.toggle('active', direction === 'in');
  els.tabIn.setAttribute('aria-pressed', direction === 'in');
  els.tabOut.classList.toggle('active', direction === 'out');
  els.tabOut.setAttribute('aria-pressed', direction === 'out');

  // Form labels — the chain dropdown represents the non-Injective side of the
  // route. In inbound mode that's the FROM; in outbound mode it's the TO.
  els.fromLabel.textContent = direction === 'in' ? '§ FROM' : '§ TO';
  els.recipientLabel.textContent =
    direction === 'in'
      ? '§ RECIPIENT · INJ EVM'
      : `§ RECIPIENT · ${other.name.toUpperCase()}`;

  // Form-side chain pill — always the non-Injective chain at base size
  paintChainMark(els.srcMarkInline, other.id);
  els.srcNameInline.textContent = other.name;

  // Stage source node (top of the track) — direction-dependent
  paintChainMark(els.srcMark, src.id, 'xl');
  els.srcName.textContent = src.name;

  // Stage destination node (bottom of the track) — direction-dependent
  paintChainMark(els.dstMark, dst.id, 'xl');
  els.dstName.textContent = dst.name;
}
// Legacy alias for callsites that still say renderSourceUI()
const renderSourceUI = renderRouteUI;

function renderRecipientDisplay() {
  els.recipientAddr.textContent = recipient || '—';
}

function canChangeSpeed() {
  return !bridgeInFlight && (run.phase === 'idle' || run.phase === 'success' || run.phase === 'failed');
}

function renderSpeedUI() {
  const isFast = transferMode === 'fast';
  const routeEntries = feeQuoteState.routeKey === getRouteKey() ? feeQuoteState.entries : null;
  const fastFee = findFeeEntry(routeEntries, FAST_FINALITY);
  const amount = readAmountInput();
  const locked = !canChangeSpeed();

  els.speedStandard.classList.toggle('active', !isFast);
  els.speedFast.classList.toggle('active', isFast);
  els.speedStandard.setAttribute('aria-pressed', String(!isFast));
  els.speedFast.setAttribute('aria-pressed', String(isFast));
  els.speedStandard.disabled = locked;
  els.speedFast.disabled = locked;

  let fastFeeText = 'QUOTE';
  if (feeQuoteState.loading && !routeEntries) {
    fastFeeText = '...';
  } else if (feeQuoteState.error) {
    fastFeeText = 'N/A';
  } else if (fastFee) {
    const maxFee = amount && amount > 0n
      ? feeBpsToMaxFee(amount, fastFee.minimumFee)
      : null;
    fastFeeText = fastFee.minimumFee === 0
      ? 'FREE'
      : (maxFee ? `<=${fmtUsdcSubunits(maxFee, 4)}` : `${fmtBps(fastFee.minimumFee)} BPS`);
  }
  els.speedFastFee.textContent = fastFeeText;

  let meta = 'STANDARD · FINALIZED · FREE';
  let metaTone = '';
  if (isFast) {
    if (feeQuoteState.loading && !routeEntries) {
      meta = 'FAST · FETCHING FEE';
      metaTone = 'warn';
    } else if (feeQuoteState.error) {
      meta = 'FAST · FEE UNAVAILABLE';
      metaTone = 'warn';
    } else if (!fastFee) {
      meta = 'FAST · ROUTE UNAVAILABLE';
      metaTone = 'warn';
    } else if (fastFee.minimumFee === 0) {
      meta = 'FAST · CONFIRMED · FREE';
      metaTone = 'good';
    } else {
      meta = `FAST · CONFIRMED · ${fmtBps(fastFee.minimumFee)} BPS`;
      metaTone = 'warn';
    }
  }
  els.speedMeta.className = `speed-meta${metaTone ? ' ' + metaTone : ''}`;
  els.speedMeta.textContent = meta;
}

function setTransferMode(mode) {
  if (!canChangeSpeed() || (mode !== 'standard' && mode !== 'fast')) return;
  transferMode = mode;
  renderSpeedUI();
  if (mode === 'fast') refreshSpeedQuote();
}

function buildChainMenu() {
  els.chainMenu.innerHTML = '';
  for (const c of SOURCE_CHAINS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.chainId = c.id;
    if (c.id === selectedChainId) btn.classList.add('sel');
    btn.innerHTML = `${chainMarkHtml(c.id)}<span>${escapeHtml(c.name)}</span>`;
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
  renderRouteUI();
  buildChainMenu();
  refreshBalance();
  refreshSpeedQuote();
  // The destination node and the bridge button label both depend on the
  // selected chain, so re-render the phase to pick up the new dst.name.
  renderPhase();
}

function swapDirection() {
  direction = direction === 'in' ? 'out' : 'in';
  // Abandon any in-progress run visualization — stale phase classes would
  // describe the wrong route after the swap.
  resetRun();
  renderRouteUI();
  refreshBalance();
  refreshSpeedQuote();
}

async function refreshBalance() {
  if (!account) {
    els.balanceNum.textContent = '—';
    delete els.balanceNum.dataset.raw;
    return;
  }
  const src = getSrcChain();
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
  const src = getSrcChain();
  const dst = getDstChain();
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

  // Destination
  let dstHtml;
  if (phase === 'mint-sign' || phase === 'mint-confirm') {
    dstHtml = run.mintHash
      ? `<span class="status-line"><span class="tag-cyan">CONFIRMING…</span></span>`
      : `<span class="status-line"><span class="tag-cyan">MINTING…</span></span>`;
  } else if (phase === 'success') {
    dstHtml = run.mintHash
      ? `<span class="status-line"><span class="tag-green">MINTED</span> ${txLink(dst.explorer, run.mintHash)}</span>`
      : `<span class="status-line"><span class="tag-green">MINTED</span></span>`;
  } else if (phase === 'failed') {
    dstHtml = `<span class="status-line"><span class="tag-red">FAILED</span></span>`;
  } else {
    dstHtml = `<span class="status-line"><span class="tag-dim">DOMAIN ${dst.domain}</span></span>`;
  }
  els.dstStatus.innerHTML = dstHtml;
}

function renderDetailStrip(phase) {
  const src = getSrcChain();
  const dst = getDstChain();
  const srcName = src.name;
  const dstName = dst.name;
  const dstUpper = dstName.toUpperCase();
  const modeLabel = (run.transferMode || transferMode).toUpperCase();

  let detail = null;
  if (phase === 'approve-sign') {
    detail = { tone: 'cyan', strong: 'APPROVE USDC', text: `Awaiting wallet signature on ${srcName}` };
  } else if (phase === 'approve-confirm') {
    detail = { tone: 'cyan', strong: 'APPROVE USDC', text: `Confirming on ${srcName}…`,
               hash: run.approveHash, explorer: src.explorer };
  } else if (phase === 'burn-sign') {
    detail = { tone: 'cyan', strong: 'BURN ON SOURCE', text: `Awaiting wallet signature · ${modeLabel}` };
  } else if (phase === 'burn-confirm') {
    detail = { tone: 'cyan', strong: 'BURN ON SOURCE', text: `Confirming burn on ${srcName}`,
               hash: run.burnHash, explorer: src.explorer };
  } else if (phase === 'attest') {
    detail = { tone: 'amber', strong: 'CIRCLE ATTESTATION', text: `Polling iris-api.circle.com · ${modeLabel}`,
               elapsed: formatElapsed(run.elapsedMs) };
  } else if (phase === 'switch') {
    detail = { tone: 'cyan', strong: 'SWITCH NETWORK', text: `Switching wallet to ${dstName} (chain ${dst.id})` };
  } else if (phase === 'mint-sign') {
    detail = { tone: 'cyan', strong: `MINT ON ${dstUpper}`, text: 'Awaiting wallet signature — receiveMessage' };
  } else if (phase === 'mint-confirm') {
    detail = { tone: 'cyan', strong: `MINT ON ${dstUpper}`, text: `Confirming mint on ${dstName}`,
               hash: run.mintHash, explorer: dst.explorer };
  } else if (phase === 'success') {
    detail = { tone: 'green', strong: `${fmtAmount(run.amount)} USDC ARRIVED`,
               text: `Mint confirmed on ${dstName}`,
               hash: run.mintHash, explorer: dst.explorer };
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
  applyNodeTone(els.nodeDst,    els.dstPip,    p.inj);

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
    // Override the idle label so it names the actual destination chain
    // (e.g. "BRIDGE TO ETHEREUM" in outbound mode).
    if (run.phase === 'idle') {
      els.bridgeBtn.textContent = `BRIDGE TO ${getDstChain().name.toUpperCase()}`;
    } else {
      els.bridgeBtn.textContent = p.btn.label;
    }
    els.bridgeBtn.disabled = p.btn.disabled;
  }
  renderSpeedUI();

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
  run.transferMode = transferMode;
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
  if (bridgeInFlight) return;

  // Reset run state for a fresh bridge
  run.approveHash = null;
  run.burnHash = null;
  run.mintHash = null;
  run.elapsedMs = 0;
  run.error = null;
  run.transferMode = transferMode;

  const src = getSrcChain();
  const dst = getDstChain();

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
  const destClient = publicClient(dst);
  bridgeInFlight = true;
  renderSpeedUI();

  try {
    const transferParams = await getTransferParams(amount, src, dst, run.transferMode);
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

    // Burn on the source chain — destinationDomain is the dst chain's
    // CCTP domain (29 for Injective, 0/2/3/6/7/1 for the EVM L1/L2 chains).
    setPhase('burn-sign');
    const burnHash = await walletClient.writeContract({
      address: src.cctp.tokenMessenger,
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: 'depositForBurn',
      args: [
        amount,
        dst.domain,
        mintRecipient,
        src.usdc,
        ZERO_BYTES32,
        transferParams.maxFee,
        transferParams.finalityThreshold,
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

    // Switch wallet to the destination chain for the mint
    setPhase('switch');
    await ensureChain(dst);

    // Mint
    setPhase('mint-sign');
    const mintHash = await walletClient.writeContract({
      address: dst.cctp.messageTransmitter,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'receiveMessage',
      args: [message, attestation],
      chain: viemChain(dst),
    });
    run.mintHash = mintHash;
    setPhase('mint-confirm');
    await destClient.waitForTransactionReceipt({ hash: mintHash });

    setPhase('success');
    refreshBalance();
  } catch (err) {
    if (pollTickId) { clearInterval(pollTickId); pollTickId = null; }
    console.error('bridge failed', err);
    run.error = err.shortMessage || err.details || err.message || String(err);
    setPhase('failed');
  } finally {
    bridgeInFlight = false;
    renderSpeedUI();
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
    renderSpeedUI();
  }
});
els.amount.addEventListener('input', renderSpeedUI);

// CCTP speed toggle
els.speedStandard.addEventListener('click', () => setTransferMode('standard'));
els.speedFast.addEventListener('click', () => setTransferMode('fast'));

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

// Direction tabs — clicking the inactive tab swaps direction; clicking the
// already-active tab is a no-op (no double-flip).
function setDirection(next) {
  if (direction === next) return;
  swapDirection();
}
els.tabIn.addEventListener('click',  () => setDirection('in'));
els.tabOut.addEventListener('click', () => setDirection('out'));

// Initial render
buildChainMenu();
renderRouteUI();
renderRecipientDisplay();
renderConnectChip();
renderPhase();
refreshSpeedQuote();
