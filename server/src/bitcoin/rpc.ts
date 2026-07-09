/** Bitcoin JSON-RPC client interface used by Harbor. */

export type RpcTxOut = {
  address?: string;
  value: number; // BTC
  n: number;
};

export type RpcTransaction = {
  txid: string;
  confirmations?: number;
  details?: Array<{
    address?: string;
    category: string;
    amount: number;
    vout: number;
  }>;
  hex?: string;
};

export type ListSinceBlockResult = {
  transactions: Array<{
    address?: string;
    category: string;
    amount: number;
    vout: number;
    txid: string;
    confirmations: number;
    label?: string;
  }>;
  lastblock: string;
};

export interface BitcoinRpc {
  readonly kind: "regtest" | "mock";
  call<T>(method: string, params?: unknown[]): Promise<T>;
  getBlockchainInfo(): Promise<{ chain: string; blocks: number }>;
  listSinceBlock(blockHash?: string): Promise<ListSinceBlockResult>;
  getRawTransactionVerbose(txid: string): Promise<{
    txid: string;
    confirmations?: number;
    vout: Array<{ n: number; value: number; scriptPubKey: { address?: string; addresses?: string[] } }>;
  }>;
  sendToAddress(address: string, amountBtc: number): Promise<string>;
  generateToAddress(nblocks: number, address: string): Promise<string[]>;
  getNewAddress(label?: string, type?: string): Promise<string>;
  createWallet(name: string, options?: { disablePrivateKeys?: boolean; blank?: boolean }): Promise<unknown>;
  loadWallet(name: string): Promise<unknown>;
  getDescriptorInfo(descriptor: string): Promise<{ descriptor: string; checksum: string }>;
  importDescriptors(descriptors: unknown[]): Promise<unknown>;
  getBalance(): Promise<number>;
}

export type RpcConfig = {
  url: string;
  username: string;
  password: string;
  wallet?: string;
};

export class HttpBitcoinRpc implements BitcoinRpc {
  readonly kind = "regtest" as const;
  constructor(private readonly cfg: RpcConfig) {}

  private endpoint(): string {
    if (this.cfg.wallet) {
      return `${this.cfg.url.replace(/\/$/, "")}/wallet/${encodeURIComponent(this.cfg.wallet)}`;
    }
    return this.cfg.url;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64");
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bitcoin RPC HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`Bitcoin RPC error: ${body.error.message}`);
    return body.result as T;
  }

  getBlockchainInfo() {
    return this.call<{ chain: string; blocks: number }>("getblockchaininfo");
  }

  listSinceBlock(blockHash?: string) {
    return this.call<ListSinceBlockResult>("listsinceblock", blockHash ? [blockHash] : [""]);
  }

  getRawTransactionVerbose(txid: string) {
    return this.call<{
      txid: string;
      confirmations?: number;
      vout: Array<{
        n: number;
        value: number;
        scriptPubKey: { address?: string; addresses?: string[] };
      }>;
    }>("getrawtransaction", [txid, true]);
  }

  sendToAddress(address: string, amountBtc: number) {
    return this.call<string>("sendtoaddress", [address, amountBtc]);
  }

  generateToAddress(nblocks: number, address: string) {
    return this.call<string[]>("generatetoaddress", [nblocks, address]);
  }

  getNewAddress(label = "", type = "bech32m") {
    return this.call<string>("getnewaddress", [label, type]);
  }

  createWallet(name: string, options: { disablePrivateKeys?: boolean; blank?: boolean } = {}) {
    return this.call("createwallet", [
      name,
      options.disablePrivateKeys ?? false,
      options.blank ?? false,
    ]);
  }

  loadWallet(name: string) {
    return this.call("loadwallet", [name]);
  }

  getDescriptorInfo(descriptor: string) {
    return this.call<{ descriptor: string; checksum: string }>("getdescriptorinfo", [descriptor]);
  }

  importDescriptors(descriptors: unknown[]) {
    return this.call("importdescriptors", [descriptors]);
  }

  getBalance() {
    return this.call<number>("getbalance");
  }

  withWallet(wallet: string): HttpBitcoinRpc {
    return new HttpBitcoinRpc({ ...this.cfg, wallet });
  }
}
