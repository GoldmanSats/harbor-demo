# Harbor

Privacy-preserving donation ledger for sensitive organizations.

**Slice One** — local demo: amount-first donor page + watch-only dashboard on a simulated Bitcoin network.

**Slice Two** — same demo as a **single deployable service** with a public URL (see [DEPLOY.md](./DEPLOY.md)).

**Slice Three** — watch real Signet donations through mempool.space Esplora.

**Slice 3B** — connect a Trezor or Ledger without sharing private keys, import a watch-only wallet export, and test the complete flow on Testnet4. Harbor stores output descriptors and remains unable to sign or spend.

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

Follow [DEPLOY.md](./DEPLOY.md) to put this on Render (or run the included Dockerfile). Hosted demos stay on **mock** unless you explicitly set `HARBOR_NETWORK=signet` or `HARBOR_NETWORK=testnet4`.

## Hardware-wallet support

- **Direct and device-verified:** Trezor through Trezor Connect; Ledger through the Device Management Kit, Bitcoin signer kit, and WebHID.
- **Import tested:** pasted text, UTF-8 text files, JSON with a `descriptor`, `receiveDescriptor`, or `receive_descriptor` field, and static descriptor QR codes.
- **Import-only today:** Coldcard, Jade, and BitBox watch-only descriptor exports.
- **Planned:** direct Coldcard, Jade, and BitBox adapters; animated BBQr/UR scanning; mobile and Bluetooth transports.
- **Not supported:** transaction signing, seed/private-key import, multisig, and mainnet.

The direct Ledger flow needs a Chromium-family browser with WebHID on HTTPS or localhost. Trezor Connect also needs HTTPS or localhost and permission to open its approval UI. Unsupported browsers can always use file, text, or Advanced setup.

### Trezor manifest configuration

Trezor Connect requires application identity values at Vite build time:

```bash
VITE_TREZOR_MANIFEST_EMAIL=security@example.org
VITE_TREZOR_MANIFEST_URL=https://harbor.example.org
VITE_TREZOR_MANIFEST_APP_NAME=Harbor
```

Use an email and URL controlled by the deploying organization. Restart the Vite/build process after changing these values.

## Testnet4 quickstart

Testnet4 is the recommended path for testing with Trezor Suite while keeping all funds valueless:

1. Create a dedicated BIP-86 Taproot test wallet on the hardware device. Never reuse a wallet intended for mainnet funds.
2. Start Harbor with a dedicated database:

```bash
HARBOR_NETWORK=testnet4 \
HARBOR_DB_PATH=./data/harbor-testnet4.db \
npm run dev
```

3. Open `/dashboard`, choose **Connect Trezor** or **Connect Ledger**, and approve the read-only account request.
4. Choose **Verify address 0 on device** and compare the complete address shown by Harbor and the device. Harbor refuses to save an address mismatch.
5. Save the wallet, then open `/donate` and request an above-threshold donation address.
6. Fund the `tb1p…` address with Testnet4 faucet coins. Harbor polls `https://mempool.space/testnet4/api` approximately every 30 seconds and links detected transactions to the Testnet4 explorer.

For Ledger, unlock the device and open the Bitcoin app before connecting. For Trezor, allow the Trezor Connect approval window.

## Signet quickstart

1. Create a **Signet** BIP-86 Taproot wallet in a compatible wallet and export its watch-only descriptor.
2. Run Harbor in Signet mode:

```bash
HARBOR_NETWORK=signet npm run dev
```

3. Open the dashboard → **Import watch-only wallet** → paste or choose the export → **Preview wallet**.
4. Compare all three server-derived addresses with the source wallet, confirm the comparison, and save.
5. Get Signet coins from a public faucet; open `/donate`, enter an above-threshold amount, and send to the issued `tb1p…` address.
6. Within ~30 seconds the donation should appear **pending**; after a Signet block it becomes **confirmed**, with an explorer link.

On-chain addresses are not issued on Signet or Testnet4 until an organization wallet is connected. Lightning preview remains available.

## Import and Advanced setup

Use **Import watch-only wallet** for descriptor text, a `.txt`/`.json` file, or a static QR. Harbor accepts only a checksummed or checksum-free single-key BIP-86 Taproot receive descriptor for the test-network account and canonicalizes it before storage. It rejects private keys, script trees, multisig, wrong-network paths, and malformed wildcards.

If a wallet can provide only an account-level `xpub`, `tpub`, or `vpub`, expand **Advanced setup**. Preview and independently compare all three addresses before saving. Advanced setup is a compatibility fallback; normal organization onboarding does not require descriptor, derivation-path, or xpub terminology.

Reconnects of the same underlying wallet preserve issued addresses and donation history, even when the export encoding or connection method differs. Connecting a genuinely different wallet requires explicit confirmation and clears that wallet-specific history.

## Verify gate

```bash
npm run verify
```

Runs typecheck, lint, unit tests (including descriptor, adapter, component, BIP derivation, and Esplora fixture coverage), and integration tests. Nothing is considered done unless this is green. CI stays network-free.

## Spec

See [SPEC.md](./SPEC.md) for acceptance criteria, including A12 descriptor wallets, A13 hardware onboarding, and A14 Testnet4.

## Out of scope (so far)

Hardware-wallet signing, transaction composer, real Lightning/e-cash, BIP-352 silent payments, BIP-353, blind mode, mainnet, direct Coldcard/Jade/BitBox USB, animated BBQr/UR, mobile, and Bluetooth.
