import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/schema.js";
import {
  donationSummary,
  getSettings,
  insertDonation,
  listDonations,
  listIssuedAddresses,
  replaceWalletAndClearHistory,
  resetDemoData,
  saveWallet,
  setThreshold,
} from "../db/schema.js";
import {
  buildBitcoinUri,
  derivationNetworkFor,
} from "../bitcoin/derivation.js";
import {
  descriptorFromAccountPublicKey,
  descriptorIdentity,
  validateWalletCandidate,
  type ValidatedWallet,
  type WalletCandidate,
} from "../bitcoin/descriptor.js";
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

const walletSourceSchema = z.enum(["trezor", "ledger", "import", "advanced", "legacy"]);
const walletCandidateShape = {
  descriptor: z.string().min(1).optional(),
  changeDescriptor: z.string().min(1).optional(),
  accountPublicKey: z.string().min(1).optional(),
  changeAccountPublicKey: z.string().min(1).optional(),
  fingerprint: z.string().optional(),
  accountPath: z.string().optional(),
  source: walletSourceSchema.optional(),
};
const walletPreviewSchema = z
  .object(walletCandidateShape)
  .refine((body) => Boolean(body.descriptor || body.accountPublicKey), {
    message: "Provide a descriptor or account public key",
  });
const walletSaveSchema = z
  .object({
    ...walletCandidateShape,
    verification: z.object({
      method: z.enum(["device", "addresses"]),
      addresses: z.array(z.string()).min(1).max(3),
    }),
    confirmWalletChange: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.descriptor || body.accountPublicKey), {
    message: "Provide a descriptor or account public key",
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

function defaultReceiveDescriptor(defaultXpub: string): string {
  return descriptorFromAccountPublicKey({ accountPublicKey: defaultXpub });
}

function resolveReceiveDescriptor(db: Db, defaultXpub: string): string {
  return getSettings(db).walletDescriptor ?? defaultReceiveDescriptor(defaultXpub);
}

function isPublicNetwork(network: HarborNetwork): boolean {
  return network === "signet" || network === "testnet4";
}

function validateCandidateForSource(candidate: WalletCandidate, network: HarborNetwork): void {
  if (
    (candidate.source === "trezor" || candidate.source === "ledger") &&
    (!candidate.accountPublicKey || !candidate.fingerprint || !candidate.accountPath)
  ) {
    throw new Error("Hardware-wallet account details are incomplete");
  }
  if (
    (candidate.source === "trezor" || candidate.source === "ledger") &&
    !isPublicNetwork(network)
  ) {
    throw new Error("Direct hardware-wallet connection is available only on Signet and Testnet4");
  }
}

function walletWouldReplace(
  db: Db,
  wallet: ValidatedWallet,
  defaultXpub: string,
): boolean {
  const activeDescriptor = resolveReceiveDescriptor(db, defaultXpub);
  return descriptorIdentity(activeDescriptor) !== wallet.identity;
}

function hasWalletLedgerData(db: Db): boolean {
  return listIssuedAddresses(db).length > 0 || listDonations(db).length > 0;
}

function validateVerification(
  wallet: ValidatedWallet,
  verification: { method: "device" | "addresses"; addresses: string[] },
): void {
  const direct = wallet.source === "trezor" || wallet.source === "ledger";
  if (direct) {
    if (
      verification.method !== "device" ||
      verification.addresses.length !== 1 ||
      verification.addresses[0] !== wallet.previewAddresses[0]
    ) {
      throw new Error("Confirm receive address 0 on the hardware wallet before saving");
    }
    return;
  }
  if (
    verification.method !== "addresses" ||
    verification.addresses.length !== wallet.previewAddresses.length ||
    verification.addresses.some((address, index) => address !== wallet.previewAddresses[index])
  ) {
    throw new Error("Confirm all three preview addresses before saving");
  }
}

function settingsResponse(
  db: Db,
  network: HarborNetwork,
  defaultXpub: string,
) {
  const settings = getSettings(db);
  const derivationNetwork = derivationNetworkFor(network);
  let previewAddresses: string[] = [];
  try {
    previewAddresses = validateWalletCandidate(
      {
        descriptor: settings.walletDescriptor ?? defaultReceiveDescriptor(defaultXpub),
        source: settings.walletSource ?? "legacy",
      },
      derivationNetwork,
      3,
    ).previewAddresses;
  } catch {
    previewAddresses = [];
  }
  return {
    thresholdSats: settings.thresholdSats,
    btcUsdRate: settings.btcUsdRate,
    // Slice Three compatibility aliases. The standard UI uses walletConnected/source.
    accountXpub: settings.accountXpub,
    network,
    walletConnected: Boolean(settings.walletDescriptor),
    walletSource: settings.walletSource,
    walletFingerprint: settings.walletFingerprint,
    walletAccountPath: settings.walletAccountPath,
    walletConnectedAt: settings.walletConnectedAt,
    usingDemoWallet: !settings.walletDescriptor,
    usingDemoXpub: !settings.walletDescriptor,
    previewAddresses,
  };
}

export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, rpc, rateProvider, defaultAccountXpub, network } = deps;
  const derivationNetwork = derivationNetworkFor(network);
  const demoToolsEnabled = !isPublicNetwork(network) && rpc.kind !== "esplora";

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

  app.post("/api/wallet/preview", async (req, reply) => {
    const parsed = walletPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid wallet" });
    }
    try {
      validateCandidateForSource(parsed.data, network);
      const wallet = validateWalletCandidate(parsed.data, derivationNetwork, 3);
      return {
        ok: true,
        source: wallet.source,
        fingerprint: wallet.fingerprint,
        accountPath: wallet.accountPath,
        previewAddresses: wallet.previewAddresses,
        walletChange: walletWouldReplace(db, wallet, defaultAccountXpub) && hasWalletLedgerData(db),
        network,
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.put("/api/wallet", async (req, reply) => {
    const parsed = walletSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid wallet" });
    }
    try {
      validateCandidateForSource(parsed.data, network);
      const wallet = validateWalletCandidate(parsed.data, derivationNetwork, 3);
      validateVerification(wallet, parsed.data.verification);
      const changed = walletWouldReplace(db, wallet, defaultAccountXpub);
      if (changed && hasWalletLedgerData(db) && parsed.data.confirmWalletChange !== true) {
        return reply.code(409).send({
          error:
            "Connecting this wallet will clear issued addresses and donation history. Confirm the wallet change to continue.",
          code: "wallet_change_confirmation_required",
        });
      }
      if (changed && hasWalletLedgerData(db)) {
        replaceWalletAndClearHistory(db, wallet);
      } else {
        saveWallet(db, wallet);
      }
      return settingsResponse(db, network, defaultAccountXpub);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Validate an xpub and return the first 3 receive addresses without persisting. */
  app.post("/api/settings/xpub/preview", async (req, reply) => {
    const parsed = xpubPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "accountXpub is required" });
    }
    try {
      const validated = validateWalletCandidate(
        { accountPublicKey: parsed.data.accountXpub, source: "advanced" },
        derivationNetwork,
        3,
      );
      return {
        ok: true,
        normalized: validated.accountXpub,
        depth: 3,
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

    if (parsed.data.accountXpub !== undefined) {
      return reply.code(400).send({
        error:
          "Account-key saves require address verification. Preview and save through /api/wallet instead.",
        code: "verified_wallet_save_required",
      });
    }

    if (parsed.data.thresholdSats !== undefined) {
      setThreshold(db, parsed.data.thresholdSats);
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

    if (isPublicNetwork(network) && !settings.walletDescriptor) {
      return reply.code(409).send({
        error: "Connect your organization wallet on the dashboard before issuing donation addresses.",
        code: "wallet_required",
      });
    }

    const { address, recycled } = issueAddress(db, {
      receiveDescriptor: resolveReceiveDescriptor(db, defaultAccountXpub),
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
      return reply.code(403).send({ error: "Simulate is disabled on public test networks" });
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
        receiveDescriptor: resolveReceiveDescriptor(db, defaultAccountXpub),
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
      return reply.code(403).send({ error: "Demo poll is disabled on public test networks" });
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
        isPublicNetwork(network)
          ? "Ledger and address registry cleared."
          : "Demo ledger and address registry cleared.",
      settings: settingsResponse(db, network, defaultAccountXpub),
    };
  });
}

export { DEMO_ACCOUNT_XPUB };
