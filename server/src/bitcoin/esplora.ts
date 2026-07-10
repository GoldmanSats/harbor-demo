import type {
  BitcoinRpc,
  ListSinceBlockResult,
} from "./rpc.js";
import { SIGNET_ESPLORA_BASE } from "../config.js";

export type FetchLike = typeof fetch;

export type EsploraTxVout = {
  scriptpubkey_address?: string;
  value: number; // sats
};

export type EsploraTxStatus = {
  confirmed: boolean;
  block_height?: number;
};

export type EsploraTx = {
  txid: string;
  vout: EsploraTxVout[];
  status: EsploraTxStatus;
};

export type EsploraBitcoinRpcOptions = {
  baseUrl?: string;
  chain?: "signet" | "testnet4";
  getWatchedAddresses: () => string[] | Promise<string[]>;
  fetchImpl?: FetchLike;
};

/**
 * Esplora-backed BitcoinRpc for public test networks (mempool.space).
 * Implements listSinceBlock by polling /address/:addr/txs for watched addresses.
 */
export class EsploraBitcoinRpc implements BitcoinRpc {
  readonly kind = "esplora" as const;
  private readonly baseUrl: string;
  private readonly getWatchedAddresses: () => string[] | Promise<string[]>;
  private readonly fetchImpl: FetchLike;
  private readonly chain: "signet" | "testnet4";

  constructor(opts: EsploraBitcoinRpcOptions) {
    this.baseUrl = (opts.baseUrl ?? SIGNET_ESPLORA_BASE).replace(/\/$/, "");
    this.chain = opts.chain ?? "signet";
    this.getWatchedAddresses = opts.getWatchedAddresses;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Esplora HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async call<T>(method: string, _params: unknown[] = []): Promise<T> {
    switch (method) {
      case "getblockchaininfo":
        return (await this.getBlockchainInfo()) as T;
      case "listsinceblock":
        return (await this.listSinceBlock()) as T;
      default:
        throw new Error(`EsploraBitcoinRpc: unsupported method ${method}`);
    }
  }

  async getBlockchainInfo() {
    const tip = await this.getJson<number>("/blocks/tip/height");
    return { chain: this.chain, blocks: tip };
  }

  async listSinceBlock(_blockHash?: string): Promise<ListSinceBlockResult> {
    const tip = await this.getJson<number>("/blocks/tip/height");
    const watched = await this.getWatchedAddresses();
    const transactions: ListSinceBlockResult["transactions"] = [];
    const seen = new Set<string>();

    for (const address of watched) {
      const txs = await this.getJson<EsploraTx[]>(
        `/address/${encodeURIComponent(address)}/txs`,
      );
      for (const tx of txs) {
        for (let n = 0; n < tx.vout.length; n++) {
          const out = tx.vout[n];
          if (out.scriptpubkey_address !== address) continue;
          const key = `${tx.txid}:${n}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const confirmations = tx.status.confirmed
            ? Math.max(0, tip - (tx.status.block_height ?? tip) + 1)
            : 0;
          transactions.push({
            address,
            category: "receive",
            amount: out.value / 1e8,
            vout: n,
            txid: tx.txid,
            confirmations,
          });
        }
      }
    }

    return { transactions, lastblock: String(tip) };
  }

  async getRawTransactionVerbose(txid: string) {
    const tx = await this.getJson<EsploraTx>(`/tx/${encodeURIComponent(txid)}`);
    const tip = await this.getJson<number>("/blocks/tip/height");
    const confirmations = tx.status.confirmed
      ? Math.max(0, tip - (tx.status.block_height ?? tip) + 1)
      : 0;
    return {
      txid: tx.txid,
      confirmations,
      vout: tx.vout.map((o, n) => ({
        n,
        value: o.value / 1e8,
        scriptPubKey: { address: o.scriptpubkey_address },
      })),
    };
  }

  async sendToAddress(): Promise<string> {
    throw new Error("EsploraBitcoinRpc: sendToAddress is not supported on public test networks");
  }

  async generateToAddress(): Promise<string[]> {
    throw new Error("EsploraBitcoinRpc: generateToAddress is not supported on public test networks");
  }

  async getNewAddress(): Promise<string> {
    throw new Error("EsploraBitcoinRpc: getNewAddress is not supported on public test networks");
  }

  async createWallet(): Promise<unknown> {
    throw new Error("EsploraBitcoinRpc: createWallet is not supported on signet");
  }

  async loadWallet(): Promise<unknown> {
    throw new Error("EsploraBitcoinRpc: loadWallet is not supported on signet");
  }

  async getDescriptorInfo(): Promise<{ descriptor: string; checksum: string }> {
    throw new Error("EsploraBitcoinRpc: getDescriptorInfo is not supported on signet");
  }

  async importDescriptors(): Promise<unknown> {
    throw new Error("EsploraBitcoinRpc: importDescriptors is not supported on signet");
  }

  async getBalance(): Promise<number> {
    throw new Error("EsploraBitcoinRpc: getBalance is not supported on signet");
  }
}
