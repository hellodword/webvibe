import { describe, expect, it } from "vitest";

import { PairingManager } from "../../src/auth/pairing.js";

describe("pairing manager", () => {
  it("uses configurable pairing failure limits", async () => {
    const pairing = new PairingManager({
      pairingCode: "123456",
      pairingFailures: { maxAttempts: 2, windowSeconds: 600 },
    });
    await pairing.load();

    expect(() => pairing.verify("bad", "client-a")).toThrow("Invalid pairing code");
    expect(() => pairing.verify("bad", "client-a")).toThrow("Invalid pairing code");
    expect(() => pairing.verify("bad", "client-a")).toThrow("Too many pairing attempts");
    expect(() => pairing.verify("123456", "client-b")).not.toThrow();
  });
});
