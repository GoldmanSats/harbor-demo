import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { MockBitcoinRpc } from "./bitcoin/mock-rpc.js";
import { listDonations } from "./db/schema.js";

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

  it("resets demo ledger and registry", async () => {
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000, confirmations: 1 },
    });
    expect(listDonations(harbor.db).length).toBeGreaterThanOrEqual(1);

    const reset = await harbor.app.inject({ method: "POST", url: "/api/demo/reset" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().ok).toBe(true);
    expect(listDonations(harbor.db)).toHaveLength(0);

    const reg = await harbor.app.inject({ method: "GET", url: "/api/registry/export" });
    expect(reg.json().addresses).toHaveLength(0);
  });

  it("exposes network on health", async () => {
    const health = await harbor.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().network).toBe("mock");
    expect(health.json().demoTools).toBe(true);
  });

  it("validates and stores account xpub with preview addresses", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const put = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json();
    expect(body.accountXpub).toBe(DEMO_ACCOUNT_XPUB);
    expect(body.usingDemoXpub).toBe(false);
    expect(body.previewAddresses).toHaveLength(3);
    expect(body.previewAddresses[0]).toMatch(/^bcrt1p/);

    const get = await harbor.app.inject({ method: "GET", url: "/api/settings" });
    expect(get.json().accountXpub).toBe(DEMO_ACCOUNT_XPUB);

    const bad = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: "not-an-xpub" },
    });
    expect(bad.statusCode).toBe(400);
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

  it("does not reset addresses or donations when re-saving the same normalized xpub", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    const { base58check } = await import("@scure/base");
    const { sha256 } = await import("@noble/hashes/sha2");
    const b58c = base58check(sha256);
    const tpubVer = new Uint8Array([0x04, 0x35, 0x87, 0xcf]);
    const decoded = new Uint8Array(b58c.decode(DEMO_ACCOUNT_XPUB));
    decoded.set(tpubVer, 0);
    const tpub = b58c.encode(decoded);

    await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB },
    });
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

    // Re-save same key as tpub + resetAddresses:true — must not wipe.
    const resave = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: tpub, resetAddresses: true },
    });
    expect(resave.statusCode).toBe(200);
    expect(resave.json().accountXpub).toBe(DEMO_ACCOUNT_XPUB);

    const afterReg = (
      await harbor.app.inject({ method: "GET", url: "/api/registry/export" })
    ).json().addresses;
    expect(afterReg).toHaveLength(beforeReg.length);
    expect(listDonations(harbor.db)).toHaveLength(beforeDonations.length);
  });

  it("changing to a different xpub clears issued addresses and donations", async () => {
    const { DEMO_ACCOUNT_XPUB } = await import("./config.js");
    // Distinct BIP-86 account (abandon mnemonic, coin_type 0') — different key material.
    const OTHER_XPUB =
      "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

    await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB },
    });
    await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(
      (await harbor.app.inject({ method: "GET", url: "/api/registry/export" })).json().addresses
        .length,
    ).toBeGreaterThanOrEqual(1);

    const change = await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: OTHER_XPUB },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().accountXpub).toBe(OTHER_XPUB);
    expect(
      (await harbor.app.inject({ method: "GET", url: "/api/registry/export" })).json().addresses,
    ).toHaveLength(0);
    expect(listDonations(harbor.db)).toHaveLength(0);
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

  it("blocks on-chain issuance until org xpub is connected", async () => {
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
    await harbor.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { accountXpub: DEMO_ACCOUNT_XPUB },
    });

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
