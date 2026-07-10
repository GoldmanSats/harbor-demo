import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { MockBitcoinRpc } from "./bitcoin/mock-rpc.js";
import { getActiveIssuedAddresses, listDonations } from "./db/schema.js";
import { pollOnce, MockRateProvider } from "./services/detection.js";

describe("slice one integration", () => {
  let dbPath: string;
  let harbor: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `harbor-int-${Date.now()}-${Math.random()}.db`);
    harbor = await createApp({
      dbPath,
      rpc: new MockBitcoinRpc(),
      listen: false,
    });
    await harbor.app.ready();
  });

  afterEach(async () => {
    await harbor.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("routes small amounts to lightning preview", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 40_000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rail).toBe("lightning");
    expect(body.preview).toBe(true);
  });

  it("issues on-chain address for large amounts", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rail).toBe("onchain");
    expect(body.address).toMatch(/^bcrt1p/);
    expect(body.uri).toContain("bitcoin:");
  });

  it("rejects invalid amounts", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("issue → pay → mine → ledger + dashboard API", async () => {
    const issue = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 800_000 },
    });
    const { address } = issue.json();

    const sim = await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { address, amountSats: 800_000, confirmations: 1 },
    });
    expect(sim.statusCode).toBe(200);

    const donations = listDonations(harbor.db);
    expect(donations.some((d) => d.address === address && d.amountSats === 800_000)).toBe(true);

    const dash = await harbor.app.inject({ method: "GET", url: "/api/donations" });
    expect(dash.statusCode).toBe(200);
    const body = dash.json();
    expect(body.summary.donationCount).toBeGreaterThanOrEqual(1);
    expect(body.donations.some((d: { address: string }) => d.address === address)).toBe(true);
  });

  it("simulates sub-threshold amounts as Lightning e-cash, not quarantine", async () => {
    const sim = await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 50_000 },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().rail).toBe("lightning");

    const dash = await harbor.app.inject({ method: "GET", url: "/api/donations" });
    const body = dash.json();
    expect(body.summary.ecashSats).toBe(50_000);
    expect(body.summary.quarantinedSats).toBe(0);
    expect(body.donations[0].rail).toBe("lightning");
    expect(body.donations[0].status).toBe("confirmed");
  });

  it("still quarantines under-threshold on-chain when address is forced", async () => {
    const issue = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    const { address } = issue.json();

    const sim = await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { address, amountSats: 12_000, confirmations: 1 },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().rail).toBe("onchain");

    const donations = listDonations(harbor.db);
    const dust = donations.find((d) => d.address === address);
    expect(dust?.status).toBe("quarantined");
  });

  it("exports CSV and registry", async () => {
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000, confirmations: 1 },
    });
    const csv = await harbor.app.inject({ method: "GET", url: "/api/donations/export.csv" });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("amount_sats");

    const reg = await harbor.app.inject({ method: "GET", url: "/api/registry/export" });
    expect(reg.json().addresses.length).toBeGreaterThanOrEqual(1);
  });

  it("resets demo ledger and registry when demo tools are enabled", async () => {
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000, confirmations: 1 },
    });
    expect(listDonations(harbor.db).length).toBeGreaterThanOrEqual(1);

    const reset = await harbor.app.inject({ method: "POST", url: "/api/demo/reset" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().ok).toBe(true);
    expect(reset.json().message).toMatch(/Demo ledger and address registry cleared/i);
    expect(listDonations(harbor.db)).toHaveLength(0);

    const reg = await harbor.app.inject({ method: "GET", url: "/api/registry/export" });
    expect(reg.json().addresses).toHaveLength(0);
    expect(reset.json().settings.walletConnected).toBe(false);
    expect(reset.json().settings.thresholdSats).toBe(500_000);
  });

  it("exposes network on health", async () => {
    const health = await harbor.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().network).toBe("mock");
    expect(health.json().demoTools).toBe(true);
  });

  it("rejects legacy account-key writes instead of bypassing wallet verification", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const put = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB, thresholdSats: 123_456 },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().code).toBe("verified_wallet_save_required");

    const get = await harbor.app.inject({ method: "GET", url: "/api/settings" });
    expect(get.json().accountXpub).toBeNull();
    expect(get.json().walletConnected).toBe(false);
    expect(get.json().thresholdSats).toBe(500_000);

    const clear = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: null, resetAddresses: true },
    });
    expect(clear.statusCode).toBe(400);
    expect(clear.json().code).toBe("verified_wallet_save_required");
  });

  it("previews xpub addresses without persisting", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const preview = await harbor.app.inject({
      method: "POST",
      url: "/api/settings/xpub/preview",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body.ok).toBe(true);
    expect(body.previewAddresses).toHaveLength(3);
    expect(body.previewAddresses[0]).toMatch(/^bcrt1p/);
    expect(body.normalized).toBe(DEMO_ACCOUNT_XPUB);

    const settings = await harbor.app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json().accountXpub).toBeNull();
    expect(settings.json().usingDemoXpub).toBe(true);

    const bad = await harbor.app.inject({
      method: "POST",
      url: "/api/settings/xpub/preview",
      payload: { accountXpub: "not-an-xpub" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("preserves addresses and donations when reconnecting the same wallet through another source", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const accountCandidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const initialPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: accountCandidate,
    });
    const initialSave = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...accountCandidate,
        verification: {
          method: "addresses",
          addresses: initialPreview.json().previewAddresses,
        },
      },
    });
    expect(initialSave.statusCode).toBe(200);

    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000, confirmations: 1 },
    });
    const beforeReg = (
      await harbor.app.inject({ method: "GET", url: "/api/registry/export" })
    ).json().addresses;
    const beforeDonations = listDonations(harbor.db);
    expect(beforeReg.length).toBeGreaterThanOrEqual(1);
    expect(beforeDonations.length).toBeGreaterThanOrEqual(1);

    const { descriptorFromAccountPublicKey } = await import("./bitcoin/descriptor.js");
    const importCandidate = {
      source: "import",
      descriptor: descriptorFromAccountPublicKey({
        accountPublicKey: DEMO_ACCOUNT_XPUB,
        fingerprint: "73c5da0a",
      }),
    };
    const reconnectPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: importCandidate,
    });
    expect(reconnectPreview.json().walletChange).toBe(false);
    const reconnect = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...importCandidate,
        verification: {
          method: "addresses",
          addresses: reconnectPreview.json().previewAddresses,
        },
      },
    });
    expect(reconnect.statusCode).toBe(200);
    expect(reconnect.json().walletSource).toBe("import");

    const afterReg = (
      await harbor.app.inject({ method: "GET", url: "/api/registry/export" })
    ).json().addresses;
    expect(afterReg).toHaveLength(beforeReg.length);
    expect(listDonations(harbor.db)).toHaveLength(beforeDonations.length);
  });

  it("requires confirmation before atomically replacing a wallet and clearing history", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const OTHER_XPUB =
      "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
    const currentCandidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const currentPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: currentCandidate,
    });
    await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...currentCandidate,
        verification: {
          method: "addresses",
          addresses: currentPreview.json().previewAddresses,
        },
      },
    });
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 750_000, confirmations: 1 },
    });
    const beforeAddresses = (
      await harbor.app.inject({ method: "GET", url: "/api/registry/export" })
    ).json().addresses;
    const beforeDonations = listDonations(harbor.db);
    expect(beforeAddresses.length).toBeGreaterThanOrEqual(1);
    expect(beforeDonations.length).toBeGreaterThanOrEqual(1);

    const replacementCandidate = {
      source: "advanced",
      accountPublicKey: OTHER_XPUB,
      fingerprint: "00000000",
      accountPath: "m/86'/1'/0'",
    };
    const replacementPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: replacementCandidate,
    });
    expect(replacementPreview.json().walletChange).toBe(true);
    const unconfirmed = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...replacementCandidate,
        verification: {
          method: "addresses",
          addresses: replacementPreview.json().previewAddresses,
        },
      },
    });
    expect(unconfirmed.statusCode).toBe(409);
    expect(unconfirmed.json().code).toBe("wallet_change_confirmation_required");
    expect(
      (await harbor.app.inject({ method: "GET", url: "/api/registry/export" })).json().addresses,
    ).toHaveLength(beforeAddresses.length);
    expect(listDonations(harbor.db)).toHaveLength(beforeDonations.length);

    const confirmed = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...replacementCandidate,
        verification: {
          method: "addresses",
          addresses: replacementPreview.json().previewAddresses,
        },
        confirmWalletChange: true,
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().accountXpub).toBe(OTHER_XPUB);
    expect(
      (await harbor.app.inject({ method: "GET", url: "/api/registry/export" })).json().addresses,
    ).toHaveLength(0);
    expect(listDonations(harbor.db)).toHaveLength(0);
  });

  it("rolls back history deletion when replacement wallet persistence fails", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const OTHER_XPUB =
      "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
    const currentCandidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const currentPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: currentCandidate,
    });
    await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...currentCandidate,
        verification: {
          method: "addresses",
          addresses: currentPreview.json().previewAddresses,
        },
      },
    });
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 750_000, confirmations: 1 },
    });
    const beforeAddresses = (
      await harbor.app.inject({ method: "GET", url: "/api/registry/export" })
    ).json().addresses;
    const beforeDonations = listDonations(harbor.db);

    harbor.db.exec(`
      CREATE TRIGGER fail_wallet_descriptor_update
      BEFORE UPDATE ON settings
      WHEN OLD.key = 'wallet_descriptor'
      BEGIN
        SELECT RAISE(ABORT, 'forced wallet persistence failure');
      END;
    `);
    const replacementCandidate = {
      source: "advanced",
      accountPublicKey: OTHER_XPUB,
      fingerprint: "00000000",
      accountPath: "m/86'/1'/0'",
    };
    const replacementPreview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: replacementCandidate,
    });
    const failed = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...replacementCandidate,
        verification: {
          method: "addresses",
          addresses: replacementPreview.json().previewAddresses,
        },
        confirmWalletChange: true,
      },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error).toMatch(/forced wallet persistence failure/);
    expect(
      (await harbor.app.inject({ method: "GET", url: "/api/registry/export" })).json().addresses,
    ).toHaveLength(beforeAddresses.length);
    expect(listDonations(harbor.db)).toHaveLength(beforeDonations.length);
    expect((await harbor.app.inject({ method: "GET", url: "/api/settings" })).json().accountXpub)
      .toBe(DEMO_ACCOUNT_XPUB);
  });

  it("previews and saves a wallet through the descriptor API without trusting client addresses", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const candidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const preview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: candidate,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().previewAddresses).toHaveLength(3);

    const before = await harbor.app.inject({ method: "GET", url: "/api/settings" });
    expect(before.json().walletConnected).toBe(false);
    expect(before.json().accountXpub).toBeNull();

    const rejected = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...candidate,
        verification: { method: "addresses", addresses: ["client-made-address"] },
      },
    });
    expect(rejected.statusCode).toBe(400);

    const saved = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...candidate,
        verification: {
          method: "addresses",
          addresses: preview.json().previewAddresses,
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().walletConnected).toBe(true);
    expect(saved.json().walletSource).toBe("advanced");
    expect(saved.json()).not.toHaveProperty("walletDescriptor");
  });
});

describe("slice three signet wiring", () => {
  let dbPath: string;
  let harbor: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `harbor-signet-${Date.now()}-${Math.random()}.db`);
    const { EsploraBitcoinRpc } = await import("./bitcoin/esplora.js");
    const { MockRateProvider } = await import("./services/detection.js");
    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/api",
      getWatchedAddresses: () => [],
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => 1,
          text: async () => "1",
        }) as Response) as typeof fetch,
    });
    harbor = await createApp({
      dbPath,
      rpc,
      network: "signet",
      rateProvider: new MockRateProvider(115_000),
      listen: false,
    });
    await harbor.app.ready();
  });

  afterEach(async () => {
    await harbor.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("blocks on-chain issuance until a verified organization wallet is connected", async () => {
    const health = await harbor.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().network).toBe("signet");
    expect(health.json().demoTools).toBe(false);

    const blocked = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/Connect your organization wallet/i);

    // Lightning preview still works without an org xpub.
    const ln = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 40_000 },
    });
    expect(ln.statusCode).toBe(200);
    expect(ln.json().rail).toBe("lightning");

    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const candidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const preview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: candidate,
    });
    const save = await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...candidate,
        verification: {
          method: "addresses",
          addresses: preview.json().previewAddresses,
        },
      },
    });
    expect(save.statusCode).toBe(200);

    const issue = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(issue.statusCode).toBe(200);
    expect(issue.json().address).toMatch(/^tb1p/);

    const sim = await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000 },
    });
    expect(sim.statusCode).toBe(403);

    const reset = await harbor.app.inject({ method: "POST", url: "/api/demo/reset" });
    expect(reset.statusCode).toBe(403);
    expect(reset.json().error).toMatch(/Demo reset is disabled/i);
  });

  it.each(["trezor", "ledger"] as const)(
    "requires device verification and the exact server address for %s",
    async (source) => {
      const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
      const candidate = {
        source,
        accountPublicKey: DEMO_ACCOUNT_XPUB,
        fingerprint: "73c5da0a",
        accountPath: "m/86'/1'/0'",
      };
      const preview = await harbor.app.inject({
        method: "POST",
        url: "/api/wallet/preview",
        payload: candidate,
      });
      expect(preview.statusCode).toBe(200);

      const missing = await harbor.app.inject({
        method: "PUT",
        url: "/api/wallet",
        payload: candidate,
      });
      expect(missing.statusCode).toBe(400);

      const manual = await harbor.app.inject({
        method: "PUT",
        url: "/api/wallet",
        payload: {
          ...candidate,
          verification: {
            method: "addresses",
            addresses: preview.json().previewAddresses,
          },
        },
      });
      expect(manual.statusCode).toBe(400);

      const wrongAddress = await harbor.app.inject({
        method: "PUT",
        url: "/api/wallet",
        payload: {
          ...candidate,
          verification: { method: "device", addresses: ["tb1pwrong"] },
        },
      });
      expect(wrongAddress.statusCode).toBe(400);

      const verified = await harbor.app.inject({
        method: "PUT",
        url: "/api/wallet",
        payload: {
          ...candidate,
          verification: {
            method: "device",
            addresses: [preview.json().previewAddresses[0]],
          },
        },
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json().walletSource).toBe(source);
    },
  );
});

describe("slice 3B Testnet4 wiring", () => {
  let dbPath: string;
  let harbor: Awaited<ReturnType<typeof createApp>>;

  afterEach(async () => {
    await harbor.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("gates issuance and detects a fixture payment from pending to confirmed", async () => {
    dbPath = path.join(os.tmpdir(), `harbor-testnet4-${Date.now()}-${Math.random()}.db`);
    let txs: unknown[] = [];
    const fetchImpl = async (url: string | URL) => {
      const value = String(url);
      if (value.endsWith("/blocks/tip/height")) {
        return {
          ok: true,
          status: 200,
          json: async () => 200,
          text: async () => "200",
        } as Response;
      }
      if (value.includes("/address/")) {
        return {
          ok: true,
          status: 200,
          json: async () => txs,
          text: async () => JSON.stringify(txs),
        } as Response;
      }
      throw new Error(`Unexpected fixture URL ${value}`);
    };
    const { EsploraBitcoinRpc } = await import("./bitcoin/esplora.js");
    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/testnet4/api",
      chain: "testnet4",
      getWatchedAddresses: () =>
        harbor ? getActiveIssuedAddresses(harbor.db).map((address) => address.address) : [],
      fetchImpl: fetchImpl as typeof fetch,
    });
    const rate = new MockRateProvider(100_000);
    harbor = await createApp({
      dbPath,
      rpc,
      network: "testnet4",
      rateProvider: rate,
      listen: false,
    });
    await harbor.app.ready();

    const health = await harbor.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({
      network: "testnet4",
      chain: "testnet4",
      demoTools: false,
    });

    const blocked = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("wallet_required");

    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const candidate = {
      source: "advanced",
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: "73c5da0a",
      accountPath: "m/86'/1'/0'",
    };
    const preview = await harbor.app.inject({
      method: "POST",
      url: "/api/wallet/preview",
      payload: candidate,
    });
    await harbor.app.inject({
      method: "PUT",
      url: "/api/wallet",
      payload: {
        ...candidate,
        verification: { method: "addresses", addresses: preview.json().previewAddresses },
      },
    });

    const issue = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(issue.statusCode).toBe(200);
    const address = issue.json().address as string;
    expect(address).toMatch(/^tb1p/);

    const txid = "44".repeat(32);
    txs = [
      {
        txid,
        vout: [{ scriptpubkey_address: address, value: 750_000 }],
        status: { confirmed: false },
      },
    ];
    await pollOnce(harbor.db, rpc, rate);
    expect(listDonations(harbor.db)[0]).toMatchObject({
      txid,
      status: "pending",
      confirmations: 0,
      fiatUsdAtReceipt: 750,
    });

    txs = [
      {
        txid,
        vout: [{ scriptpubkey_address: address, value: 750_000 }],
        status: { confirmed: true, block_height: 200 },
      },
    ];
    await pollOnce(harbor.db, rpc, rate);
    expect(listDonations(harbor.db)[0]).toMatchObject({
      status: "confirmed",
      confirmations: 1,
      fiatUsdAtReceipt: 750,
    });

    const reset = await harbor.app.inject({ method: "POST", url: "/api/demo/reset" });
    expect(reset.statusCode).toBe(403);
    expect(reset.json().error).toMatch(/Demo reset is disabled/i);
    expect(listDonations(harbor.db)).toHaveLength(1);
  });
});

describe("slice two static serving", () => {
  let dbPath: string;
  let webDist: string;
  let harbor: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `harbor-static-${Date.now()}-${Math.random()}.db`);
    webDist = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-web-"));
    fs.writeFileSync(
      path.join(webDist, "index.html"),
      "<!doctype html><html><body><div id='root'>Harbor SPA</div></body></html>",
    );
    harbor = await createApp({
      dbPath,
      rpc: new MockBitcoinRpc(),
      listen: false,
      serveWeb: true,
      webDist,
    });
    await harbor.app.ready();
  });

  afterEach(async () => {
    await harbor.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
    fs.rmSync(webDist, { recursive: true, force: true });
  });

  it("serves index.html for SPA routes and keeps /api working", async () => {
    const home = await harbor.app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Harbor SPA");

    const donate = await harbor.app.inject({ method: "GET", url: "/donate" });
    expect(donate.statusCode).toBe(200);
    expect(donate.body).toContain("Harbor SPA");

    const health = await harbor.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const missingApi = await harbor.app.inject({ method: "GET", url: "/api/nope" });
    expect(missingApi.statusCode).toBe(404);
  });
});
