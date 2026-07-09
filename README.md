# Harbor

Privacy-preserving donation ledger for sensitive organizations.

**Slice One** delivers a local demo: an amount-first donor page and a watch-only org dashboard, running against a simulated Bitcoin network (regtest or an in-process mock when Docker/Bitcoin Core is unavailable).

## Quick start

```bash
npm install --cache ./.npm-cache   # or plain npm install if your global cache works
npm run demo
```

This starts:

1. A Bitcoin backend — Docker regtest if `HARBOR_BITCOIN=regtest` and bitcoind is reachable, otherwise an **in-process mock RPC** (default for `npm run demo` so the demo works without Docker).
2. The API server on http://127.0.0.1:3001
3. The web app on http://localhost:5173

Open:

- Donor page: http://localhost:5173/donate
- Org dashboard: http://localhost:5173/dashboard

Simulate a donation:

```bash
npm run simulate-donor
# or: npm run simulate-donor -- --amount 750000
```

### Optional: real Bitcoin Core regtest

```bash
npm run regtest:up          # requires Docker
HARBOR_BITCOIN=regtest npm run demo
```

## Verify gate

```bash
npm run verify
```

Runs typecheck, lint, unit tests (including BIP derivation vectors), and the regtest/mock integration test. Nothing is considered done unless this is green.

## Spec

See [SPEC.md](./SPEC.md) for acceptance criteria. The spec is the referee for all agent-produced work.

## Out of scope (this slice)

Hardware wallets / signing, transaction composer, real Lightning/e-cash, BIP-353 DNS, blind mode, mainnet, and hosted deployment.
