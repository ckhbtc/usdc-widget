# usdc-widget — Design Handoff

> **For:** Claude Code (or any designer)
> **From:** CK
> **Goal:** Redesign the frontend at `public/index.html` + `public/styles.css` (and as much of `public/app.js` as is needed for new DOM hooks + motion). The CCTP burn-and-mint logic is locked — only the rendering layer is in scope.

---

## 1. What this is

A **public-facing** one-page widget that bridges native USDC into Injective EVM (CCTP V2 burn-and-mint). Lives at [https://usdc.inj.so](https://usdc.inj.so). Repo: [github.com/ckhbtc/usdc-widget](https://github.com/ckhbtc/usdc-widget).

User flow is short and well-defined:
1. Pick a source chain (Ethereum / Arbitrum / Base / OP / Polygon / Avalanche).
2. Type an amount (or hit Max).
3. Confirm the destination address on Injective EVM.
4. Click **Bridge to Injective**.
5. Sign 1–2 wallet prompts (approve + burn), wait ~1–13 minutes for Circle attestation, sign the mint on Injective, done.

The widget is the **first** touchpoint for users who want native USDC on Injective. It needs to feel obviously legit, obviously safe, and obviously *fast* — even when the underlying flow takes 13 minutes from Ethereum.

---

## 2. Hard constraints — DO NOT touch

These are locked. The redesign must work around them, not over them.

### 2.1 The five-step state machine

The bridge produces five named steps, in order. Designer can rename labels but the step *count*, *order*, and *skip behavior* (step 1 is skipped if allowance is sufficient) are all fixed.

| Key       | Default label                  | What's actually happening                     | Skip rule                       |
| --------- | ------------------------------ | --------------------------------------------- | ------------------------------- |
| `approve` | "Approve USDC"                 | ERC-20 `approve(TokenMessenger, amount)`      | Skipped if `allowance >= amount` |
| `burn`    | "Burn on source"               | `TokenMessengerV2.depositForBurn(...)`        | Always runs                     |
| `attest`  | "Wait for Circle attestation"  | Polls `iris-api.circle.com/v2/messages/...`   | Always runs                     |
| `switch`  | "Switch to Injective EVM"      | `wallet_switchEthereumChain` to chain id 1776 | Always runs                     |
| `mint`    | "Mint on Injective"            | `MessageTransmitterV2.receiveMessage(...)`    | Always runs                     |

Each step has four states: `pending`, `active`, `done`, `failed`. Designer must visually communicate all four.

### 2.2 Form fields

- **From** (chain dropdown) — 6 options today, easy to add more
- **Amount** (USDC, 6-decimal) — paired with a Max button + a balance hint
- **Recipient on Injective EVM** (0x… address, defaults to connected wallet)
- One primary CTA — "Bridge to Injective" → "Bridge another →" after success → "Bridge to Injective" on retry/error

### 2.3 Live data the widget receives

- **Connected address** (or `null` if disconnected)
- **USDC balance on selected source chain** (or "loading…" / "balance unavailable")
- **5 step states** during a run
- **Tx hashes** for approve, burn, mint (with explorer URLs)
- **Elapsed time** during attestation polling (seconds → mins)

These are the only data points. No price feeds, no charts, no FX, no aggregator routing.

### 2.4 Files NOT to touch

- `public/chains.js` — chain configs, CCTP addresses, USDC contracts, RPC URLs. Locked.
- `public/cctp.js` — V2 ABIs. Locked.
- `server.js` — Hono static server. Locked.
- `public/app.js` *bridge logic* — the burn/poll/mint state machine. Reusable, but the **render functions** (`renderSteps`, `setStep`, balance-text writes, button-text writes) are fair game to rewrite to support the new design.

---

## 3. Why we're redesigning

The current design is functional but feels like a generic bridge widget — could be any of fifty CCTP forks. Specifically:

- The card is a flat dark rectangle. Nothing about it telegraphs that this is the *Injective* bridge. The brand presence is one cyan accent line.
- The 5-step timeline is visually quiet — small dots, small text, easy to miss the difference between "active" and "pending."
- The "what's happening right now" moment is dead air. While Circle attests for 13 minutes from Ethereum, there's no rhythm, no animation, no sense of progress beyond a pulsing circle.
- The success state is anticlimactic — five green checks, a button label change, that's it. A successful bridge should *feel* like something happened.
- No visual story for the cross-chain motion itself. The product is literally "your USDC moves from chain A → Circle → chain B" and we don't show that.

The redesign should fix all five.

---

## 4. Required aesthetic direction

The widget should feel **premium / cinematic / first-party** — like something Injective's design team shipped, not a community fork. Specific musts:

- **Strong sense of motion during the bridge run.** This is a 30s–13min experience; treat it as choreography, not a progress bar.
- **A visual representation of the cross-chain flow.** The source chain, Circle, and Injective should be three distinct *places* on the canvas, and the user should see "their" amount move between them.
- **Clear celebration on success.** A moment, however brief, that says: this worked.
- **Brand presence beyond a single accent line.** The widget should look unmistakably like an Injective surface.

Things we are explicitly *not* going for:

- "Web3 maximalist" gradients, glassmorphism for its own sake, or floating 3D coins.
- Bloomberg-terminal density. The widget has 4 form fields and 5 steps — there's nothing to densify.
- Editorial / serif / paper aesthetics. (That's the TC Margin Dashboard's territory.)

---

## 5. Three concrete directions to pick from

### A. Cinematic Cross-Chain Stage *(preferred)*

The form sits on the **left half** of the card. The **right half** is a stage — three labeled nodes stacked vertically: source chain → Circle → Injective. As the bridge runs, an animated USDC token (a subtle disc, glowing on its leading edge) traverses the path. Different segments light up as steps complete. On mint, the Injective node flares, the disc lands, and a checkmark blooms.

- Vertical 50/50 split on desktop, stacks on mobile.
- Three nodes, each with its chain logo + name + a status pip.
- The path between nodes is a thin line that fills in with motion as steps progress.
- Idle state: nodes are dim, line is empty, a soft pulse on the source node hints at "ready."
- During approve/burn: source node lights up cyan, a token disc appears at source.
- During attest: disc moves toward Circle node, Circle node pulses ("validating"), the polling elapsed time appears next to it as live mono text.
- During switch/mint: disc moves to Injective, Injective node lights up, checkmark blooms, confetti or radial glow on the card edge.
- Idle pulse on the source node returns once the run completes (signaling "ready for another").

This direction makes the bridge *feel* like a journey the user is watching, not a form they're submitting. Best motion payoff, best brand expression, biggest design lift.

### B. Heads-Up Display

A monospace, cockpit-style overlay with thin rules and clear-cut status panels. The form on top, the step timeline below, but reimagined as a HUD: thin amber/cyan rules dividing the card into named sections, each step a horizontal strip with its own row, big mono numerals for elapsed time and amount.

- Mostly-mono typography (JetBrains Mono everywhere except the H1).
- Hairline rules (`border-color: rgba(255,255,255,.06)`), generous use of section headings (`§ APPROVE`, `§ BURN`, etc.) in small caps.
- A persistent live-clock in the corner showing elapsed time during the run.
- Step states: `[ PEND ]`, `[ LIVE ]`, `[  OK  ]`, `[ FAIL ]` in mono brackets.
- Subtle scanline overlay or chromatic-aberration on the active step.

Less brand-expressive than A but more "this is a serious tool." Smallest design lift; the existing layout could be re-skinned into this without major DOM changes.

### C. Glass Diorama

A frosted, layered card with the cross-chain flow as a small 3D-feeling diorama: three platforms arranged in depth, the USDC moving between them with subtle parallax. The form floats above the diorama as a glass panel.

- Layered depth: bg → diorama → glass form → modal-ish status overlay.
- Soft shadows, real translucency (`backdrop-filter: blur(...)`), warm accent on the Injective platform to differentiate from the cool source-chain side.
- Motion is slower, more "high-end product page" than HUD.

Highest visual ambition but riskiest — easy to slide into "generic crypto landing page." Designer should only pitch this if they have a strong specific reference.

**My pick: A (Cinematic Cross-Chain Stage).** Motion is the unique value the widget can offer — every other bridge UI is just a form. Make the journey visible.

Designer is free to combine elements (e.g., A's stage + B's HUD typography) or pitch alternatives with a strong reference. Send me a Figma frame or a screen recording before implementing if you want a sanity check.

---

## 6. Components — current DOM map and redesign notes

Current DOM (all under `<main class="card">`):

```
<header class="card-header">
  <h1>USDC → Injective</h1>
  <button id="connect-btn">Connect</button>
</header>

<section class="form">
  <label.field>  From         <select#source-select>     </label>
  <label.field>  Amount       <input#amount> + Max + USDC</label>
  <label.field>  Recipient    <input#recipient>          </label>
  <button#bridge-btn class="btn-primary">Bridge to Injective</button>
</section>

<section.timeline #timeline hidden>
  <ol#steps>
    <!-- 5 step <li>s with marker + label + detail -->
  </ol>
</section>

<footer.card-footer>
  <small>Direct CCTP V2 burn-and-mint. Domain 29. USDC 0xa00C…35a.</small>
</footer>
```

### 6.1 Header

- Logo / wordmark slot is empty today. Add an Injective wordmark (or just "INJ") + a quiet line about the function.
- "Connect" button shrinks dramatically once connected — currently it just shows the truncated address. Designer should treat connected vs disconnected as two different visual states (e.g., dot-indicator + address chip when connected).

### 6.2 Form

- "From" should show the chain logo next to the name in the dropdown. Source the logos from a CDN or a local `public/chains/<id>.svg` set. Logos are out of scope to source — leave a placeholder slot and I'll populate.
- "Amount" + "Max" + "USDC" suffix is fine in concept but visually scrappy. Consider treating the amount field as the *hero* element of the form (large numerals, tabular-nums).
- "Recipient" is currently a 64-character mono blob. Treat it as a chip/pill with the EVM avatar (jazzicon / blockie) on the left so users can sanity-check the destination at a glance.
- Primary CTA — single button. Three labels:
  - Idle / disconnected: "Bridge to Injective"
  - Active: button is disabled; label can change to "Bridging…"
  - Success: "Bridge another →"
  - Failed: returns to "Bridge to Injective" so retry is obvious

### 6.3 Timeline / cross-chain stage

This is the redesign's biggest swing. Pitch in this priority:

1. The 5 step states (pending/active/done/failed) must be glanceable from across a room.
2. The active step should *feel* live — animate, not just show a class.
3. Tx hashes need to remain copy/paste-able and link to explorers. Don't bury them inside motion.
4. The attestation step is special because it can take 13 minutes; the elapsed-time hint must be ambient and persistent during that window, not just a tooltip.

If pursuing direction A: the stage replaces the timeline, but the per-step detail (tx hashes, elapsed time) still needs a home. Suggest: a thin horizontal strip below the stage with the active step's detail, and a collapsed list of past steps (like a chat history) above or below.

### 6.4 Footer

Keep something footer-shaped but make it more confident. Current footer reads like fine print. Consider it the "trust strip": Domain `29`, USDC contract, and a "View on GitHub" link to [github.com/ckhbtc/usdc-widget](https://github.com/ckhbtc/usdc-widget) (now public).

---

## 7. Motion + state choreography

Direction A's choreography is the headline. Specifically:

| Phase                         | What animates                                                       | Approx duration         |
| ----------------------------- | ------------------------------------------------------------------- | ----------------------- |
| Idle, ready                   | Soft 2.5s pulse on source-chain node                                | continuous              |
| Approve start (signing)       | Source node ring pulses faster, button shows "Bridging…"            | until wallet sign       |
| Approve confirmed             | Source node fully lit, USDC disc materializes at source             | ~200ms ease-out         |
| Burn start (signing)          | Disc ring pulses                                                    | until wallet sign       |
| Burn confirmed                | Disc detaches from source, slides toward Circle node                | ~600ms cubic-bezier     |
| Attestation polling           | Disc orbits Circle node slowly, elapsed-time text ticks under it    | duration of poll        |
| Attestation received          | Orbit stops, disc snaps inward, Circle node flashes                 | ~250ms                  |
| Switch to Injective EVM       | Disc moves to Injective node                                        | ~600ms                  |
| Mint signing                  | Injective node ring pulses                                          | until wallet sign       |
| Mint confirmed                | Injective node flares, checkmark blooms at center, edge glow        | ~400ms                  |
| Hold                          | Success state holds; button label flips to "Bridge another →"       | until user acts         |
| Reset on next click           | Stage fades back to idle, source pulse resumes                      | ~300ms                  |

Motion guidelines:
- Use `prefers-reduced-motion` to suppress non-essential motion. The disc traversal can become an instant snap; the orbit during attest can become a still pulse.
- Easing: `cubic-bezier(.2, .8, .2, 1)` for entries, `cubic-bezier(.4, 0, 1, 1)` for exits.
- All animation must be CSS or Web Animations API. No motion libraries. Keep the bundle at zero.
- Test on a laptop trackpad and on a phone — the disc traversal should feel weighty, not zippy.

---

## 8. Tokens — defaults + override permissions

These are CK's defaults across the inj.so dashboards. The designer can override any of them with a reason.

### Color

| Token              | Value                | Override?       |
| ------------------ | -------------------- | --------------- |
| `--bg`             | `#06080d`            | OK if grounded  |
| `--surface`        | `#0d1118`            | OK              |
| `--surface-2`      | `#151a24`            | OK              |
| `--text`           | `#e7ecf3`            | Keep within 5%  |
| `--text-dim`       | `#8b95a8`            | Keep            |
| `--accent`         | `#00d2ff` (cyan)     | OK to add a *second* accent (e.g., violet, amber); cyan stays as the primary "live" color |
| `--success`        | `#4ade80`            | Keep            |
| `--err`            | `#f87171`            | Keep            |
| `--border`         | `rgba(255,255,255,.08)` | Keep         |
| Injective wordmark blue | `#0082fa`       | Use as a brand-presence accent in the header / stage, not in primary controls |

### Typography

- **Headings + UI**: Outfit (400/500/600/700)
- **Data, addresses, tx hashes, elapsed time**: JetBrains Mono (400/500)
- The big amount numeral (if hero-treated): designer's call — Outfit 600 with `font-feature-settings: "tnum"` or a dedicated display face like Geist or Inter Display. Run any new web-font choice past me first (perf budget: ≤1 extra font family, ≤2 weights).

### Spacing + radii

- 8px spacing scale (4, 8, 12, 16, 24, 32, 48).
- 12px or 16px radii on the card; 8px on inputs/buttons.
- Card max-width: ~480–560px. Don't go wider than 600px — this is a focused tool, not a dashboard.

### Effects

- A subtle noise-grain overlay (`opacity .025`) is in the current design. Keep or remove with intent.
- `backdrop-filter: blur(...)` — fine in moderation. Don't over-glassify.

---

## 9. Assets

You'll need:
- 6 chain logos (Ethereum, Arbitrum, Base, OP, Polygon, Avalanche). I'll provide as `public/chains/<id>.svg` once the design lands. For the mock, lean on placeholders or well-known mark approximations.
- 1 Circle logo for the middle node in direction A.
- 1 Injective wordmark/mark for the destination node + header.

USDC token mark for the disc — Circle's logo or a "USDC" badge is fine.

---

## 10. Out of scope

- Multi-asset support. This widget is USDC-only. Do not design for "switch to USDT."
- Solana support. EVM only.
- Outbound bridges (Injective → other chain). One direction.
- Recovery UI for stuck transfers. Documented in README; out of scope for V1 of the redesign.
- Wallet selection modal. The widget uses whatever EIP-1193 provider injects `window.ethereum`. Don't design a wallet picker.
- Dark/light toggle. Dark only. Forever.

---

## 11. Files to edit

In scope:
- `public/index.html` — markup. Free to restructure.
- `public/styles.css` — full rewrite expected.
- `public/app.js` — only the **render** functions: `renderSteps`, `setStep`, balance text writes, button text writes, `connect()`'s UI updates. The bridge state machine itself is locked.
- New: `public/assets/` — for logos, the disc SVG, etc.

Out of scope (do not touch):
- `public/chains.js`
- `public/cctp.js`
- `server.js`
- `package.json`
- The actual CCTP flow logic in `app.js` (anything between `await ensureChain(src)` and the final `setStep('mint', 'done', ...)`).

---

## 12. Definition of done

- All 5 step states visually distinct and glanceable.
- Cross-chain motion plays during the run; respects `prefers-reduced-motion`.
- Tx hashes remain visible + clickable through the redesign.
- Page is responsive: looks intentional at 360px, 768px, 1280px+.
- No new dependencies (still served as static files via Hono, no build step).
- Lighthouse perf ≥ 90 on simulated mid-tier mobile.
- I (CK) hard-refresh https://usdc.inj.so and audibly say "oh." That's the bar.
