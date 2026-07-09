# Harbor

Privacy-preserving donation ledger for sensitive organizations.

**Slice One** — local demo: amount-first donor page + watch-only dashboard on a simulated Bitcoin network.

**Slice Two** — same demo as a **single deployable service** with a public URL (see [DEPLOY.md](./DEPLOY.md)).

**Slice Three** — watch a real Sparrow signet wallet via mempool.space Esplora; paste your own xpub and verify addresses before accepting donations.

## Quick start (local)

```bash
npm install --cache ./.npm-cache   # or plain npm install if your global cache works
npm run demo
```

Opens Vite + API locally:

- Donor page: http://localhost:5173/donate
- Org dashboard: http://localhost:5173/dashboard

Simulate a donation:

```bash
npm run simulate-donor
# or: npm run simulate-donor -- --amount 750000
```

### Production-style local (one process)

```bash
npm run build
npm run start:local
```

Then open http://127.0.0.1:3001/donate

Or for a Render-like start (env defaults applied in `server/src/index.ts` when `NODE_ENV=production`):

```bash
NODE_ENV=production npm start
```

### Hosted demo

Follow [DEPLOY.md](./DEPLOY.md) to put this on Render (or run the included Dockerfile). Hosted demos stay on **mock** unless you explicitly set `HARBOR_NETWORK=signet`.

## Signet quickstart (Slice Three)

1. Install [Sparrow](https://sparrowwallet.com/), create a **signet** wallet (Taproot / BIP-86), and note the first few receive addresses.
2. Export the account xpub from Sparrow (`tpub` / `vpub` are fine).
3. Run Harbor in signet mode:

```bash
HARBOR_NETWORK=signet npm run dev
```

4. Open the dashboard → **Connect your wallet** → paste the xpub → **Preview addresses** → confirm they match Sparrow receive #0–#2 → **Save wallet**.
5. Get signet coins from a public faucet; open `/donate`, enter an above-threshold amount, and send to the issued `tb1p…` address from Sparrow (or any wallet).
6. Within ~30s the donation should appear **pending**; after a signet block (~10 min) it becomes **confirmed**, with an explorer link. Balance is spendable only in your Sparrow wallet.
7. Send a dust amount below the threshold — it should **quarantine** and never count toward cold storage.

On-chain donation addresses are not issued on signet until an organization xpub is saved (HTTP 409 otherwise).

## Verify gate

```bash
npm run verify
```

Runs typecheck, lint, unit tests (including BIP derivation vectors and Esplora fixtures), and integration tests. Nothing is considered done unless this is green. CI stays network-free.

## Spec

See [SPEC.md](./SPEC.md) for acceptance criteria (including A10 signet detection and A11 xpub onboarding).

## Out of scope (so far)

Hardware wallets / signing, transaction composer, real Lightning/e-cash, BIP-352 silent payments, BIP-353, blind mode, mainnet.
