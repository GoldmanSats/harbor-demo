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
2. Donation fields: `txid`, `vout`, `address`, `amount_sats`, `confirmations`, `fiat_usd_at_receipt`, `status`, `first_seen_at`, `rail`.
3. **Fiat value is captured at first-seen time and never restated** when the mock rate changes later.
4. If `rail=onchain` and `amount_sats < THRESHOLD_SATS` at first sight, status is `quarantined`.
5. If `rail=onchain` and `amount_sats >= THRESHOLD_SATS` and confirmations `>= 1`, status is `confirmed`; if unconfirmed, `pending`.
6. Quarantined donations remain quarantined even after more confirmations.
7. Simulated Lightning donations (`rail=lightning`) are recorded as `confirmed` e-cash receipts and **never** quarantined; they count toward `ecashSats`, not `quarantinedSats`.
8. `POST /api/demo/simulate` without an explicit address follows donor-page routing (Lightning below threshold, on-chain at/above).

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

Hardware-wallet transaction signing, PSBT composer, real Lightning/Fedimint/Cashu/Spark, BIP-353, blind mode, mainnet, multi-tenant production hosting, seed handling.

## Slice Two addenda (hosted demo)

### A8 — Single-process production mode

1. With `HARBOR_SERVE_WEB=1` / `NODE_ENV=production`, Fastify serves `web/dist` and SPA-falls back `/donate` and `/dashboard` to `index.html`.
2. `/api/*` routes continue to work on the same origin/port.
3. Host binds `0.0.0.0` and respects `PORT`.
4. Hosted mode forces mock Bitcoin RPC (fake money), unless `HARBOR_NETWORK=signet` is set explicitly.

### A9 — Demo reset

1. `POST /api/demo/reset` clears donations and issued addresses and restores default settings.
2. UI exposes a **Reset demo** control and a visible simulated-network banner.

## Slice Three addenda (signet + xpub onboarding)

### Constants (additions)

| Name | Default | Notes |
|------|---------|-------|
| `HARBOR_NETWORK` | `mock` (hosted) / auto | `mock` \| `regtest` \| `signet` |
| `SIGNET_POLL_INTERVAL_MS` | `30000` | Public Esplora etiquette |
| Esplora base | `https://mempool.space/signet/api` | Injected `fetch` in tests |

### A10 — Signet detection

1. With `HARBOR_NETWORK=signet`, Harbor uses an Esplora client (`kind: "esplora"`) against the public signet explorer API — not mock or local bitcoind.
2. A real (or fixture-stubbed) transaction paying a watched address with `amount_sats >= THRESHOLD_SATS` appears as `pending` when unconfirmed (`confirmations: 0`) and becomes `confirmed` once the tip implies `confirmations >= 1`.
3. Fiat-at-receipt is set from the live (or cached/fallback) BTC/USD rate at first sight and never restated.
4. Under-threshold on-chain amounts are `quarantined` and stay quarantined.
5. `/api/health` exposes `network: "signet"`; simulate/dev tools are disabled (`demoTools: false`).
6. Donation txids link to `https://mempool.space/signet/tx/:txid` in the UI.
7. Unit/integration coverage uses recorded Esplora JSON fixtures — **no live network in CI**.

### A11 — Xpub onboarding

1. `GET/PUT /api/settings` includes optional `accountXpub`. Server prefers the DB value over `HARBOR_XPUB` / the demo key.
2. Validation: key parses (including `tpub` / `vpub` version bytes), is account-level (BIP-32 depth 3), and derives index 0 successfully.
3. `POST /api/settings/xpub/preview` validates without persisting and returns the first 3 external receive addresses so the org can compare them to Sparrow **before** saving.
4. Settings responses include `previewAddresses` for the currently active (saved or demo) key.
5. Changing to a **different** normalized xpub clears issued addresses and the donation ledger. Re-saving the same normalized xpub (including `tpub`/`vpub` ↔ `xpub`) must **not** reset.
6. On signet, `POST /api/donate/address` for on-chain amounts returns HTTP 409 until an organization xpub is saved — the demo key is not used for real-network issuance.
7. Dashboard shows a **Connect your wallet** panel: paste → preview → verify against Sparrow → save.

## Slice 3B addenda (hardware-wallet onboarding + Testnet4)

### Constants (additions)

| Name | Default | Notes |
|------|---------|-------|
| `HARBOR_NETWORK` | `mock` (hosted) / auto | Adds explicit `testnet4`; explicit public networks override hosted mock defaults |
| Testnet4 Esplora base | `https://mempool.space/testnet4/api` | Injected `fetch` in tests |
| Public-network polling | `30000` | Applies to Signet and Testnet4 |

### A12 — Descriptor wallet

1. Harbor persists a canonical checksummed single-key BIP-86 Taproot receive descriptor and optional change descriptor, plus source, master fingerprint, account path, and connection time. It never persists or accepts private keys.
2. Validation accepts only `tr([fingerprint/86h/coin_typeh/accounth]account_xpub/0/*)` receive descriptors for the active test network and derives the first three addresses server-side. Non-Taproot scripts, script trees, multisig, malformed wildcards, wrong-network keys, wrong purpose/coin/account depth, and private keys are rejected.
3. Opening a database containing a legacy `account_xpub` migrates it to the equivalent canonical descriptor without clearing issued addresses or donations. `GET /api/settings` and the xpub preview endpoint remain compatibility aliases for Advanced setup, but `PUT /api/settings` rejects account-key writes; all saves must use the verified wallet contract.
4. Reconnecting the same normalized wallet never clears data, including when the source, checksum, hardened-marker syntax, or extended-public-key version encoding differs.
5. Replacing the wallet with a genuinely different descriptor requires an explicit destructive-change confirmation. Only a confirmed change clears issued addresses and donations.
6. Address issuance derives from the persisted validated receive descriptor while retaining existing expiry, recycling, and gap-limit behavior. Regtest Core imports that stored descriptor rather than rebuilding one independently from `HARBOR_XPUB`.

### A13 — Hardware-wallet onboarding

1. The primary dashboard flow offers **Connect Trezor**, **Connect Ledger**, and **Import watch-only wallet**, and explains that Harbor can observe the donation account but cannot move funds. Normal flow does not expose xpub, descriptor, or derivation-path terminology.
2. Trezor Connect requests BIP-86 account public information and displays receive address 0 on the device. Ledger uses secure-context WebHID, the Device Management Kit, and Bitcoin signer kit to request the same information and display receive address 0. Harbor saves only after the displayed address exactly matches the server preview.
3. Device denial, disconnection, wrong app/network, unsupported browser, popup, and address-mismatch failures are recoverable, plain-language errors. Vendor SDKs are lazy-loaded so Import and Advanced remain available in unsupported browsers.
4. Import accepts pasted descriptors, UTF-8 text files, JSON with a standard descriptor field, and static descriptor QR codes. Animated BBQr/UR and direct Jade, Coldcard, and BitBox adapters are explicitly identified as unsupported/planned.
5. Manual account-public-key entry remains under collapsed **Advanced setup** and routes through the same server descriptor validation and preview-before-save pipeline. Imported/manual wallets require explicit confirmation that all three preview addresses were independently compared.
6. Hardware integrations are read-only: no signing, spending, seed, private-key, or mainnet capability is requested or implemented.

### A14 — Testnet4

1. `HARBOR_NETWORK=testnet4` is a distinct Harbor network using test-network key/address encoding, `https://mempool.space/testnet4/api`, public-network polling, and the live-rate provider. It overrides hosted mock defaults when explicit; hosted deployments remain mock by default.
2. `/api/health` reports `network: "testnet4"` and Esplora reports chain `testnet4`. Simulate/dev mutation tools are disabled.
3. Testnet4 on-chain issuance returns HTTP 409 until a non-demo watch-only wallet is connected, matching Signet safety behavior.
4. Testnet4 transactions link to `https://mempool.space/testnet4/tx/:txid`; dashboard and donor UI show a distinct Testnet4 badge and explanatory copy.
5. Fixture-driven tests cover pending-to-confirmed Testnet4 detection with no live HTTP in CI, while mock, regtest, and Signet behavior remain green.
