import { checksum } from "@bitcoinerlab/descriptors";
import { base58check } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { sha256 } from "@noble/hashes/sha2";
import {
  deriveTaprootAddress,
  normalizeAccountXpub,
  type NetworkName,
} from "./derivation.js";

export type WalletSource = "trezor" | "ledger" | "import" | "advanced" | "legacy";

export type WalletCandidate = {
  descriptor?: string;
  changeDescriptor?: string;
  accountPublicKey?: string;
  changeAccountPublicKey?: string;
  fingerprint?: string;
  accountPath?: string;
  source?: WalletSource;
};

export type ValidatedWallet = {
  descriptor: string;
  changeDescriptor: string | null;
  source: WalletSource;
  fingerprint: string;
  accountPath: string;
  accountXpub: string;
  previewAddresses: string[];
  identity: string;
};

type ParsedDescriptor = {
  descriptor: string;
  fingerprint: string;
  accountPath: string;
  accountXpub: string;
  chain: 0 | 1;
  identity: string;
};

const b58c = base58check(sha256);
const PUBLIC_EXTENDED_KEY_VERSIONS = new Set([
  "0488b21e", // xpub
  "043587cf", // tpub
  "044a5262", // upub
  "045f1cf6", // vpub
]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseExtendedPublicKey(extendedKey: string): {
  normalized: string;
  fallbackFingerprint: string;
} {
  const trimmed = extendedKey.trim();
  let decoded: Uint8Array;
  try {
    decoded = b58c.decode(trimmed);
  } catch {
    throw new Error("Invalid account public key encoding");
  }
  if (decoded.length !== 78) throw new Error("Invalid account public key length");

  const version = bytesToHex(decoded.slice(0, 4));
  if (decoded[45] !== 2 && decoded[45] !== 3) {
    throw new Error("Private keys are not allowed; provide an account public key");
  }
  if (!PUBLIC_EXTENDED_KEY_VERSIONS.has(version)) {
    throw new Error("The account public key uses an unsupported or wrong-network version");
  }

  const normalized = normalizeAccountXpub(trimmed);
  let node: HDKey;
  try {
    node = HDKey.fromExtendedKey(normalized);
  } catch {
    throw new Error("Invalid account public key");
  }
  if (node.depth !== 3) {
    throw new Error(`Expected a BIP-86 account-level public key (depth 3), got depth ${node.depth}`);
  }

  return {
    normalized,
    fallbackFingerprint: bytesToHex(decoded.slice(5, 9)),
  };
}

function parseFingerprint(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new Error("Wallet fingerprint must be exactly 8 hexadecimal characters");
  }
  return normalized;
}

function normalizeAccountPath(path: string): string {
  const trimmed = path.trim().replace(/^m\//i, "");
  const parts = trimmed.split("/");
  if (parts.length !== 3) {
    throw new Error("Expected a BIP-86 account path with three hardened levels");
  }

  const values = parts.map((part) => {
    const match = /^(\d+)(?:['hH])$/.exec(part);
    if (!match) throw new Error("Every account-path level must be hardened");
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) {
      throw new Error("Invalid account-path index");
    }
    return value;
  });

  if (values[0] !== 86) throw new Error("Only BIP-86 Taproot accounts are supported");
  if (values[1] !== 1) {
    throw new Error("The wallet account is for the wrong network (expected test-network coin type 1)");
  }

  return `m/${values[0]}'/${values[1]}'/${values[2]}'`;
}

function descriptorOriginPath(accountPath: string): string {
  return accountPath
    .replace(/^m\//, "")
    .replaceAll("'", "h");
}

function canonicalDescriptorBody(input: {
  fingerprint: string;
  accountPath: string;
  accountXpub: string;
  chain: 0 | 1;
}): string {
  return `tr([${input.fingerprint}/${descriptorOriginPath(input.accountPath)}]${input.accountXpub}/${input.chain}/*)`;
}

function addChecksum(body: string): string {
  return `${body}#${checksum(body)}`;
}

function parseDescriptor(input: string, expectedChain: 0 | 1): ParsedDescriptor {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Descriptor is empty");
  if (/\b(?:xprv|tprv|yprv|zprv|uprv|vprv)\b/i.test(trimmed)) {
    throw new Error("Private keys are not allowed");
  }

  const hashParts = trimmed.split("#");
  if (hashParts.length > 2) throw new Error("Malformed descriptor checksum");
  const body = hashParts[0];
  const suppliedChecksum = hashParts[1];
  const expectedChecksum = checksum(body);
  if (suppliedChecksum !== undefined && suppliedChecksum !== expectedChecksum) {
    throw new Error("Descriptor checksum does not match");
  }

  const match = /^tr\(\[([0-9a-fA-F]{8})\/([^\]]+)\]([^/()[\],]+)\/([01])\/\*\)$/.exec(body);
  if (!match) {
    throw new Error(
      "Only single-key BIP-86 Taproot descriptors with origin, receive/change branch, and wildcard are supported",
    );
  }

  const fingerprint = parseFingerprint(match[1]);
  const accountPath = normalizeAccountPath(match[2]);
  const chain = Number(match[4]) as 0 | 1;
  if (chain !== expectedChain) {
    throw new Error(expectedChain === 0 ? "Expected a receive descriptor (/0/*)" : "Expected a change descriptor (/1/*)");
  }
  const { normalized: accountXpub } = parseExtendedPublicKey(match[3]);
  const canonicalBody = canonicalDescriptorBody({ fingerprint, accountPath, accountXpub, chain });

  return {
    descriptor: addChecksum(canonicalBody),
    fingerprint,
    accountPath,
    accountXpub,
    chain,
    identity: `${accountXpub}/${chain}/*`,
  };
}

export function descriptorFromAccountPublicKey(input: {
  accountPublicKey: string;
  fingerprint?: string;
  accountPath?: string;
  chain?: 0 | 1;
}): string {
  const parsedKey = parseExtendedPublicKey(input.accountPublicKey);
  const fingerprint = parseFingerprint(input.fingerprint ?? parsedKey.fallbackFingerprint);
  const accountPath = normalizeAccountPath(input.accountPath ?? "m/86'/1'/0'");
  const body = canonicalDescriptorBody({
    fingerprint,
    accountPath,
    accountXpub: parsedKey.normalized,
    chain: input.chain ?? 0,
  });
  return addChecksum(body);
}

export function validateWalletCandidate(
  candidate: WalletCandidate,
  network: NetworkName,
  previewCount = 3,
): ValidatedWallet {
  const source = candidate.source ?? (candidate.descriptor ? "import" : "advanced");
  const receiveDescriptor =
    candidate.descriptor ??
    (candidate.accountPublicKey
      ? descriptorFromAccountPublicKey({
          accountPublicKey: candidate.accountPublicKey,
          fingerprint: candidate.fingerprint,
          accountPath: candidate.accountPath,
          chain: 0,
        })
      : null);
  if (!receiveDescriptor) {
    throw new Error("Provide a watch-only descriptor or account public key");
  }

  const receive = parseDescriptor(receiveDescriptor, 0);
  let change: ParsedDescriptor | null = null;
  if (candidate.changeDescriptor) {
    change = parseDescriptor(candidate.changeDescriptor, 1);
  } else if (candidate.changeAccountPublicKey) {
    change = parseDescriptor(
      descriptorFromAccountPublicKey({
        accountPublicKey: candidate.changeAccountPublicKey,
        fingerprint: candidate.fingerprint ?? receive.fingerprint,
        accountPath: candidate.accountPath ?? receive.accountPath,
        chain: 1,
      }),
      1,
    );
  }
  if (
    change &&
    (change.accountXpub !== receive.accountXpub || change.accountPath !== receive.accountPath)
  ) {
    throw new Error("Receive and change descriptors must use the same BIP-86 account");
  }

  const previewAddresses = Array.from({ length: previewCount }, (_, index) =>
    deriveTaprootAddress(receive.accountXpub, index, network),
  );

  return {
    descriptor: receive.descriptor,
    changeDescriptor: change?.descriptor ?? null,
    source,
    fingerprint: receive.fingerprint,
    accountPath: receive.accountPath,
    accountXpub: receive.accountXpub,
    previewAddresses,
    identity: receive.identity,
  };
}

export function deriveDescriptorAddress(
  descriptor: string,
  index: number,
  network: NetworkName,
): string {
  const receive = parseDescriptor(descriptor, 0);
  return deriveTaprootAddress(receive.accountXpub, index, network);
}

export function descriptorIdentity(descriptor: string): string {
  return parseDescriptor(descriptor, 0).identity;
}

export function accountXpubFromDescriptor(descriptor: string): string {
  return parseDescriptor(descriptor, 0).accountXpub;
}
