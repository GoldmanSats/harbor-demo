import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/schema.js";
import {
  clearAddressRegistry,
  donationSummary,
  getSettings,
  insertDonation,
  listDonations,
  listIssuedAddresses,
  resetDemoData,
  setAccountXpub,
  setThreshold,
} from "../db/schema.js";
import {
  buildBitcoinUri,
  derivationNetworkFor,
  validateAccountXpub,
} from "../bitcoin/derivation.js";
import { issueAddress } from "../services/issuance.js";
import type { BitcoinRpc } from "../bitcoin/rpc.js";
import type { RateProvider } from "../services/detection.js";
import { pollOnce } from "../services/detection.js";
import {
  DEFAULT_THRESHOLD_SATS,
  DEMO_ACCOUNT_XPUB,
  type HarborNetwork,
} from "../config.js";
import { randomBytes } from "node:crypto";

const amountSchema = z.object({
  amountSats: z.number().int().positive(),
});

const settingsPutSchema = z
  .object({
    thresholdSats: z.number().int().positive().optional(),
    accountXpub: z.string().nullable().optional(),
    resetAddresses: z.boolean().optional(),
  })
  .refine((b) => b.thresholdSats !== undefined || b.accountXpub !== undefined, {
    message: "Provide thresholdSats and/or accountXpub",
  });

const xpubPreviewSchema = z.object({
  accountXpub: z.string().min(1),
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
  /** Env / demo fallback when settings.accountXpub is unset. */
  defaultAccountXpub: string;
  network: HarborNetwork;
};

function resolveAccountXpub(db: Db, defaultXpub: string): string {
  return getSettings(db).accountXpub ?? defaultXpub;
}

function settingsResponse(
  db: Db,
  network: HarborNetwork,
  defaultXpub: string,
) {
  const settings = getSettings(db);
  const activeXpub = settings.accountXpub ?? defaultXpub;
  const derivationNetwork = derivationNetworkFor(network);
  let previewAddresses: string[] = [];
  try {
    previewAddresses = validateAccountXpub(activeXpub, derivationNetwork, 3).previewAddresses;
  } catch {
    previewAddresses = [];
  }
  return {
    ...settings,
    network,
    usingDemoXpub: !settings.accountXpub,
    previewAddresses,
  };
}

export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, rpc, rateProvider, defaultAccountXpub, network } = deps;
  const derivationNetwork = derivationNetworkFor(network);
  const demoToolsEnabled = network !== "signet" && rpc.kind !== "esplora";

  app.get("/api/health", async () => {
    const info = await rpc.getBlockchainInfo();
    return {
      ok: true,
      bitcoin: rpc.kind,
      network,
      chain: info.chain,
      blocks: info.blocks,
      demoTools: demoToolsEnabled,
    };
  });

  app.get("/api/settings", async () => settingsResponse(db, network, defaultAccountXpub));

  /** Validate an xpub and return the first 3 receive addresses without persisting. */
  app.post("/api/settings/xpub/preview", async (req, reply) => {
    const parsed = xpubPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "accountXpub is required" });
    }
    try {
      const validated = validateAccountXpub(parsed.data.accountXpub, derivationNetwork, 3);
      return {
        ok: true,
        normalized: validated.normalized,
        depth: validated.depth,
        previewAddresses: validated.previewAddresses,
        network,
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.put("/api/settings", async (req, reply) => {
    const parsed = settingsPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    }

    if (parsed.data.thresholdSats !== undefined) {
      setThreshold(db, parsed.data.thresholdSats);
    }

    if (parsed.data.accountXpub !== undefined) {
      const next = parsed.data.accountXpub;
      if (next === null || next.trim() === "") {
        setAccountXpub(db, null);
        if (parsed.data.resetAddresses !== false) clearAddressRegistry(db, true);
      } else {
        let validated;
        try {
          validated = validateAccountXpub(next, derivationNetwork, 3);
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }
        const prev = getSettings(db).accountXpub;
        const changed = prev !== validated.normalized;
        setAccountXpub(db, validated.normalized);
        // Reset only when the normalized key actually changes (never on same-xpub re-save,
        // even if the client sends resetAddresses: true).
        if (changed && (prev !== null || listIssuedAddresses(db).length > 0)) {
          clearAddressRegistry(db, true);
        }
      }
    }

    return settingsResponse(db, network, defaultAccountXpub);
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

    if (network === "signet" && !settings.accountXpub) {
      return reply.code(409).send({
        error:
          "Connect your organization wallet xpub on the dashboard before issuing signet donation addresses.",
      });
    }

    const accountXpub = resolveAccountXpub(db, defaultAccountXpub);
    const { address, recycled } = issueAddress(db, {
      accountXpub,
      rpc,
      network,
    });
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
    return {
      donations,
      summary,
      settings: settingsResponse(db, network, defaultAccountXpub),
    };
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
    settings: settingsResponse(db, network, defaultAccountXpub),
    bitcoin: rpc.kind,
    network,
  }));

  /** Dev/demo: simulate a donation on the rail the amount would actually use. */
  app.post("/api/demo/simulate", async (req, reply) => {
    if (!demoToolsEnabled) {
      return reply.code(403).send({ error: "Simulate is disabled on signet" });
    }
    const parsed = simulateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid simulate payload" });
    }
    const settings = getSettings(db);
    const threshold = settings.thresholdSats || DEFAULT_THRESHOLD_SATS;
    const amountSats =
      parsed.data.amountSats ??
      (Math.random() < 0.5
        ? Math.floor(10_000 + Math.random() * 100_000)
        : Math.floor(500_000 + Math.random() * 2_000_000));
    const confirmations = parsed.data.confirmations ?? 1;

    // Explicit address forces on-chain (used to demo dust quarantine).
    // Otherwise follow the same threshold routing as the donor page.
    const forceOnchain = Boolean(parsed.data.address);
    const useLightning = !forceOnchain && amountSats < threshold;

    if (useLightning) {
      const paymentHash = randomBytes(32).toString("hex");
      const fiat = Number(((amountSats / 1e8) * rateProvider.getBtcUsd()).toFixed(2));
      insertDonation(db, {
        txid: paymentHash,
        vout: 0,
        address: "lightning:preview",
        amountSats,
        confirmations: 1,
        fiatUsdAtReceipt: fiat,
        status: "confirmed",
        firstSeenAt: new Date().toISOString(),
        rail: "lightning",
      });
      return {
        ok: true,
        rail: "lightning" as const,
        amountSats,
        txid: paymentHash,
        address: "lightning:preview",
        confirmations: 1,
        message: "Simulated Lightning settlement into the org e-cash wallet (preview).",
      };
    }

    let address = parsed.data.address;
    if (!address) {
      const issued = issueAddress(db, {
        accountXpub: resolveAccountXpub(db, defaultAccountXpub),
        rpc,
        network,
      });
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
      rail: "onchain" as const,
      address,
      amountSats,
      txid,
      confirmations,
    };
  });

  app.post("/api/demo/poll", async (_req, reply) => {
    if (!demoToolsEnabled) {
      return reply.code(403).send({ error: "Demo poll is disabled on signet" });
    }
    const result = await pollOnce(db, rpc, rateProvider);
    return { ok: true, ...result };
  });

  /** Wipe ledger + registry so visitors / orgs can start fresh. */
  app.post("/api/demo/reset", async () => {
    resetDemoData(db);
    return {
      ok: true,
      message:
        network === "signet"
          ? "Ledger and address registry cleared."
          : "Demo ledger and address registry cleared.",
      settings: settingsResponse(db, network, defaultAccountXpub),
    };
  });
}

export { DEMO_ACCOUNT_XPUB };
