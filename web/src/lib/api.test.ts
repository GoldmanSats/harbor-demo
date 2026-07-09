import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLD, formatSats, formatUsd } from "./api";

describe("api helpers", () => {
  it("formats sats", () => {
    expect(formatSats(500_000)).toBe("500,000 sats");
  });

  it("formats usd", () => {
    expect(formatUsd(1234.5)).toContain("1,234.50");
  });

  it("default threshold matches spec", () => {
    expect(DEFAULT_THRESHOLD).toBe(500_000);
  });
});
