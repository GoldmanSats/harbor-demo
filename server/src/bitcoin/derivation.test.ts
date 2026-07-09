import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { NETWORK } from "@scure/btc-signer";
import { buildBitcoinUri, deriveTaprootAddress, isValidAddress } from "./derivation.js";
import { DEMO_ACCOUNT_XPUB } from "../config.js";

/** Official BIP-86 mainnet vectors (account m/86'/0'/0'). */
const BIP86_ACCOUNT_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

describe("BIP-86 derivation vectors", () => {
  it("matches official first receiving address m/86'/0'/0'/0/0", () => {
    const addr = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 0, "mainnet");
    expect(addr).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
  });

  it("matches official second receiving address m/86'/0'/0'/0/1", () => {
    const addr = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 1, "mainnet");
    expect(addr).toBe("bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh");
  });

  it("is deterministic for the same index", () => {
    const a = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 0, "mainnet");
    const b = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 0, "mainnet");
    expect(a).toBe(b);
  });

  it("produces distinct addresses for consecutive indices", () => {
    const a = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 0, "mainnet");
    const b = deriveTaprootAddress(BIP86_ACCOUNT_XPUB, 1, "mainnet");
    expect(a).not.toBe(b);
  });
});

describe("regtest demo xpub", () => {
  it("DEMO_ACCOUNT_XPUB matches abandon mnemonic m/86'/1'/0'", async () => {
    const seed = await bip39.mnemonicToSeed(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    const root = HDKey.fromMasterSeed(seed);
    const acct = root.derive("m/86'/1'/0'");
    expect(acct.publicExtendedKey).toBe(DEMO_ACCOUNT_XPUB);
  });

  it("derives a valid bcrt1p address", () => {
    const addr = deriveTaprootAddress(DEMO_ACCOUNT_XPUB, 0, "regtest");
    expect(addr.startsWith("bcrt1p")).toBe(true);
    expect(isValidAddress(addr, "regtest")).toBe(true);
  });
});

describe("buildBitcoinUri", () => {
  it("includes amount in BTC without trailing zeros noise", () => {
    const uri = buildBitcoinUri("bcrt1ptest", 500_000);
    expect(uri).toBe("bitcoin:bcrt1ptest?amount=0.005");
  });

  it("omits amount when not provided", () => {
    expect(buildBitcoinUri("bcrt1ptest")).toBe("bitcoin:bcrt1ptest");
  });
});

describe("NETWORK sanity", () => {
  it("mainnet HRP is bc", () => {
    expect(NETWORK.bech32).toBe("bc");
  });
});
