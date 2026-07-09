import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2";
import * as bip39 from "@scure/bip39";
import {
  deriveTaprootAddress,
  isValidAddress,
  normalizeAccountXpub,
  validateAccountXpub,
} from "./derivation.js";
import { DEMO_ACCOUNT_XPUB } from "../config.js";

const b58c = base58check(sha256);
const TPUB_VER = new Uint8Array([0x04, 0x35, 0x87, 0xcf]);
const VPUB_VER = new Uint8Array([0x04, 0x5f, 0x1c, 0xf6]);

function reencode(ext: string, ver: Uint8Array): string {
  const d = new Uint8Array(b58c.decode(ext));
  d.set(ver, 0);
  return b58c.encode(d);
}

describe("signet / tpub / vpub derivation", () => {
  const expected0 = "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj";
  const expected1 = "tb1p90h6z3p36n9hrzy7580h5l429uwchyg8uc9sz4jwzhdtuhqdl5eqmpwq6n";
  const expected2 = "tb1p40qqa84kpphe5vtcwd8zv7v6w7p62cmupf6f60mf8pxdkcv2455q9jyrjg";

  it("derives tb1p addresses on signet from DEMO_ACCOUNT_XPUB", () => {
    const addr = deriveTaprootAddress(DEMO_ACCOUNT_XPUB, 0, "signet");
    expect(addr).toBe(expected0);
    expect(addr.startsWith("tb1p")).toBe(true);
    expect(isValidAddress(addr, "signet")).toBe(true);
  });

  it("accepts tpub and vpub with identical key material", () => {
    const tpub = reencode(DEMO_ACCOUNT_XPUB, TPUB_VER);
    const vpub = reencode(DEMO_ACCOUNT_XPUB, VPUB_VER);
    expect(tpub.startsWith("tpub")).toBe(true);
    expect(vpub.startsWith("vpub")).toBe(true);
    expect(deriveTaprootAddress(tpub, 0, "signet")).toBe(expected0);
    expect(deriveTaprootAddress(vpub, 0, "signet")).toBe(expected0);
    expect(normalizeAccountXpub(tpub)).toBe(DEMO_ACCOUNT_XPUB);
    expect(normalizeAccountXpub(vpub)).toBe(DEMO_ACCOUNT_XPUB);
  });

  it("validateAccountXpub returns first 3 addresses", () => {
    const tpub = reencode(DEMO_ACCOUNT_XPUB, TPUB_VER);
    const result = validateAccountXpub(tpub, "signet", 3);
    expect(result.depth).toBe(3);
    expect(result.previewAddresses).toEqual([expected0, expected1, expected2]);
  });

  it("rejects non-account-level keys", async () => {
    const seed = await bip39.mnemonicToSeed(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    const root = HDKey.fromMasterSeed(seed);
    const child = root.derive("m/86'/1'/0'/0");
    expect(() => validateAccountXpub(child.publicExtendedKey, "signet")).toThrow(/depth/);
  });
});
