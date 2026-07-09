import { randomBytes } from "node:crypto";
import type { BitcoinRpc, ListSinceBlockResult } from "./rpc.js";
import { deriveTaprootAddress } from "./derivation.js";
import { DEMO_ACCOUNT_XPUB } from "../config.js";

type Utxo = {
  txid: string;
  vout: number;
  address: string;
  amountSats: number;
  confirmations: number;
  spent: boolean;
  coinbase: boolean;
};

type MockTx = {
  txid: string;
  outputs: Array<{ address: string; amountSats: number; vout: number }>;
  confirmations: number;
  blockHeight?: number;
};

/**
 * In-process Bitcoin RPC stand-in for environments without Docker/bitcoind.
 * Enough for Harbor Slice One: issue → pay → confirm → detect.
 */
export class MockBitcoinRpc implements BitcoinRpc {
  readonly kind = "mock" as const;
  private height = 0;
  private tipHash = "0".repeat(64);
  private readonly txs = new Map<string, MockTx>();
  private readonly utxos: Utxo[] = [];
  /** Addresses issued for donations — only these appear in listSinceBlock receives. */
  private readonly donationWatched = new Set<string>();
  private faucetAddress: string;
  private faucetBalanceSats = 50_000_000_000; // 500 BTC

  constructor(accountXpub: string = DEMO_ACCOUNT_XPUB) {
    this.faucetAddress = deriveTaprootAddress(accountXpub, 999_999, "regtest");
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    switch (method) {
      case "getblockchaininfo":
        return (await this.getBlockchainInfo()) as T;
      case "listsinceblock":
        return (await this.listSinceBlock(params[0] as string | undefined)) as T;
      case "getrawtransaction":
        return (await this.getRawTransactionVerbose(params[0] as string)) as T;
      case "sendtoaddress":
        return (await this.sendToAddress(params[0] as string, params[1] as number)) as T;
      case "generatetoaddress":
        return (await this.generateToAddress(params[0] as number, params[1] as string)) as T;
      case "getnewaddress":
        return (await this.getNewAddress()) as T;
      case "getbalance":
        return (await this.getBalance()) as T;
      case "createwallet":
      case "loadwallet":
      case "importdescriptors":
        return {} as T;
      case "getdescriptorinfo":
        return { descriptor: String(params[0]), checksum: "mockcksum" } as T;
      default:
        throw new Error(`MockBitcoinRpc: unsupported method ${method}`);
    }
  }

  async getBlockchainInfo() {
    return { chain: "regtest", blocks: this.height };
  }

  async listSinceBlock(_blockHash?: string): Promise<ListSinceBlockResult> {
    const transactions = this.utxos
      .filter((u) => !u.spent && this.donationWatched.has(u.address) && !u.coinbase)
      .map((u) => ({
        address: u.address,
        category: "receive" as const,
        amount: u.amountSats / 1e8,
        vout: u.vout,
        txid: u.txid,
        confirmations: u.confirmations,
      }));
    return { transactions, lastblock: this.tipHash };
  }

  async getRawTransactionVerbose(txid: string) {
    const tx = this.txs.get(txid);
    if (!tx) throw new Error(`Unknown txid ${txid}`);
    return {
      txid,
      confirmations: tx.confirmations,
      vout: tx.outputs.map((o) => ({
        n: o.vout,
        value: o.amountSats / 1e8,
        scriptPubKey: { address: o.address },
      })),
    };
  }

  async sendToAddress(address: string, amountBtc: number): Promise<string> {
    const amountSats = Math.round(amountBtc * 1e8);
    if (amountSats <= 0) throw new Error("amount must be positive");
    if (this.faucetBalanceSats < amountSats) throw new Error("insufficient faucet funds");
    this.faucetBalanceSats -= amountSats;
    this.donationWatched.add(address);

    const txid = randomBytes(32).toString("hex");
    const output = { address, amountSats, vout: 0 };
    this.txs.set(txid, { txid, outputs: [output], confirmations: 0 });
    this.utxos.push({
      txid,
      vout: 0,
      address,
      amountSats,
      confirmations: 0,
      spent: false,
      coinbase: false,
    });
    return txid;
  }

  async generateToAddress(nblocks: number, address: string): Promise<string[]> {
    const hashes: string[] = [];
    for (let i = 0; i < nblocks; i++) {
      this.height += 1;
      const hash = randomBytes(32).toString("hex");
      this.tipHash = hash;
      hashes.push(hash);
      const coinbaseTxid = randomBytes(32).toString("hex");
      const amountSats = 50 * 1e8;
      this.txs.set(coinbaseTxid, {
        txid: coinbaseTxid,
        outputs: [{ address, amountSats, vout: 0 }],
        confirmations: 1,
        blockHeight: this.height,
      });
      this.utxos.push({
        txid: coinbaseTxid,
        vout: 0,
        address,
        amountSats,
        confirmations: 1,
        spent: false,
        coinbase: true,
      });
      for (const u of this.utxos) {
        if (!u.spent) u.confirmations += 1;
      }
      for (const tx of this.txs.values()) {
        tx.confirmations += 1;
      }
    }
    return hashes;
  }

  async getNewAddress(): Promise<string> {
    return this.faucetAddress;
  }

  async createWallet(): Promise<unknown> {
    return {};
  }

  async loadWallet(): Promise<unknown> {
    return {};
  }

  async getDescriptorInfo(descriptor: string) {
    return { descriptor, checksum: "mockcksum" };
  }

  async importDescriptors(): Promise<unknown> {
    return {};
  }

  async getBalance(): Promise<number> {
    return this.faucetBalanceSats / 1e8;
  }

  /** Explicitly watch an address (used when Harbor issues one). */
  watchAddress(address: string): void {
    this.donationWatched.add(address);
  }
}
