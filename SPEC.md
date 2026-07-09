# Harbor Slice One — Specification

This document is the referee for all agent-produced work. A feature is done only when its acceptance criteria pass under `npm run verify`.

## Product summary

Harbor Slice One is a **local demo** of a privacy-preserving donation ledger:

1. A donor visits `/donate`, enters an amount, and is routed:
   - **Below threshold** (default 500,000 sats): Lightning / e-cash rail, watermarked as **preview**.
   - **At or above threshold**: a **fresh on-chain taproot address** derived from the org's watch-only xpub.
2. The org visits `/dashboard` and sees donations detected on a simulated Bitcoin network, valued in fiat at first sight, with under-threshold on-chain dust **quarantined**.

No private keys. No signing. No mainnet. Fake money only.

## Constants

| Name | Default | Notes |
|------|---------|-------|
| `THRESHOLD_SATS` | `500000` | Configurable via settings API |
| `ADDRESS_TTL_MS` | `3600000` (1 hour) | Unpaid issued addresses may be recycled after expiry |
| `POLL_INTERVAL_MS` | `2000` | Detection poller interval |
| `MOCK_BTC_USD` | `115000` | Mock rate provider (slice one) |
| Network | `regtest` or in-process mock | Prefer Docker bitcoind; fall back to mock RPC |

## Acceptance criteria

### A1 — Address derivation

1. Given a BIP-86 account xpub for regtest, deriving index `i` yields a valid bech32m (`bcrt1p…`) taproot address.
2. Derivation matches official BIP-86 / BIP-32 test vectors used in unit tests.
3. Consecutive indices produce distinct addresses.
4. The same `(xpub, index)` always produces the same address (deterministic).

### A2 — Issuance registry (gap-limit proof)

1. `POST /api/donate/address` returns a previously unused address (or a recycled expired unpaid one).
2. **No address is ever served twice while it is still active** (issued and not expired, or already paid).
3. Unpaid addresses older than `ADDRESS_TTL_MS` may be recycled and re-issued.
4. Every issued address is persisted in SQLite with: address, derivation index, issued_at, expires_at, status (`issued` \| `paid` \| `expired` \| `recycled`).
5. The registry is exportable via `GET /api/registry/export` (JSON).

### A3 — Amount-first routing

1. Amounts `< THRESHOLD_SATS` return rail `lightning` with a preview BOLT12-style offer string and `preview: true`.
2. Amounts `>= THRESHOLD_SATS` return rail `onchain` with a fresh address and BIP-321 URI `bitcoin:<address>?amount=<btc>`.
3. Amount `0` or negative is rejected with HTTP 400.
4. Threshold is readable/writable via `GET/PUT /api/settings`.

### A4 — Detection & ledger

1. When a watched address receives a payment on the simulated chain, a donation row is created within one poll interval after confirmation (or after detection of an unconfirmed tx, with `confirmations: 0`).
2. Donation fields: `txid`, `vout`, `address`, `amount_sats`, `confirmations`, `fiat_usd_at_receipt`, `status`, `first_seen_at`.
3. **Fiat value is captured at first-seen time and never restated** when the mock rate changes later.
4. If `amount_sats < THRESHOLD_SATS` at first sight, status is `quarantined`.
5. If `amount_sats >= THRESHOLD_SATS` and confirmations `>= 1`, status is `confirmed`; if unconfirmed, `pending`.
6. Quarantined donations remain quarantined even after more confirmations.

### A5 — Donor page

1. Amount input with presets; routing updates when amount changes.
2. On-chain path shows address, BIP-321 URI, and a scannable QR.
3. Lightning path shows a watermarked **Preview** badge and non-functional offer string.
4. Dev-only "Simulate payment" control may call the simulate API when the backend is in mock/regtest mode.

### A6 — Dashboard

1. Shows cold-storage balance (sum of confirmed + pending non-quarantined on-chain donations), quarantined total, donation count.
2. Donations table with date, rail, amount, fiat-at-receipt, status tone.
3. Quarantined rows are visually distinct.
4. CSV export of the ledger via `GET /api/donations/export.csv`.
5. Threshold setting editable from the dashboard.

### A7 — Demo & verify gates

1. `npm run demo` starts backend + web and prints URLs.
2. `npm run simulate-donor` (optional `--amount`) pays a fresh address and advances the chain.
3. `npm run verify` = typecheck + lint + unit tests + integration test, all green.
4. Integration test: issue address → pay → mine/confirm → assert ledger row + dashboard API.

## Out of scope

Hardware wallets, PSBT composer, real Lightning/Fedimint/Cashu/Spark, BIP-353, blind mode, mainnet, multi-tenant production hosting, seed handling.

## Slice Two addenda (hosted demo)

### A8 — Single-process production mode

1. With `HARBOR_SERVE_WEB=1` / `NODE_ENV=production`, Fastify serves `web/dist` and SPA-falls back `/donate` and `/dashboard` to `index.html`.
2. `/api/*` routes continue to work on the same origin/port.
3. Host binds `0.0.0.0` and respects `PORT`.
4. Hosted mode forces mock Bitcoin RPC (fake money).

### A9 — Demo reset

1. `POST /api/demo/reset` clears donations and issued addresses and restores default settings.
2. UI exposes a **Reset demo** control and a visible simulated-network banner.
