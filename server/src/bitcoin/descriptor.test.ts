import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2";
import { checksum } from "@bitcoinerlab/descriptors";
import { DEMO_ACCOUNT_XPUB } from "../config.js";
import {
  accountXpubFromDescriptor,
  deriveDescriptorAddress,
  descriptorFromAccountPublicKey,
  descriptorIdentity,
  validateWalletCandidate,
} from "./descriptor.js";

const FINGERPRINT = "73c5da0a";
const OTHER_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

function withVersion(xpub: string, version: Uint8Array): string {
  const codec = base58check(sha256);
  const decoded = new Uint8Array(codec.decode(xpub));
  decoded.set(version, 0);
  return codec.encode(decoded);
}

describe("canonical BIP-86 descriptors", () => {
  it("adds a valid BIP-380 checksum and derives preview addresses", () => {
    const wallet = validateWalletCandidate(
      {
        accountPublicKey: DEMO_ACCOUNT_XPUB,
        fingerprint: FINGERPRINT,
        accountPath: "m/86'/1'/0'",
        source: "trezor",
      },
      "testnet4",
    );
    const [body, actualChecksum] = wallet.descriptor.split("#");

    expect(wallet.descriptor).toBe(
      `tr([${FINGERPRINT}/86h/1h/0h]${DEMO_ACCOUNT_XPUB}/0/*)#${checksum(body)}`,
    );
    expect(actualChecksum).toBe(checksum(body));
    expect(wallet.previewAddresses).toHaveLength(3);
    expect(wallet.previewAddresses.every((address) => address.startsWith("tb1p"))).toBe(true);
    expect(deriveDescriptorAddress(wallet.descriptor, 0, "testnet4")).toBe(
      wallet.previewAddresses[0],
    );
  });

  it("canonicalizes hardened markers, key versions, checksum omission, and source changes", () => {
    const tpub = withVersion(DEMO_ACCOUNT_XPUB, new Uint8Array([0x04, 0x35, 0x87, 0xcf]));
    const imported = validateWalletCandidate(
      {
        descriptor: `tr([${FINGERPRINT}/86'/1'/0']${tpub}/0/*)`,
        source: "import",
      },
      "signet",
    );
    const advanced = validateWalletCandidate(
      {
        accountPublicKey: DEMO_ACCOUNT_XPUB,
        fingerprint: FINGERPRINT.toUpperCase(),
        source: "advanced",
      },
      "signet",
    );

    expect(imported.descriptor).toBe(advanced.descriptor);
    expect(descriptorIdentity(imported.descriptor)).toBe(descriptorIdentity(advanced.descriptor));
    expect(accountXpubFromDescriptor(imported.descriptor)).toBe(DEMO_ACCOUNT_XPUB);
  });

  it("supports an optional matching change descriptor", () => {
    const receive = descriptorFromAccountPublicKey({
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: FINGERPRINT,
    });
    const change = descriptorFromAccountPublicKey({
      accountPublicKey: DEMO_ACCOUNT_XPUB,
      fingerprint: FINGERPRINT,
      chain: 1,
    });
    const wallet = validateWalletCandidate(
      { descriptor: receive, changeDescriptor: change, source: "import" },
      "regtest",
    );
    expect(wallet.changeDescriptor).toBe(change);
  });

  it.each([
    ["non-Taproot", `wpkh([${FINGERPRINT}/86h/1h/0h]${DEMO_ACCOUNT_XPUB}/0/*)`],
    ["Taproot script tree", `tr([${FINGERPRINT}/86h/1h/0h]${DEMO_ACCOUNT_XPUB}/0/*,{pk(02aa)})`],
    ["multisig", `tr(musig(${DEMO_ACCOUNT_XPUB},${OTHER_XPUB})/0/*)`],
    ["wrong network", `tr([${FINGERPRINT}/86h/0h/0h]${DEMO_ACCOUNT_XPUB}/0/*)`],
    ["wrong purpose", `tr([${FINGERPRINT}/84h/1h/0h]${DEMO_ACCOUNT_XPUB}/0/*)`],
    ["malformed wildcard", `tr([${FINGERPRINT}/86h/1h/0h]${DEMO_ACCOUNT_XPUB}/*/0)`],
  ])("rejects %s descriptors", (_label, descriptor) => {
    expect(() => validateWalletCandidate({ descriptor }, "signet")).toThrow();
  });

  it("rejects private extended keys and non-account-depth keys", () => {
    const root = HDKey.fromMasterSeed(new Uint8Array(32).fill(7));
    const account = root.derive("m/86'/1'/0'");
    expect(() =>
      validateWalletCandidate(
        {
          descriptor: `tr([${FINGERPRINT}/86h/1h/0h]${account.privateExtendedKey}/0/*)`,
        },
        "signet",
      ),
    ).toThrow(/Private keys/);

    expect(() =>
      validateWalletCandidate(
        {
          accountPublicKey: root.publicExtendedKey,
          fingerprint: FINGERPRINT,
        },
        "regtest",
      ),
    ).toThrow(/depth 3/);
  });

  it("rejects main-network SLIP-132 public-key versions on test networks", () => {
    const zpub = withVersion(DEMO_ACCOUNT_XPUB, new Uint8Array([0x04, 0xb2, 0x47, 0x46]));
    expect(() =>
      validateWalletCandidate(
        {
          descriptor: `tr([${FINGERPRINT}/86h/1h/0h]${zpub}/0/*)`,
        },
        "testnet4",
      ),
    ).toThrow(/wrong-network version/);
  });
});
