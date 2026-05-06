# USDC → Injective Bridge — Design Handoff

> **From:** Design (the redesign in `USDC Widget Prototype.html`)
> **To:** Claude Code, implementing in `ckhbtc/usdc-widget`
> **Scope:** Replace `public/index.html`, `public/styles.css`, and the **render functions only** in `public/app.js`. All bridge logic is locked.
> **Direction shipped:** A+B Hybrid — Cinematic Cross-Chain Stage with HUD typography.

---

## 0. What's in this folder

| File | Purpose |
|---|---|
| `USDC Widget Prototype.html` | The reference build. Open this, hit **▶ Run full sequence** in Tweaks. Match this. |
| `USDC Widget Redesign.html` | Static frames of all 8 states (idle/disconnected, idle/connected, approving, burning, attesting, minting, success, failed) for both directions. Reference for any state the prototype's run misses. |
| `styles.css` | Production-ready. Drop in as-is, then tune. |
| `prototype.jsx` | Reference component. Not for production — the existing `app.js` keeps its CCTP state machine; only its render layer adopts this DOM + class structure. |

---

## 1. Aesthetic in one paragraph

Dark, premium, slightly cockpit. Outfit for the brand line, **JetBrains Mono everywhere else** — labels, CTAs, addresses, hashes, elapsed time. Cyan (`#00d2ff`) is the "live" color, amber (`#f5b544`) is "waiting," green (`#4ade80`) is "done," red (`#f87171`) is failure. Injective blue (`#0082fa`) lives in the brand mark and the destination node — never on form controls. Hairline corner brackets on the stage; faint radial glow behind the card; 0.025 noise overlay. No glassmorphism, no gradients-as-brand, no 3D coins.

---

## 2. DOM structure to ship

The card is a **50/50 split** on desktop, stacked on mobile (≤640px). Form left, vertical 3-node stage right.

```
<main class="widget hud">
  <div class="card">
    <header class="card-header">
      <div class="brand">
        <div class="brand-mark">…inj diamond svg…</div>
        <div class="brand-text">
          <div class="brand-name">USDC → INJECTIVE</div>
          <div class="brand-sub">CCTP V2 · DOMAIN 29</div>
        </div>
      </div>
      <button class="connect-btn">
        <span class="pulse-dot"></span>
        <span class="addr">0x6F4d…A92c</span>
      </button>
    </header>

    <div class="split">
      <section class="form">
        <div class="field">
          <label class="field-label">§ FROM</label>
          <div class="chain-select"> chainmark + name + caret + popover </div>
        </div>
        <div class="field">
          <label class="field-label">§ AMOUNT</label>
          <div class="amount-row hero">
            <div class="amount-input-row">
              <input class="amount-input" />
              <span class="amount-suffix">USDC</span>
            </div>
            <div class="amount-meta">
              <span class="balance">BAL <span class="num">…</span></span>
              <button class="max-btn">MAX</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label class="field-label">§ RECIPIENT · INJ EVM</label>
          <div class="recipient">
            <div class="recipient-avatar"></div>
            <span class="recipient-addr">…full 0x…</span>
            <span class="recipient-edit">EDIT</span>
          </div>
        </div>
        <button class="btn-primary">BRIDGE TO INJECTIVE</button>
      </section>

      <section class="stage">
        <span class="hud-corner tl"></span><span class="hud-corner tr"></span>
        <span class="hud-corner bl"></span><span class="hud-corner br"></span>

        <header class="stage-header">
          <span>§ TRANSFER STAGE</span>
          <span class="live-pill"><span class="blip"></span>IDLE</span>
        </header>

        <div class="stage-track">
          <div class="node ..."> source row: avatar/ring/pip + label/name + status </div>
          <div class="segment ...">
            <div class="fill"></div>
            <div class="disc">$</div>  <!-- when present -->
          </div>
          <div class="node ..."> circle row </div>
          <div class="segment ..."> ...disc when present... </div>
          <div class="node ..."> injective row </div>
        </div>

        <div class="detail-strip ...">
          <div class="icon"></div>
          <span class="strong">…</span> · <span>…</span>
          <a class="hash" href="…">0x…</a>
          <span class="elapsed">04:12</span>
        </div>
      </section>
    </div>

    <footer class="card-footer">…</footer>
  </div>
</main>
```

**Always keep the `hud` class on `.widget`.** That class swaps the type stack to mono and turns on the corner brackets. (We may A/B against the non-HUD `cinematic` variant later — leaving the toggle in place is cheap.)

---

## 3. State → class mapping (the contract for `setStep` / `renderSteps`)

There's only one source of truth in production: the five-step state machine in `app.js`. The renderer's job is to translate `(stepKey, stepState, ctx)` into class names on existing nodes. **No DOM is added or removed during a run** — only classes flip and a few text nodes update.

### 3.1 Phase derivation

The renderer collapses the 5 steps into a **phase string** that drives every visual:

```
idle → approve-sign → approve-confirm → burn-sign → burn-confirm
     → attest → switch → mint-sign → mint-confirm → success
                                                    ↘ failed
```

Mapping from the existing state machine to phase:

| Step states                                                              | Phase            |
|--------------------------------------------------------------------------|------------------|
| all `pending`, idle                                                      | `idle`           |
| `approve: active` (no tx hash yet)                                       | `approve-sign`   |
| `approve: active` + has tx hash                                          | `approve-confirm`|
| `approve: done`, `burn: active` (no tx hash)                             | `burn-sign`      |
| `approve: done`, `burn: active` + has tx hash                            | `burn-confirm`   |
| `burn: done`, `attest: active`                                           | `attest`         |
| `attest: done`, `switch: active`                                         | `switch`         |
| `switch: done`, `mint: active` (no tx hash)                              | `mint-sign`      |
| `mint: active` + has tx hash                                             | `mint-confirm`   |
| `mint: done`                                                             | `success`        |
| any step `failed`                                                        | `failed`         |

(If `approve` is skipped due to sufficient allowance, jump from `idle` straight to `burn-sign` — the visual stage segment `seg1` for that case is still `cyan-partial`.)

### 3.2 Per-phase render

For each phase, set classes on these elements. Empty cell = no class beyond base.

| Phase            | source `.node`        | seg1 `.segment`   | circle `.node`        | seg2 `.segment`   | inj `.node`           | live-pill        | `.btn-primary` | `.detail-strip` |
|------------------|-----------------------|-------------------|-----------------------|-------------------|-----------------------|------------------|----------------|-----------------|
| idle             | `idle-pulse`          | `empty`           | `dim`                 | `empty`           | `dim`                 | `idle` (text IDLE) | `` (BRIDGE TO INJECTIVE) | hidden |
| approve-sign     | `live cyan`           | `empty`           | `dim`                 | `empty`           | `dim`                 | `` (LIVE)        | `active` BRIDGING… | `cyan` "APPROVE USDC · Awaiting wallet signature" |
| approve-confirm  | `live cyan`           | `full` 50%        | `dim`                 | `empty`           | `dim`                 | `` (LIVE)        | `active`       | `cyan` + approve hash |
| burn-sign        | `live cyan`           | `full` 50%        | `dim`                 | `empty`           | `dim`                 | `` (LIVE)        | `active`       | `cyan` "BURN ON SOURCE · Awaiting signature" |
| burn-confirm     | `live cyan`           | `full` 50%        | `dim`                 | `empty`           | `dim`                 | `` (LIVE)        | `active`       | `cyan` + burn hash |
| attest           | `done`                | `cyan-amber` 100% | `live amber`          | `empty`           | `dim`                 | `amber` WAITING  | `active`       | `amber` + elapsed `mm:ss` |
| switch           | `done`                | `full` 100%       | `done`                | `amber` 50%       | `dim`                 | `` (LIVE)        | `active`       | `cyan` "SWITCH NETWORK" |
| mint-sign        | `done`                | `full` 100%       | `done`                | `amber-green` 100%| `live cyan`           | `` (LIVE)        | `active`       | `cyan` "MINT ON INJECTIVE · Awaiting signature" |
| mint-confirm     | `done`                | `full` 100%       | `done`                | `amber-green` 100%| `live cyan`           | `` (LIVE)        | `active`       | `cyan` + mint hash |
| success          | `done`                | `full` 100%       | `done`                | `green` 100%      | `done`                | `green` COMPLETE | `success` BRIDGE ANOTHER → | `green` "{amount} USDC ARRIVED" |
| failed           | `done`                | `full` 100%       | `done`                | `amber-green` 100%| `live red` (`failed`) | `red` ATTENTION  | `` RETRY MINT  | `red` "MINT FAILED · funds safe" |

Notes:
- `.fill` inside each `.segment` is positioned `inset:0; height: 0% / 50% / 100%` and transitions in 600ms `cubic-bezier(.2,.8,.2,1)`.
- `.disc` is an absolutely-positioned child of whichever segment currently holds it. Move it by changing `top:` (also transitions 600ms). Tone classes: base = cyan, `.amber`, `.green`.
- During `attest` the disc gets the `.orbit` class — CSS `@keyframes orbit` traces a 28px square loop. `prefers-reduced-motion` kills the orbit (rule already in `styles.css`).

### 3.3 Disc position table

Disc is parented to **one** segment at a time:

| Phase            | parent  | top % |
|------------------|---------|-------|
| approve-sign…burn-confirm | seg1 | 8%   |
| attest           | seg1    | 92% (sits at the Circle node, with `.orbit`) |
| switch           | seg2    | 50%  |
| mint-sign…success/failed | seg2 | 92% |

When the parent changes, do an immediate re-mount (no transition between segments — only `top` transitions inside a segment).

---

## 4. Motion choreography

All motion is CSS or Web Animations API. **No motion library.** Spec from `DESIGN_HANDOFF.md` §7 holds; the prototype implements it with these primitives:

- **Idle pulse on source:** `@keyframes idle-pulse` on `.node.idle-pulse .node-avatar .ring`. 2.5s ease-in-out infinite.
- **Disc traversal:** `top` transition on the disc, 600ms `cubic-bezier(.2,.8,.2,1)`.
- **Segment fill:** `height` transition on `.segment .fill`, 600ms same easing.
- **Orbit during attest:** `@keyframes orbit` on the disc, 2.4s linear (1.8s in cinematic mode). Purely visual — does not gate progress.
- **Success bloom:** mount `.success-overlay` with two concentric rings (`.ring1`, `.ring2`) and the `.amount-restated` chip; both fade in. Add a 400ms scale-in keyframe if you want extra punch.

`prefers-reduced-motion: reduce` already disables the orbit and the idle-ring pulse. Apply equivalent overrides if you add new motion: traversal becomes a snap, decorative pulses become static states.

---

## 5. Tokens (final values)

```css
:root {
  --bg: #06080d;
  --surface: #0d1118;
  --surface-2: #151a24;
  --surface-3: #1c2230;
  --text: #e7ecf3;
  --text-dim: #8b95a8;
  --text-mute: #5a6377;
  --border: rgba(255, 255, 255, 0.08);
  --border-soft: rgba(255, 255, 255, 0.04);
  --accent: #00d2ff;          /* live */
  --accent-amber: #f5b544;    /* waiting */
  --inj-blue: #0082fa;        /* brand-only — header mark + INJ destination node */
  --success: #4ade80;
  --err: #f87171;
  --sans: 'Outfit', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
}
```

- **Card:** `min(560px, calc(100% - 48px))`, 16px radius, 1px border `--border`.
- **Inputs/buttons:** 10px radius (8px is also fine if you want it tighter).
- **Spacing scale:** 4 / 8 / 12 / 14 / 18 / 22.
- **Type scale:** 10–11px mono labels (uppercase, letter-spacing 0.06–0.12em); 12–13px mono body; 14–15px UI; 32px hero amount with `font-feature-settings:"tnum"`.
- **Fonts:** Outfit 400/500/600/700; JetBrains Mono 400/500. Already imported via Google Fonts in `styles.css`.

Per spec: cyan is the only "primary" accent on form controls. Injective blue lives **only** in the brand-mark gradient and the destination node ring/pip. Don't use blue on the CTA.

---

## 6. Live-data writes (the only DOM text the renderer touches)

| Selector                      | What to write                              | When                                          |
|-------------------------------|--------------------------------------------|-----------------------------------------------|
| `.connect-btn .addr`          | truncated address, mono                    | on connect/disconnect                          |
| `.connect-btn .pulse-dot`     | toggle `.idle` class for disconnected      | "                                              |
| `.amount-meta .balance .num`  | balance with 2dp, tabular nums; `—` if disconnected; `loading…` if pending | on chain switch / balance refresh             |
| `.amount-input` value         | only when MAX is clicked                   | user action                                    |
| `.btn-primary` text + class   | per phase table above                      | every phase change                             |
| `.live-pill` text + class     | per phase table above                      | every phase change                             |
| Each `.node` class list       | per phase table above                      | every phase change                             |
| Each `.segment` class + `.fill` height | per phase table above              | every phase change                             |
| `.disc` parent + `top` + tone class | per disc-position table              | every phase change                             |
| `.detail-strip` class + children | per phase table above                   | every phase change                             |
| `.node-status` for source     | last known tx hash (burn > approve), or "SIGNING…" / "READY" | as new hashes arrive |
| `.node-status` for circle     | "ATTESTING" + elapsed `mm:ss`              | tick once per second during attest             |
| `.node-status` for inj        | "MINTING…" → "MINTED" + mint hash → "FAILED" | on mint progress                              |

Tx hashes everywhere are `<a class="hash" href="…">{trunc}</a>` where `trunc = first6 + '…' + last4`, and `href` points to the existing chain explorer URL builder — both rules already exist in `app.js`.

---

## 7. Responsive

- **≥768px:** 50/50 split. Card max 560px wide.
- **<768px:** Stack — form on top, stage below. Stage minimum height stays ~360px so the three nodes don't compress. The `.split` rule needs a `@media (max-width: 768px) { .split { grid-template-columns: 1fr; } .stage { border-left: 0; border-top: 1px solid var(--border-soft); } }`.
- **360px:** Recipient address truncates with ellipsis. EDIT button stays visible. Amount input scales to 26px if the input wraps.

---

## 8. Accessibility

- All interactive elements are `<button>` or `<input>` — keep it that way.
- Live-pill announces phase changes: add `aria-live="polite"` on `.live-pill`.
- Detail strip: `role="status"` on `.detail-strip`. Don't announce on every elapsed-time tick; keep it announcing only on phase change (toggle the role off → on with a short delay if needed, or use `aria-live="polite"` only on phase-text spans, not on the elapsed counter).
- Disc and node rings are decorative — `aria-hidden="true"`.
- Tx-hash links: `aria-label="Approve transaction on Etherscan"` etc.
- `prefers-reduced-motion` already handled; verify on macOS reduce-motion + Win equivalent.

---

## 9. Definition of done (mirrors §12 of original handoff)

- [ ] All 5 step states visually distinct and glanceable from across a room.
- [ ] Cross-chain motion plays during the run; respects `prefers-reduced-motion`.
- [ ] Tx hashes inline on each node + in detail strip — copy/paste-able + clickable to explorer.
- [ ] 360 / 768 / 1280px all look intentional. Stack on small.
- [ ] No new dependencies. Static files only. No build step.
- [ ] Lighthouse perf ≥ 90 on simulated mid-tier mobile.
- [ ] CK hard-refreshes and audibly says "oh."

---

## 10. Things to watch for

- **Don't recreate the React component as-is.** The existing `app.js` is plain JS + a `setStep(key, state, ctx)` function. Adapt that to flip classes per the table in §3.2. The React in `prototype.jsx` is reference, not deliverable.
- **One source of truth for phase.** Don't sprinkle phase logic across `setStep` calls; derive it once at the top of `renderSteps` and dispatch from there.
- **Keep `chains.js`, `cctp.js`, `server.js`, and the bridge logic in `app.js` untouched.** Only render functions move.
- **Real chain logos:** placeholders in the design are colored monograms. When CK ships `public/chains/<id>.svg`, swap `.chain-mark.<id>` to render an `<img>` instead of the letter — keep the same outer 22/32/44px circle so layout doesn't shift.
- **Disc parenting on segment switch.** The disc must be a child of the segment it visually occupies. When transitioning across the Circle node (seg1 → seg2), unmount/remount instantly — the prior segment's `.fill` reaching 100% is what visually carries continuity.

---

## 11. Open questions for CK

1. **Confetti?** Spec said "medium" celebration — the prototype ships radial pulse + restated-amount chip. Want particles too?
2. **Allowance-skip animation.** When step 1 skips, do we want a quick "ALLOWANCE OK" flash on the source node before jumping into burn, or just silently start at burn-sign?
3. **Connect modal.** Spec says no wallet picker. The connect button currently opens nothing (and just triggers `window.ethereum`). Does the disconnected pill need a hover/empty state beyond what's there?
4. **Address truncation.** Recipient currently shows the full 0x. Should it always truncate (mid-ellipsis) on mobile, or wrap?

— end —
