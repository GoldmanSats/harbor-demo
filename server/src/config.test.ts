import { describe, expect, it } from "vitest";
import {
  PUBLIC_NETWORK_POLL_INTERVAL_MS,
  pollIntervalFor,
  resolveHarborNetwork,
} from "./config.js";

describe("Testnet4 configuration", () => {
  it("honors an explicit Testnet4 network in hosted environments", () => {
    expect(
      resolveHarborNetwork({
        HARBOR_NETWORK: "testnet4",
        HARBOR_HOSTED: "1",
      }),
    ).toBe("testnet4");
  });

  it("uses public-network polling etiquette", () => {
    expect(pollIntervalFor("testnet4")).toBe(PUBLIC_NETWORK_POLL_INTERVAL_MS);
    expect(pollIntervalFor("signet")).toBe(PUBLIC_NETWORK_POLL_INTERVAL_MS);
  });
});
