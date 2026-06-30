# usdc-widget

Deprecated. The standalone USDC widget now redirects users to
[https://redirect.inj.so/](https://redirect.inj.so/).

The implementation is kept only as a fallback for hosts that still serve this
repo directly. Production should use an nginx 301 redirect from `usdc.inj.so`
to `redirect.inj.so`.

## Legacy notes

A tiny, self-hosted UI for bridging native USDC **into Injective EVM** via
Circle CCTP V2. Direct burn-and-mint — no relayer, no aggregator, no
custodian. Walks the user through:

1. Approve USDC on the source chain (if needed)
2. `depositForBurn(...)` on the source `TokenMessengerV2`
3. Poll Circle's attestation API
4. Switch network to Injective EVM (chain id `1776`)
5. `receiveMessage(message, attestation)` on Injective's `MessageTransmitterV2`

Supports Ethereum, Arbitrum, Base, OP Mainnet, Polygon, and Avalanche as
source chains. All use the same V2 contracts (deterministic addresses).
Users can choose Standard CCTP or Fast CCTP. Fast mode fetches Circle's
current route fee before burning and passes the buffered `maxFee` plus the
confirmed finality threshold into `depositForBurn`.

## Why this exists

Injective native USDC went live but front-end bridges (Skip, Circle's
own UI, Hub bridges) hadn't added Injective yet. CCTP's mint side is
permissionless, so any wallet can submit the attestation — this widget
just wires up that flow with sensible defaults.

## Run locally

```sh
npm install
npm start            # → http://localhost:3071
```

That's it. No build step. The static assets in `public/` import `viem`
straight from `esm.sh` at runtime.

Override the port with `PORT=8080 npm start`.

## How it works

| File              | Role                                                            |
| ----------------- | --------------------------------------------------------------- |
| `server.js`       | Hono static server, listens on `PORT` (default 3071).           |
| `public/index.html` | Markup.                                                       |
| `public/styles.css` | Dark Injective theme.                                         |
| `public/chains.js`  | Chain configs (CCTP addresses, domain IDs, USDC contracts).   |
| `public/cctp.js`    | Minimal ABIs for `TokenMessengerV2`, `MessageTransmitterV2`, ERC-20. |
| `public/app.js`     | Wallet connect + burn-and-mint state machine.                 |

CCTP V2 contract addresses are deterministic across all V2-enabled
chains, so adding a new source chain is a one-line entry in
`SOURCE_CHAINS` (in `chains.js`).

## Add a new source chain

Append to `SOURCE_CHAINS` in `public/chains.js`:

```js
{
  id: <evm chain id>,
  domain: <circle domain id>,
  name: '<display name>',
  rpc: '<public json-rpc url>',
  explorer: '<block explorer url>',
  nativeCurrency: { name, symbol, decimals: 18 },
  usdc: '<native USDC contract address>',
  cctp: CCTP_V2,
  finalityHint: '~1 min',
}
```

Source for current Circle domain IDs and addresses:
[developers.circle.com/cctp/cctp-supported-blockchains](https://developers.circle.com/cctp/cctp-supported-blockchains).

## Transfer speed

- **Standard.** Uses finalized attestation (`minFinalityThreshold = 2000`)
  and `maxFee = 0`.
- **Fast.** Uses confirmed attestation (`minFinalityThreshold = 1000`).
  The widget calls Circle's `/v2/burn/USDC/fees/<src>/<dst>` endpoint before
  the burn, adds a 20% buffer to the returned fee, and checks the global Fast
  Transfer allowance.

## Limitations

- **One transfer at a time.** No queueing or recovery — if your tab
  closes after the burn but before the mint, see "Recover a stuck
  transfer" below.
- **No Solana support.** Solana CCTP uses a different SDK and isn't
  in scope here.

## Recover a stuck transfer

If something failed between burn and mint (tab closed, wallet
network mismatch, etc.), the burn is already on-chain — your USDC
isn't lost. You just need to submit the mint manually:

1. Find the burn tx hash on the source chain explorer.
2. Get the message + attestation from Circle:
   `https://iris-api.circle.com/v2/messages/<srcDomain>?transactionHash=<burnTxHash>`
3. Switch the wallet to Injective EVM (chain id 1776).
4. Call `receiveMessage(message, attestation)` on
   `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`.

You can do step 4 from this widget's console — paste the `message` /
`attestation` into the live `bridge()` flow at the mint step, or call
the contract directly via Foundry/Etherscan.

## Deploying

See `DEPLOYMENT.md` (gitignored).
