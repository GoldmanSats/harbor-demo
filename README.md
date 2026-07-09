# Harbor

Privacy-preserving donation ledger for sensitive organizations.

**Slice One** — local demo: amount-first donor page + watch-only dashboard on a simulated Bitcoin network.

**Slice Two** — same demo as a **single deployable service** with a public URL (see [DEPLOY.md](./DEPLOY.md)).

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

Follow [DEPLOY.md](./DEPLOY.md) to put this on Render (or run the included Dockerfile).

## Verify gate

```bash
npm run verify
```

Runs typecheck, lint, unit tests (including BIP derivation vectors), and integration tests. Nothing is considered done unless this is green.

## Spec

See [SPEC.md](./SPEC.md) for acceptance criteria.

## Out of scope (so far)

Hardware wallets / signing, transaction composer, real Lightning/e-cash, BIP-353, blind mode, mainnet.
