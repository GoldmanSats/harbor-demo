import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/schema.js";
import {
  donationSummary,
  getSettings,
  listDonations,
  listIssuedAddresses,
  resetDemoData,
  setThreshold,
} from "../db/schema.js";
import { buildBitcoinUri } from "../bitcoin/derivation.js";
import { issueAddress } from "../services/issuance.js";
import type { BitcoinRpc } from "../bitcoin/rpc.js";
import type { RateProvider } from "../services/detection.js";
import { pollOnce } from "../services/detection.js";
import { DEFAULT_THRESHOLD_SATS } from "../config.js";

const amountSchema = z.object({
  amountSats: z.number().int().positive(),
});

const thresholdSchema = z.object({
  thresholdSats: z.number().int().positive(),
});

const simulateSchema = z.object({
  amountSats: z.number().int().positive().optional(),
  address: z.string().optional(),
  confirmations: z.number().int().min(0).max(100).optional(),
});

export type AppDeps = {
  db: Db;
  rpc: BitcoinRpc;
  rateProvider: RateProvider;
  accountXpub: string;
};

export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, rpc, rateProvider, accountXpub } = deps;

  app.get("/api/health", async () => {
    const info = await rpc.getBlockchainInfo();
    return {
      ok: true,
      bitcoin: rpc.kind,
      chain: info.chain,
      blocks: info.blocks,
    };
  });

  app.get("/api/settings", async () => getSettings(db));

  app.put("/api/settings", async (req, reply) => {
    const parsed = thresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid thresholdSats" });
    }
    return setThreshold(db, parsed.data.thresholdSats);
  });

  app.post("/api/donate/address", async (req, reply) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "amountSats must be a positive integer" });
    }
    const { amountSats } = parsed.data;
    const settings = getSettings(db);
    const threshold = settings.thresholdSats || DEFAULT_THRESHOLD_SATS;

    if (amountSats < threshold) {
      return {
        rail: "lightning" as const,
        preview: true,
        amountSats,
        thresholdSats: threshold,
        offer:
          "lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqqqqqqqpreviewharbor",
        message:
          "Lightning / e-cash rail (preview). In production this settles into the org's federation wallet.",
      };
    }

    const { address, recycled } = issueAddress(db, { accountXpub, rpc });
    const uri = buildBitcoinUri(address.address, amountSats);
    return {
      rail: "onchain" as const,
      preview: false,
      amountSats,
      thresholdSats: threshold,
      address: address.address,
      derivationIndex: address.derivationIndex,
      expiresAt: address.expiresAt,
      recycled,
      uri,
    };
  });

  app.get("/api/donations", async () => {
    const donations = listDonations(db);
    const summary = donationSummary(db);
    return { donations, summary, settings: getSettings(db) };
  });

  app.get("/api/donations/export.csv", async (_req, reply) => {
    const donations = listDonations(db);
    const header =
      "id,txid,vout,address,amount_sats,confirmations,fiat_usd_at_receipt,status,first_seen_at,rail";
    const lines = donations.map((d) =>
      [
        d.id,
        d.txid,
        d.vout,
        d.address,
        d.amountSats,
        d.confirmations,
        d.fiatUsdAtReceipt,
        d.status,
        d.firstSeenAt,
        d.rail,
      ].join(","),
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="harbor-donations.csv"');
    return [header, ...lines].join("\n");
  });

  app.get("/api/registry/export", async () => ({
    addresses: listIssuedAddresses(db),
    exportedAt: new Date().toISOString(),
  }));

  app.get("/api/summary", async () => ({
    ...donationSummary(db),
    settings: getSettings(db),
    bitcoin: rpc.kind,
  }));

  /** Dev/demo: pay an address on the simulated chain and mine confirmations. */
  app.post("/api/demo/simulate", async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid simulate payload" });
    }
    const amountSats =
      parsed.data.amountSats ??
      (Math.random() < 0.5
        ? Math.floor(10_000 + Math.random() * 100_000)
        : Math.floor(500_000 + Math.random() * 2_000_000));
    const confirmations = parsed.data.confirmations ?? 1;

    let address = parsed.data.address;
    if (!address) {
      const issued = issueAddress(db, { accountXpub, rpc });
      address = issued.address.address;
    }

    const amountBtc = amountSats / 1e8;
    const txid = await rpc.sendToAddress(address, amountBtc);
    if (confirmations > 0) {
      const sink = await rpc.getNewAddress("mining");
      await rpc.generateToAddress(confirmations, sink);
    }
    await pollOnce(db, rpc, rateProvider);

    return {
      ok: true,
      address,
      amountSats,
      txid,
      confirmations,
    };
  });

  app.post("/api/demo/poll", async () => {
    const result = await pollOnce(db, rpc, rateProvider);
    return { ok: true, ...result };
  });

  /** Shared demo: wipe ledger + registry so visitors can start fresh. */
  app.post("/api/demo/reset", async () => {
    resetDemoData(db);
    return {
      ok: true,
      message: "Demo ledger and address registry cleared.",
      settings: getSettings(db),
    };
  });
}
