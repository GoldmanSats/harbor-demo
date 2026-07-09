import { MOCK_BTC_USD, RATE_CACHE_MS, MEMPOOL_PRICES_URL } from "../config.js";
import type { RateProvider } from "../services/detection.js";
import type { FetchLike } from "./esplora.js";

/**
 * Live BTC/USD from mempool.space, cached ~60s, falling back to a mock rate on failure.
 */
export class LiveRateProvider implements RateProvider {
  private cached: number | null = null;
  private cachedAt = 0;
  private readonly fallback: number;
  private readonly cacheMs: number;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    opts: {
      fallbackRate?: number;
      cacheMs?: number;
      url?: string;
      fetchImpl?: FetchLike;
    } = {},
  ) {
    this.fallback = opts.fallbackRate ?? MOCK_BTC_USD;
    this.cacheMs = opts.cacheMs ?? RATE_CACHE_MS;
    this.url = opts.url ?? MEMPOOL_PRICES_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  getBtcUsd(): number {
    return this.cached ?? this.fallback;
  }

  /** Refresh cache if stale. Safe to call from the poller; never throws. */
  async refresh(): Promise<number> {
    const now = Date.now();
    if (this.cached !== null && now - this.cachedAt < this.cacheMs) {
      return this.cached;
    }
    try {
      const res = await this.fetchImpl(this.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { USD?: number };
      if (!(typeof body.USD === "number" && body.USD > 0)) {
        throw new Error("Missing USD price");
      }
      this.cached = body.USD;
      this.cachedAt = now;
      return this.cached;
    } catch (err) {
      console.warn("[harbor] live rate fetch failed, using fallback:", (err as Error).message);
      if (this.cached === null) this.cached = this.fallback;
      return this.cached;
    }
  }
}
